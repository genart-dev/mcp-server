import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import {
  createSketch,
  openSketch,
  updateSketch,
  updateAlgorithm,
  saveSketch,
  forkSketch,
  deleteSketch,
} from "./sketch.js";

/** Minimal valid .genart content. */
function makeSketch(
  id: string,
  title: string,
  width = 1200,
  height = 1200,
): string {
  return JSON.stringify({
    genart: "1.1",
    id,
    title,
    created: "2026-02-14T00:00:00Z",
    modified: "2026-02-14T00:00:00Z",
    renderer: { type: "p5", version: "1.x" },
    canvas: { width, height },
    parameters: [
      {
        key: "count",
        label: "Count",
        min: 1,
        max: 100,
        step: 1,
        default: 10,
      },
    ],
    colors: [{ key: "bg", label: "Background", default: "#1a1a1a" }],
    state: { seed: 42, params: { count: 10 }, colorPalette: ["#1a1a1a"] },
    algorithm: VALID_ALGORITHM,
  });
}

const VALID_ALGORITHM = `function sketch(p, state) {
  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };
  p.draw = () => {};
  return { initializeSystem() {} };
}`;

const UPDATED_ALGORITHM = `function sketch(p, state) {
  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); p.background(0); };
  p.draw = () => { p.ellipse(p.width/2, p.height/2, 100); };
  return { initializeSystem() {} };
}`;

/** Helper: set up a workspace with one sketch. */
async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<{ wsPath: string; sketchPath: string }> {
  const sketchPath = join(tmpDir, "test-sketch.genart");
  await writeFile(sketchPath, makeSketch("test-sketch", "Test Sketch"));

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: [sketchPath],
  });

  return { wsPath, sketchPath };
}

