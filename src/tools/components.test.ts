import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import { createSketch } from "./sketch.js";
import { listComponents, addComponent, removeComponent } from "./components.js";

const VALID_ALGORITHM = `function sketch(p, state) {
  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };
  p.draw = () => {};
  return { initializeSystem() {} };
}`;

const GLSL_ALGORITHM = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  fragColor = vec4(uv, 0.0, 1.0);
}`;

/** Helper: set up a workspace with a p5 sketch. */
async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<{ wsPath: string; sketchPath: string }> {
  const sketchPath = join(tmpDir, "test-sketch.genart");
  const sketchJson = JSON.stringify({
    genart: "1.1",
    id: "test-sketch",
    title: "Test Sketch",
    created: "2026-02-23T00:00:00Z",
    modified: "2026-02-23T00:00:00Z",
    renderer: { type: "p5", version: "1.x" },
    canvas: { width: 1200, height: 1200 },
    parameters: [],
    colors: [],
    state: { seed: 42, params: {}, colorPalette: [] },
    algorithm: VALID_ALGORITHM,
  });
  await writeFile(sketchPath, sketchJson);

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: [sketchPath],
  });

  return { wsPath, sketchPath };
}

/** Helper: set up a workspace with a GLSL sketch. */
async function setupGlslWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<{ wsPath: string; sketchPath: string }> {
  const sketchPath = join(tmpDir, "glsl-sketch.genart");
  const sketchJson = JSON.stringify({
    genart: "1.1",
    id: "glsl-sketch",
    title: "GLSL Sketch",
    created: "2026-02-23T00:00:00Z",
    modified: "2026-02-23T00:00:00Z",
    renderer: { type: "glsl", version: "1.x" },
    canvas: { width: 1200, height: 1200 },
    parameters: [],
    colors: [],
    state: { seed: 42, params: {}, colorPalette: [] },
    algorithm: GLSL_ALGORITHM,
  });
  await writeFile(sketchPath, sketchJson);

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: [sketchPath],
  });

  return { wsPath, sketchPath };
}

describe("component tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-components-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // list_components
  // -----------------------------------------------------------------------

  describe("list_components", () => {
    it("lists all components when no filters", async () => {
      const result = await listComponents(state, {});

      expect(result.count).toBeGreaterThan(0);
      expect(result.count).toBe(56);
      const components = result.components as Array<{ name: string }>;
      expect(components.length).toBe(56);
    });

    it("filters by renderer (p5 = JS components)", async () => {
      const result = await listComponents(state, { renderer: "p5" });

      const components = result.components as Array<{
        name: string;
        target: string;
      }>;
      expect(components.length).toBe(38);
      for (const c of components) {
        expect(c.target).toBe("js");
      }
    });

    it("filters by renderer (glsl = GLSL components)", async () => {
      const result = await listComponents(state, { renderer: "glsl" });

      const components = result.components as Array<{
        name: string;
        target: string;
      }>;
      expect(components.length).toBe(18);
      for (const c of components) {
        expect(c.target).toBe("glsl");
      }
    });

    it("filters by category", async () => {
      const result = await listComponents(state, { category: "randomness" });

      const components = result.components as Array<{
        name: string;
        category: string;
      }>;
      expect(components.length).toBeGreaterThan(0);
      for (const c of components) {
        expect(c.category).toBe("randomness");
      }
    });

    it("filters by both renderer and category", async () => {
      const result = await listComponents(state, {
        renderer: "glsl",
        category: "noise",
      });

      const components = result.components as Array<{
        name: string;
        target: string;
        category: string;
      }>;
      for (const c of components) {
        expect(c.target).toBe("glsl");
        expect(c.category).toBe("noise");
      }
    });

    it("returns sorted by category then name", async () => {
      const result = await listComponents(state, {});

      const components = result.components as Array<{
        name: string;
        category: string;
      }>;
      for (let i = 1; i < components.length; i++) {
        const prev = components[i - 1];
        const curr = components[i];
        const catCmp = prev.category.localeCompare(curr.category);
        if (catCmp === 0) {
          expect(prev.name.localeCompare(curr.name)).toBeLessThanOrEqual(0);
        } else {
          expect(catCmp).toBeLessThan(0);
        }
      }
    });

    it("includes expected fields for each component", async () => {
      const result = await listComponents(state, { renderer: "p5" });

      const components = result.components as Array<Record<string, unknown>>;
      const prng = components.find((c) => c.name === "prng");
      expect(prng).toBeDefined();
      expect(prng!.version).toBe("1.0.0");
      expect(prng!.category).toBe("randomness");
      expect(prng!.target).toBe("js");
      expect(Array.isArray(prng!.exports)).toBe(true);
      expect(Array.isArray(prng!.dependencies)).toBe(true);
      expect(typeof prng!.description).toBe("string");
    });

    it("rejects unknown renderer", async () => {
      await expect(
        listComponents(state, { renderer: "unity" }),
      ).rejects.toThrow("Unknown renderer type: 'unity'");
    });
  });

  // -----------------------------------------------------------------------
  // add_component
  // -----------------------------------------------------------------------

  describe("add_component", () => {
    it("adds a component to a sketch", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await addComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      expect(result.success).toBe(true);
      expect(result.sketchId).toBe("test-sketch");
      expect(result.added).toContain("prng");

      const components = result.components as Record<
        string,
        { version: string; code: string; exports: string[] }
      >;
      expect(components.prng).toBeDefined();
      expect(components.prng.version).toBe("1.0.0");
      expect(typeof components.prng.code).toBe("string");
      expect(components.prng.code.length).toBeGreaterThan(0);
      expect(Array.isArray(components.prng.exports)).toBe(true);
    });

    it("persists resolved components to disk", async () => {
      await setupWorkspace(tmpDir, state);

      await addComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      const raw = await readFile(join(tmpDir, "test-sketch.genart"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.genart).toBe("1.2");
      expect(parsed.components).toBeDefined();
      expect(parsed.components.prng).toBeDefined();
      expect(parsed.components.prng.version).toBe("1.0.0");
      expect(typeof parsed.components.prng.code).toBe("string");
    });

    it("resolves transitive dependencies", async () => {
      await setupWorkspace(tmpDir, state);

      // Find a component that has dependencies
      const { COMPONENT_REGISTRY } = await import("@genart-dev/core");
      const withDeps = Object.values(COMPONENT_REGISTRY).find(
        (e) => e.target === "js" && e.dependencies.length > 0,
      );

      if (withDeps) {
        const result = await addComponent(state, {
          sketchId: "test-sketch",
          component: withDeps.name,
        });

        // All dependencies should be in the added list
        const components = result.components as Record<string, unknown>;
        for (const dep of withDeps.dependencies) {
          expect(components[dep]).toBeDefined();
        }
      }
    });

    it("rejects unknown component", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        addComponent(state, {
          sketchId: "test-sketch",
          component: "nonexistent-component",
        }),
      ).rejects.toThrow('Unknown component: "nonexistent-component"');
    });

    it("rejects renderer mismatch (GLSL component on p5 sketch)", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        addComponent(state, {
          sketchId: "test-sketch",
          component: "glsl-noise",
        }),
      ).rejects.toThrow('target "glsl" but renderer "p5" requires target "js"');
    });

    it("rejects renderer mismatch (JS component on GLSL sketch)", async () => {
      await setupGlslWorkspace(tmpDir, state);

      await expect(
        addComponent(state, {
          sketchId: "glsl-sketch",
          component: "prng",
        }),
      ).rejects.toThrow(
        'target "js" but renderer "glsl" requires target "glsl"',
      );
    });

    it("rejects duplicate component", async () => {
      await setupWorkspace(tmpDir, state);

      await addComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      await expect(
        addComponent(state, {
          sketchId: "test-sketch",
          component: "prng",
        }),
      ).rejects.toThrow('already present in sketch');
    });

    it("rejects unknown sketch ID", async () => {
      await expect(
        addComponent(state, {
          sketchId: "nonexistent",
          component: "prng",
        }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("updates sketch in state cache", async () => {
      await setupWorkspace(tmpDir, state);

      await addComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      const def = state.getSketch("test-sketch")!.definition;
      expect(def.components).toBeDefined();
      expect(def.components!.prng).toBeDefined();
      expect(def.genart).toBe("1.2");
    });
  });

  // -----------------------------------------------------------------------
  // remove_component
  // -----------------------------------------------------------------------

  describe("remove_component", () => {
    it("removes a component from a sketch", async () => {
      await setupWorkspace(tmpDir, state);

      // First add a component
      await addComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      // Then remove it
      const result = await removeComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      expect(result.success).toBe(true);
      expect(result.removed).toContain("prng");

      // Verify it's gone from state
      const def = state.getSketch("test-sketch")!.definition;
      expect(def.components).toBeUndefined();
    });

    it("persists removal to disk", async () => {
      await setupWorkspace(tmpDir, state);

      await addComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      await removeComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      const raw = await readFile(join(tmpDir, "test-sketch.genart"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.components).toBeUndefined();
    });

    it("warns when algorithm references component exports", async () => {
      await setupWorkspace(tmpDir, state);

      // Add prng component
      await addComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      // Update algorithm to use mulberry32
      const loaded = state.getSketch("test-sketch")!;
      const algoWithPrng = `function sketch(p, state) {
  const rng = mulberry32(state.SEED);
  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };
  p.draw = () => {};
  return { initializeSystem() {} };
}`;
      state.sketches.set("test-sketch", {
        ...loaded,
        definition: { ...loaded.definition, algorithm: algoWithPrng },
      });

      // Remove prng — should warn about mulberry32 usage
      const result = await removeComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      expect(result.warning).toBeDefined();
      expect(result.warning as string).toContain("mulberry32");
    });

    it("rejects removing a component that others depend on", async () => {
      await setupWorkspace(tmpDir, state);

      // Find two components where one depends on the other
      const { COMPONENT_REGISTRY } = await import("@genart-dev/core");
      const dependent = Object.values(COMPONENT_REGISTRY).find(
        (e) => e.target === "js" && e.dependencies.length > 0,
      );

      if (dependent) {
        // Add the dependent component (which also adds its dependency)
        await addComponent(state, {
          sketchId: "test-sketch",
          component: dependent.name,
        });

        // Try to remove the dependency — should fail
        const dep = dependent.dependencies[0];
        await expect(
          removeComponent(state, {
            sketchId: "test-sketch",
            component: dep,
          }),
        ).rejects.toThrow(`Cannot remove "${dep}"`);
      }
    });

    it("rejects removing a non-existent component", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        removeComponent(state, {
          sketchId: "test-sketch",
          component: "prng",
        }),
      ).rejects.toThrow('not present in sketch');
    });

    it("rejects unknown sketch ID", async () => {
      await expect(
        removeComponent(state, {
          sketchId: "nonexistent",
          component: "prng",
        }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("keeps remaining components when removing one of several", async () => {
      await setupWorkspace(tmpDir, state);

      // Add two independent components
      await addComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });
      await addComponent(state, {
        sketchId: "test-sketch",
        component: "math",
      });

      // Remove only prng
      await removeComponent(state, {
        sketchId: "test-sketch",
        component: "prng",
      });

      const def = state.getSketch("test-sketch")!.definition;
      expect(def.components).toBeDefined();
      expect(def.components!.prng).toBeUndefined();
      expect(def.components!.math).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Remote mode
  // -----------------------------------------------------------------------

  describe("remote mode", () => {
    it("returns fileContent in add_component response", async () => {
      const remoteState = new EditorState({ remoteMode: true });
      remoteState.basePath = tmpDir;

      // Create a sketch in remote mode
      await createSketch(remoteState, {
        id: "remote-sketch",
        title: "Remote Sketch",
        path: join(tmpDir, "remote.genart"),
        algorithm: VALID_ALGORITHM,
      });

      const result = await addComponent(remoteState, {
        sketchId: "remote-sketch",
        component: "prng",
      });

      expect(result.fileContent).toBeDefined();
      const parsed = JSON.parse(result.fileContent as string);
      expect(parsed.components.prng).toBeDefined();
    });
  });
});