describe("sketch lifecycle tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-sketch-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // create_sketch
  // -----------------------------------------------------------------------

  describe("create_sketch", () => {
    it("creates a sketch with defaults", async () => {
      const path = join(tmpDir, "new.genart");
      const result = await createSketch(state, {
        id: "new-sketch",
        title: "New Sketch",
        path,
      });

      expect(result.success).toBe(true);
      expect(result.path).toBe(path);
      expect(result.id).toBe("new-sketch");
      expect(result.renderer).toBe("p5");
      expect((result.canvas as { width: number }).width).toBe(1200);
      expect(typeof result.seed).toBe("number");

      // File exists on disk
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.genart).toBe("1.1");
      expect(parsed.id).toBe("new-sketch");
      expect(parsed.renderer.type).toBe("p5");
    });

    it("creates a sketch with custom renderer and canvas", async () => {
      const path = join(tmpDir, "custom.genart");
      const result = await createSketch(state, {
        id: "custom-sketch",
        title: "Custom",
        path,
        renderer: "canvas2d",
        canvas: { preset: "square-600" },
      });

      expect(result.renderer).toBe("canvas2d");
      expect((result.canvas as { width: number }).width).toBe(600);
      expect((result.canvas as { height: number }).height).toBe(600);
    });

    it("creates a sketch with parameters and colors", async () => {
      const path = join(tmpDir, "params.genart");
      const result = await createSketch(state, {
        id: "param-sketch",
        title: "With Params",
        path,
        parameters: [
          { key: "size", label: "Size", min: 10, max: 200, step: 1, default: 50 },
        ],
        colors: [{ key: "fg", label: "Foreground", default: "#ffffff" }],
        seed: 12345,
      });

      expect(result.success).toBe(true);
      expect(result.seed).toBe(12345);

      // State has correct values
      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.state.params.size).toBe(50);
      expect(parsed.state.colorPalette).toEqual(["#ffffff"]);
    });

    it("creates a sketch with custom algorithm", async () => {
      const path = join(tmpDir, "algo.genart");
      await createSketch(state, {
        id: "algo-sketch",
        title: "Custom Algo",
        path,
        algorithm: VALID_ALGORITHM,
      });

      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.algorithm).toBe(VALID_ALGORITHM);
    });

    it("adds to workspace when addToWorkspace is specified", async () => {
      const { wsPath } = await setupWorkspace(tmpDir, state);

      const newPath = join(tmpDir, "added.genart");
      const result = await createSketch(state, {
        id: "added-sketch",
        title: "Added to WS",
        path: newPath,
        addToWorkspace: wsPath,
      });

      expect(result.success).toBe(true);
      expect(state.workspace!.sketches.length).toBe(2);
    });

    it("rejects non-.genart extension", async () => {
      await expect(
        createSketch(state, {
          id: "bad",
          title: "Bad",
          path: join(tmpDir, "bad.json"),
        }),
      ).rejects.toThrow("Path must end with .genart");
    });

    it("rejects invalid kebab-case id", async () => {
      await expect(
        createSketch(state, {
          id: "BAD_ID",
          title: "Bad",
          path: join(tmpDir, "bad.genart"),
        }),
      ).rejects.toThrow("ID must be kebab-case");
    });

    it("rejects if file already exists", async () => {
      const path = join(tmpDir, "exists.genart");
      await writeFile(path, "{}");

      await expect(
        createSketch(state, {
          id: "exists",
          title: "Exists",
          path,
        }),
      ).rejects.toThrow("File already exists");
    });

    it("rejects unknown renderer type", async () => {
      await expect(
        createSketch(state, {
          id: "bad-renderer",
          title: "Bad",
          path: join(tmpDir, "bad.genart"),
          renderer: "unity",
        }),
      ).rejects.toThrow("Unknown renderer type: 'unity'");
    });

    it("rejects duplicate parameter keys", async () => {
      await expect(
        createSketch(state, {
          id: "dup-params",
          title: "Dup",
          path: join(tmpDir, "dup.genart"),
          parameters: [
            { key: "size", label: "Size", min: 0, max: 100, step: 1, default: 50 },
            { key: "size", label: "Size 2", min: 0, max: 100, step: 1, default: 50 },
          ],
        }),
      ).rejects.toThrow("Duplicate parameter key: 'size'");
    });

    it("rejects parameter default out of range", async () => {
      await expect(
        createSketch(state, {
          id: "bad-default",
          title: "Bad",
          path: join(tmpDir, "bad.genart"),
          parameters: [
            { key: "margin", label: "Margin", min: 10, max: 100, step: 1, default: 999 },
          ],
        }),
      ).rejects.toThrow("Parameter 'margin' default (999) outside range [10, 100]");
    });

    it("sets agent and model when provided", async () => {
      const path = join(tmpDir, "attributed.genart");
      await createSketch(state, {
        id: "attributed",
        title: "Attributed",
        path,
        agent: "claude-code",
        model: "claude-opus-4-6",
      });

      const def = state.getSketch("attributed")!.definition;
      expect(def.agent).toBe("claude-code");
      expect(def.model).toBe("claude-opus-4-6");

      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.agent).toBe("claude-code");
      expect(parsed.model).toBe("claude-opus-4-6");
    });

    it("omits agent and model when not provided", async () => {
      const path = join(tmpDir, "no-attr.genart");
      await createSketch(state, {
        id: "no-attr",
        title: "No Attribution",
        path,
      });

      const def = state.getSketch("no-attr")!.definition;
      expect(def.agent).toBeUndefined();
      expect(def.model).toBeUndefined();

      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.agent).toBeUndefined();
      expect(parsed.model).toBeUndefined();
    });

    it("creates a sketch with components (shorthand)", async () => {
      const path = join(tmpDir, "with-components.genart");
      const result = await createSketch(state, {
        id: "with-components",
        title: "With Components",
        path,
        components: { prng: "^1.0.0" },
        algorithm: VALID_ALGORITHM,
      });

      expect(result.success).toBe(true);

      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.genart).toBe("1.2");
      expect(parsed.components).toBeDefined();
      expect(parsed.components.prng).toBeDefined();
      expect(parsed.components.prng.version).toBe("1.0.0");
      expect(typeof parsed.components.prng.code).toBe("string");
    });

    it("creates a sketch with inline component (custom code)", async () => {
      const path = join(tmpDir, "inline-comp.genart");
      const customCode = "function customRng(seed) { return seed * 1.5; }";
      const result = await createSketch(state, {
        id: "inline-comp",
        title: "Inline Component",
        path,
        components: {
          "custom-rng": { code: customCode, exports: ["customRng"] },
        },
        algorithm: VALID_ALGORITHM,
      });

      expect(result.success).toBe(true);

      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.genart).toBe("1.2");
      expect(parsed.components["custom-rng"].code).toBe(customCode);
    });

    it("rejects components with renderer mismatch", async () => {
      await expect(
        createSketch(state, {
          id: "bad-comp",
          title: "Bad Components",
          path: join(tmpDir, "bad-comp.genart"),
          renderer: "p5",
          components: { "glsl-noise": "^1.0.0" },
          algorithm: VALID_ALGORITHM,
        }),
      ).rejects.toThrow("target");
    });

    it("creates a sketch without components (version stays 1.1)", async () => {
      const path = join(tmpDir, "no-comp.genart");
      await createSketch(state, {
        id: "no-comp",
        title: "No Components",
        path,
      });

      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.genart).toBe("1.1");
      expect(parsed.components).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // open_sketch
  // -----------------------------------------------------------------------

  describe("open_sketch", () => {
    it("opens a loaded sketch and sets selection", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await openSketch(state, { sketchId: "test-sketch" });

      expect(result.success).toBe(true);
      expect(result.id).toBe("test-sketch");
      expect(result.title).toBe("Test Sketch");
      expect(result.renderer).toBe("p5");
      expect((result.canvas as { width: number }).width).toBe(1200);
      expect(result.parameterCount).toBe(1);
      expect(result.colorCount).toBe(1);
      expect(result.seed).toBe(42);
      expect(typeof result.algorithmLength).toBe("number");

      // Selection is set
      expect(state.selection.has("test-sketch")).toBe(true);
    });

    it("rejects unknown sketch ID", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        openSketch(state, { sketchId: "nonexistent" }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        openSketch(state, { sketchId: "any" }),
      ).rejects.toThrow("No workspace is currently open");
    });
  });

  // -----------------------------------------------------------------------
  // update_sketch
  // -----------------------------------------------------------------------

  describe("update_sketch", () => {
    beforeEach(async () => {
      await setupWorkspace(tmpDir, state);
    });

    it("updates title", async () => {
      const result = await updateSketch(state, {
        sketchId: "test-sketch",
        title: "Updated Title",
      });

      expect(result.success).toBe(true);
      expect(result.updated).toContain("title");
      expect(state.getSketch("test-sketch")!.definition.title).toBe(
        "Updated Title",
      );
    });

    it("updates canvas dimensions", async () => {
      const result = await updateSketch(state, {
        sketchId: "test-sketch",
        canvas: { preset: "square-2400" },
      });

      expect(result.success).toBe(true);
      expect(result.updated).toContain("canvas");
      expect((result.canvas as { width: number }).width).toBe(2400);
    });

    it("updates parameters and rebuilds state", async () => {
      const result = await updateSketch(state, {
        sketchId: "test-sketch",
        parameters: [
          { key: "x", label: "X", min: 0, max: 500, step: 1, default: 250 },
          { key: "y", label: "Y", min: 0, max: 500, step: 1, default: 250 },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.parameterCount).toBe(2);

      const def = state.getSketch("test-sketch")!.definition;
      expect(def.state.params).toEqual({ x: 250, y: 250 });
    });

    it("updates colors and rebuilds state", async () => {
      const result = await updateSketch(state, {
        sketchId: "test-sketch",
        colors: [
          { key: "bg", label: "BG", default: "#000000" },
          { key: "fg", label: "FG", default: "#ffffff" },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.colorCount).toBe(2);

      const def = state.getSketch("test-sketch")!.definition;
      expect(def.state.colorPalette).toEqual(["#000000", "#ffffff"]);
    });

    it("updates seed", async () => {
      const result = await updateSketch(state, {
        sketchId: "test-sketch",
        seed: 99999,
      });

      expect(result.success).toBe(true);
      expect(result.seed).toBe(99999);
    });

    it("persists changes to disk", async () => {
      await updateSketch(state, {
        sketchId: "test-sketch",
        title: "Persisted Title",
      });

      const raw = await readFile(
        join(tmpDir, "test-sketch.genart"),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.title).toBe("Persisted Title");
    });

    it("rejects when no fields are provided", async () => {
      await expect(
        updateSketch(state, { sketchId: "test-sketch" }),
      ).rejects.toThrow("No fields to update");
    });

    it("rejects unknown sketch ID", async () => {
      await expect(
        updateSketch(state, { sketchId: "nope", title: "X" }),
      ).rejects.toThrow("Sketch not found: 'nope'");
    });

    it("rejects duplicate parameter keys", async () => {
      await expect(
        updateSketch(state, {
          sketchId: "test-sketch",
          parameters: [
            { key: "a", label: "A", min: 0, max: 1, step: 0.1, default: 0.5 },
            { key: "a", label: "A2", min: 0, max: 1, step: 0.1, default: 0.5 },
          ],
        }),
      ).rejects.toThrow("Duplicate parameter key: 'a'");
    });

    it("sets agent and model attribution", async () => {
      await updateSketch(state, {
        sketchId: "test-sketch",
        title: "Attributed Update",
        agent: "codex-cli",
        model: "gpt-4o",
      });

      const def = state.getSketch("test-sketch")!.definition;
      expect(def.agent).toBe("codex-cli");
      expect(def.model).toBe("gpt-4o");
    });
  });

  // -----------------------------------------------------------------------
  // update_algorithm
  // -----------------------------------------------------------------------

  describe("update_algorithm", () => {
    beforeEach(async () => {
      await setupWorkspace(tmpDir, state);
    });

    it("replaces the algorithm and validates", async () => {
      const result = await updateAlgorithm(state, {
        sketchId: "test-sketch",
        algorithm: UPDATED_ALGORITHM,
      });

      expect(result.success).toBe(true);
      expect(result.sketchId).toBe("test-sketch");
      expect(result.renderer).toBe("p5");
      expect(result.algorithmLength).toBe(UPDATED_ALGORITHM.length);
      expect(result.validationPassed).toBe(true);

      // Persisted
      const raw = await readFile(
        join(tmpDir, "test-sketch.genart"),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.algorithm).toBe(UPDATED_ALGORITHM);
    });

    it("skips validation when validate is false", async () => {
      const result = await updateAlgorithm(state, {
        sketchId: "test-sketch",
        algorithm: "// not a valid sketch function but that's ok",
        validate: false,
      });

      expect(result.success).toBe(true);
      expect(result.validationPassed).toBe(true);
    });

    it("rejects empty algorithm", async () => {
      await expect(
        updateAlgorithm(state, {
          sketchId: "test-sketch",
          algorithm: "",
        }),
      ).rejects.toThrow("Algorithm cannot be empty");
    });

    it("rejects whitespace-only algorithm", async () => {
      await expect(
        updateAlgorithm(state, {
          sketchId: "test-sketch",
          algorithm: "   ",
        }),
      ).rejects.toThrow("Algorithm cannot be empty");
    });

    it("rejects unknown sketch ID", async () => {
      await expect(
        updateAlgorithm(state, {
          sketchId: "nope",
          algorithm: VALID_ALGORITHM,
        }),
      ).rejects.toThrow("Sketch not found: 'nope'");
    });

    it("sets agent and model attribution", async () => {
      await updateAlgorithm(state, {
        sketchId: "test-sketch",
        algorithm: UPDATED_ALGORITHM,
        agent: "gemini-cli",
        model: "gemini-2.5-pro",
      });

      const def = state.getSketch("test-sketch")!.definition;
      expect(def.agent).toBe("gemini-cli");
      expect(def.model).toBe("gemini-2.5-pro");
    });

    it("updates algorithm with components", async () => {
      const result = await updateAlgorithm(state, {
        sketchId: "test-sketch",
        algorithm: UPDATED_ALGORITHM,
        components: { prng: "^1.0.0" },
      });

      expect(result.success).toBe(true);
      expect(result.componentsUpdated).toBe(true);

      const def = state.getSketch("test-sketch")!.definition;
      expect(def.components).toBeDefined();
      expect(def.components!.prng).toBeDefined();
      expect(def.genart).toBe("1.2");

      // Persisted
      const raw = await readFile(
        join(tmpDir, "test-sketch.genart"),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.components.prng.version).toBe("1.0.0");
    });

    it("updates algorithm without components (no componentsUpdated field)", async () => {
      const result = await updateAlgorithm(state, {
        sketchId: "test-sketch",
        algorithm: UPDATED_ALGORITHM,
      });

      expect(result.success).toBe(true);
      expect(result.componentsUpdated).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // save_sketch
  // -----------------------------------------------------------------------

  describe("save_sketch", () => {
    it("saves sketch to disk", async () => {
      await setupWorkspace(tmpDir, state);

      // Modify in-memory state
      const loaded = state.getSketch("test-sketch")!;
      state.sketches.set("test-sketch", {
        ...loaded,
        definition: { ...loaded.definition, title: "Modified Title" },
      });

      const result = await saveSketch(state, { sketchId: "test-sketch" });

      expect(result.success).toBe(true);
      expect(result.sketchId).toBe("test-sketch");
      expect(result.path).toContain("test-sketch.genart");

      // Verify on disk
      const raw = await readFile(
        join(tmpDir, "test-sketch.genart"),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.title).toBe("Modified Title");
    });

    it("rejects unknown sketch ID", async () => {
      await expect(
        saveSketch(state, { sketchId: "nope" }),
      ).rejects.toThrow("Sketch not found: 'nope'");
    });
  });

  // -----------------------------------------------------------------------
  // fork_sketch
  // -----------------------------------------------------------------------

  describe("fork_sketch", () => {
    beforeEach(async () => {
      await setupWorkspace(tmpDir, state);
    });

    it("forks a sketch with default settings", async () => {
      const result = await forkSketch(state, {
        sourceId: "test-sketch",
        newId: "test-sketch-fork",
      });

      expect(result.success).toBe(true);
      expect(result.sourceId).toBe("test-sketch");

      const forked = result.forkedSketch as Record<string, unknown>;
      expect(forked.id).toBe("test-sketch-fork");
      expect(forked.title).toBe("Test Sketch (fork)");
      expect(forked.renderer).toBe("p5");
      expect((forked.canvas as { width: number }).width).toBe(1200);
      expect(typeof forked.seed).toBe("number");

      // File exists on disk
      const raw = await readFile(
        join(tmpDir, "test-sketch-fork.genart"),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.id).toBe("test-sketch-fork");

      // Added to workspace
      expect(state.workspace!.sketches.length).toBe(2);
    });

    it("forks with custom title and position", async () => {
      const result = await forkSketch(state, {
        sourceId: "test-sketch",
        newId: "custom-fork",
        title: "My Custom Fork",
        position: { x: 5000, y: 1000 },
      });

      const forked = result.forkedSketch as Record<string, unknown>;
      expect(forked.title).toBe("My Custom Fork");
      expect(forked.position).toEqual({ x: 5000, y: 1000 });
    });

    it("forks with modifications", async () => {
      const result = await forkSketch(state, {
        sourceId: "test-sketch",
        newId: "modified-fork",
        modifications: {
          renderer: "canvas2d",
          canvas: { preset: "square-600" },
          algorithm: UPDATED_ALGORITHM,
        },
      });

      const forked = result.forkedSketch as Record<string, unknown>;
      expect(forked.renderer).toBe("canvas2d");
      expect((forked.canvas as { width: number }).width).toBe(600);

      const raw = await readFile(
        join(tmpDir, "modified-fork.genart"),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.algorithm).toBe(UPDATED_ALGORITHM);
    });

    it("preserves source seed when newSeed is false", async () => {
      const result = await forkSketch(state, {
        sourceId: "test-sketch",
        newId: "same-seed",
        newSeed: false,
      });

      const forked = result.forkedSketch as Record<string, unknown>;
      expect(forked.seed).toBe(42);
    });

    it("does not modify the source sketch", async () => {
      await forkSketch(state, {
        sourceId: "test-sketch",
        newId: "no-modify-fork",
        modifications: { philosophy: "New philosophy" },
      });

      const source = state.getSketch("test-sketch")!.definition;
      expect(source.philosophy).toBeUndefined();
    });

    it("rejects invalid newId", async () => {
      await expect(
        forkSketch(state, {
          sourceId: "test-sketch",
          newId: "BAD_ID",
        }),
      ).rejects.toThrow("ID must be kebab-case");
    });

    it("rejects duplicate newId", async () => {
      await expect(
        forkSketch(state, {
          sourceId: "test-sketch",
          newId: "test-sketch",
        }),
      ).rejects.toThrow("already exists in workspace");
    });

    it("rejects unknown source ID", async () => {
      await expect(
        forkSketch(state, {
          sourceId: "nonexistent",
          newId: "fork",
        }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when no workspace is open", async () => {
      const freshState = new EditorState();
      await expect(
        forkSketch(freshState, {
          sourceId: "test-sketch",
          newId: "fork",
        }),
      ).rejects.toThrow("No workspace is currently open");
    });

    it("sets agent and model on fork (not from source)", async () => {
      // First give the source attribution
      await updateSketch(state, {
        sketchId: "test-sketch",
        title: "Source",
        agent: "claude-code",
        model: "claude-opus-4-6",
      });

      // Fork with different agent
      await forkSketch(state, {
        sourceId: "test-sketch",
        newId: "fork-attr",
        agent: "codex-cli",
        model: "gpt-4o",
      });

      const forked = state.getSketch("fork-attr")!.definition;
      expect(forked.agent).toBe("codex-cli");
      expect(forked.model).toBe("gpt-4o");

      // Source unchanged
      const source = state.getSketch("test-sketch")!.definition;
      expect(source.agent).toBe("claude-code");
      expect(source.model).toBe("claude-opus-4-6");
    });
  });

  // -----------------------------------------------------------------------
  // delete_sketch
  // -----------------------------------------------------------------------

  describe("delete_sketch", () => {
    beforeEach(async () => {
      await setupWorkspace(tmpDir, state);
    });

    it("deletes a sketch and removes from workspace", async () => {
      const result = await deleteSketch(state, {
        sketchId: "test-sketch",
      });

      expect(result.success).toBe(true);
      expect(result.deletedId).toBe("test-sketch");
      expect(result.fileDeleted).toBe(true);
      expect(result.sketchCount).toBe(0);

      // File is gone
      await expect(
        stat(join(tmpDir, "test-sketch.genart")),
      ).rejects.toThrow();

      // Removed from state
      expect(state.getSketch("test-sketch")).toBeUndefined();
      expect(state.workspace!.sketches.length).toBe(0);
    });

    it("keeps file when keepFile is true", async () => {
      const result = await deleteSketch(state, {
        sketchId: "test-sketch",
        keepFile: true,
      });

      expect(result.fileDeleted).toBe(false);

      // File still exists
      const s = await stat(join(tmpDir, "test-sketch.genart"));
      expect(s.isFile()).toBe(true);

      // But removed from workspace
      expect(state.workspace!.sketches.length).toBe(0);
    });

    it("removes from selection", async () => {
      state.setSelection(["test-sketch"]);
      expect(state.selection.has("test-sketch")).toBe(true);

      await deleteSketch(state, { sketchId: "test-sketch" });

      expect(state.selection.has("test-sketch")).toBe(false);
    });

    it("persists workspace changes", async () => {
      await deleteSketch(state, { sketchId: "test-sketch" });

      const raw = await readFile(
        join(tmpDir, "test.genart-workspace"),
        "utf-8",
      );
      const parsed = JSON.parse(raw);
      expect(parsed.sketches.length).toBe(0);
    });

    it("rejects unknown sketch ID", async () => {
      await expect(
        deleteSketch(state, { sketchId: "nope" }),
      ).rejects.toThrow("Sketch not found: 'nope'");
    });

    it("rejects when no workspace is open", async () => {
      const freshState = new EditorState();
      await expect(
        deleteSketch(freshState, { sketchId: "test-sketch" }),
      ).rejects.toThrow("No workspace is currently open");
    });
  });

  // -----------------------------------------------------------------------
  // libraries support
  // -----------------------------------------------------------------------

  describe("create_sketch with libraries", () => {
    it("creates a sketch with p5.brush library", async () => {
      const path = join(tmpDir, "brush-sketch.genart");
      const result = await createSketch(state, {
        id: "brush-sketch",
        title: "Brush Sketch",
        path,
        renderer: "p5",
        libraries: ["p5.brush"],
      });

      expect(result.success).toBe(true);

      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);

      // Renderer version should be upgraded to 2.x
      expect(parsed.renderer.version).toBe("2.x");

      // Libraries should contain p5.brush dependency
      expect(parsed.libraries).toBeDefined();
      expect(parsed.libraries.length).toBe(1);
      expect(parsed.libraries[0].name).toBe("p5.brush");
      expect(parsed.libraries[0].version).toBe("2.0.3-beta");
      expect(parsed.libraries[0].cdnUrl).toContain("p5.brush");
    });

    it("creates a sketch without libraries (renderer version stays 1.x)", async () => {
      const path = join(tmpDir, "no-lib.genart");
      await createSketch(state, {
        id: "no-lib",
        title: "No Library",
        path,
      });

      const raw = await readFile(path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.renderer.version).toBe("1.x");
      expect(parsed.libraries).toBeUndefined();
    });

    it("rejects unknown library preset", async () => {
      await expect(
        createSketch(state, {
          id: "bad-lib",
          title: "Bad",
          path: join(tmpDir, "bad-lib.genart"),
          libraries: ["nonexistent-lib"],
        }),
      ).rejects.toThrow("Unknown library preset");
    });
  });

  describe("update_algorithm library warning", () => {
    beforeEach(async () => {
      await setupWorkspace(tmpDir, state);
    });

    it("warns when algorithm uses brush APIs but sketch lacks p5.brush", async () => {
      const result = await updateAlgorithm(state, {
        sketchId: "test-sketch",
        algorithm: `function sketch(p, state) {
  p.setup = () => { p.createCanvas(800, 800, p.WEBGL); };
  p.draw = () => { brush.fill("#ff0000", 100, 0.5); };
  return { initializeSystem() {} };
}`,
        validate: false,
      });

      expect(result.success).toBe(true);
      expect(result.libraryWarning).toBeDefined();
      expect(result.libraryWarning).toContain("p5.brush");
    });

    it("does not warn when algorithm uses brush APIs and sketch has p5.brush", async () => {
      // Create a sketch with p5.brush library
      const path = join(tmpDir, "brush-algo.genart");
      await createSketch(state, {
        id: "brush-algo",
        title: "Brush Algo",
        path,
        renderer: "p5",
        libraries: ["p5.brush"],
        addToWorkspace: join(tmpDir, "test.genart-workspace"),
      });

      const result = await updateAlgorithm(state, {
        sketchId: "brush-algo",
        algorithm: `function sketch(p, state) {
  p.setup = () => { p.createCanvas(800, 800, p.WEBGL); };
  p.draw = () => { brush.fill("#ff0000", 100, 0.5); };
  return { initializeSystem() {} };
}`,
        validate: false,
      });

      expect(result.success).toBe(true);
      expect(result.libraryWarning).toBeUndefined();
    });

    it("does not warn when algorithm has no brush APIs", async () => {
      const result = await updateAlgorithm(state, {
        sketchId: "test-sketch",
        algorithm: UPDATED_ALGORITHM,
      });

      expect(result.success).toBe(true);
      expect(result.libraryWarning).toBeUndefined();
    });
  });
});
