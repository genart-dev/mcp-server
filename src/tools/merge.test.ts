import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import { mergeSketches } from "./merge.js";

const VALID_ALGORITHM = `function sketch(p, state) {
  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };
  p.draw = () => {};
  return { initializeSystem() {} };
}`;

function makeSketch(
  id: string,
  title: string,
  opts: {
    width?: number;
    height?: number;
    params?: { key: string; label: string; min: number; max: number; step: number; default: number }[];
    colors?: { key: string; label: string; default: string }[];
    philosophy?: string;
    themes?: { name: string; colors: string[] }[];
    skills?: string[];
    renderer?: string;
  } = {},
): string {
  const params = opts.params ?? [
    { key: "count", label: "Count", min: 1, max: 100, step: 1, default: 10 },
  ];
  const colors = opts.colors ?? [
    { key: "bg", label: "Background", default: "#1a1a1a" },
  ];
  return JSON.stringify({
    genart: "1.1",
    id,
    title,
    created: "2026-02-14T00:00:00Z",
    modified: "2026-02-14T00:00:00Z",
    renderer: { type: opts.renderer ?? "p5", version: "1.x" },
    canvas: { width: opts.width ?? 1200, height: opts.height ?? 1200 },
    parameters: params,
    colors,
    ...(opts.philosophy ? { philosophy: opts.philosophy } : {}),
    ...(opts.themes ? { themes: opts.themes } : {}),
    ...(opts.skills ? { skills: opts.skills } : {}),
    state: {
      seed: 42,
      params: Object.fromEntries(params.map((p) => [p.key, p.default])),
      colorPalette: colors.map((c) => c.default),
    },
    algorithm: VALID_ALGORITHM,
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<string> {
  await writeFile(
    join(tmpDir, "s1.genart"),
    makeSketch("s1", "Sketch A", {
      params: [
        { key: "count", label: "Count", min: 1, max: 100, step: 1, default: 10 },
        { key: "size", label: "Size", min: 1, max: 50, step: 1, default: 20 },
      ],
      colors: [
        { key: "bg", label: "Background", default: "#1a1a1a" },
        { key: "fg", label: "Foreground", default: "#ffffff" },
      ],
    }),
  );
  await writeFile(
    join(tmpDir, "s2.genart"),
    makeSketch("s2", "Sketch B", {
      width: 1800,
      height: 1800,
      params: [
        { key: "density", label: "Density", min: 0, max: 1, step: 0.01, default: 0.5 },
        { key: "count", label: "Count", min: 1, max: 200, step: 1, default: 50 },
      ],
      colors: [
        { key: "primary", label: "Primary", default: "#ff0000" },
        { key: "bg", label: "Background", default: "#000000" },
      ],
    }),
  );
  await writeFile(
    join(tmpDir, "s3.genart"),
    makeSketch("s3", "Sketch C", {
      params: [
        { key: "angle", label: "Angle", min: 0, max: 360, step: 1, default: 45 },
      ],
      colors: [
        { key: "accent", label: "Accent", default: "#00ff00" },
      ],
    }),
  );

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: [
      join(tmpDir, "s1.genart"),
      join(tmpDir, "s2.genart"),
      join(tmpDir, "s3.genart"),
    ],
    arrangement: "row",
    spacing: 200,
  });
  return wsPath;
}

describe("merge tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-merge-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("merge_sketches", () => {
    it("merges two sketches with blend strategy (default)", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await mergeSketches(state, {
        sourceIds: ["s1", "s2"],
        newId: "merged",
        title: "Merged Sketch",
      });

      expect(result.success).toBe(true);
      expect(result.sketchId).toBe("merged");
      expect(result.strategy).toBe("blend");
      expect(result.sources).toEqual(["s1", "s2"]);
      // blend: union of params, first wins on conflict
      // s1 has count, size; s2 has density, count (conflict → s1 wins)
      expect(result.parameterCount).toBe(3); // count, size, density
      // s1 has bg, fg; s2 has primary, bg (conflict → s1 wins)
      expect(result.colorCount).toBe(3); // bg, fg, primary
    });

    it("writes merged sketch to disk", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await mergeSketches(state, {
        sourceIds: ["s1", "s2"],
        newId: "merged",
        title: "Merged Sketch",
      });

      const path = result.path as string;
      const raw = await readFile(path, "utf-8");
      const json = JSON.parse(raw);
      expect(json.id).toBe("merged");
      expect(json.title).toBe("Merged Sketch");
    });

    it("adds merged sketch to workspace", async () => {
      await setupWorkspace(tmpDir, state);

      await mergeSketches(state, {
        sourceIds: ["s1", "s2"],
        newId: "merged",
        title: "Merged Sketch",
      });

      expect(state.workspace!.sketches.length).toBe(4);
      expect(state.sketches.has("merged")).toBe(true);
    });

    it("uses largest canvas dimensions by default", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await mergeSketches(state, {
        sourceIds: ["s1", "s2"],
        newId: "merged",
        title: "Merged",
      });

      // s1 is 1200x1200, s2 is 1800x1800
      const loaded = state.getSketch("merged")!;
      expect(loaded.definition.canvas.width).toBe(1800);
      expect(loaded.definition.canvas.height).toBe(1800);
      expect(result.renderer).toBe("p5");
    });

    it("allows explicit canvas size override", async () => {
      await setupWorkspace(tmpDir, state);

      await mergeSketches(state, {
        sourceIds: ["s1", "s2"],
        newId: "merged",
        title: "Merged",
        canvas: { width: 800, height: 600 },
      });

      const loaded = state.getSketch("merged")!;
      expect(loaded.definition.canvas.width).toBe(800);
      expect(loaded.definition.canvas.height).toBe(600);
    });

    it("merges with layer strategy (namespaced params)", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await mergeSketches(state, {
        sourceIds: ["s1", "s2"],
        newId: "layered",
        title: "Layered",
        strategy: "layer",
      });

      expect(result.strategy).toBe("layer");
      // layer: all params namespaced (source1_count, source1_size, source2_density, source2_count)
      expect(result.parameterCount).toBe(4);

      const loaded = state.getSketch("layered")!;
      const keys = loaded.definition.parameters.map((p) => p.key);
      expect(keys).toContain("source1_count");
      expect(keys).toContain("source1_size");
      expect(keys).toContain("source2_density");
      expect(keys).toContain("source2_count");

      // Algorithm should be empty placeholder with merge comment
      expect(loaded.definition.algorithm).toContain("// Merged from:");
      expect(loaded.definition.algorithm).toContain("// Strategy: layer");
    });

    it("merges with alternate strategy", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await mergeSketches(state, {
        sourceIds: ["s1", "s2", "s3"],
        newId: "alt",
        title: "Alternated",
        strategy: "alternate",
      });

      expect(result.strategy).toBe("alternate");
      // alternate params: odd-indexed sources (index 0 = s1, index 2 = s3)
      // s1: count, size; s3: angle
      expect(result.parameterCount).toBe(3);

      // alternate colors: even-indexed sources (index 1 = s2)
      // s2: primary, bg
      expect(result.colorCount).toBe(2);
    });

    it("rejects fewer than 2 sources", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        mergeSketches(state, {
          sourceIds: ["s1"],
          newId: "merged",
          title: "Merged",
        }),
      ).rejects.toThrow("At least 2 source sketches are required");
    });

    it("rejects unknown source sketch", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        mergeSketches(state, {
          sourceIds: ["s1", "nonexistent"],
          newId: "merged",
          title: "Merged",
        }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects duplicate newId", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        mergeSketches(state, {
          sourceIds: ["s1", "s2"],
          newId: "s1",
          title: "Duplicate",
        }),
      ).rejects.toThrow("Sketch with ID 's1' already exists");
    });

    it("rejects unknown strategy", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        mergeSketches(state, {
          sourceIds: ["s1", "s2"],
          newId: "merged",
          title: "Merged",
          strategy: "invalid",
        }),
      ).rejects.toThrow("Unknown merge strategy: 'invalid'");
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        mergeSketches(state, {
          sourceIds: ["s1", "s2"],
          newId: "merged",
          title: "Merged",
        }),
      ).rejects.toThrow("No workspace is currently open");
    });

    it("initializes state with default param values", async () => {
      await setupWorkspace(tmpDir, state);

      await mergeSketches(state, {
        sourceIds: ["s1", "s2"],
        newId: "merged",
        title: "Merged",
      });

      const loaded = state.getSketch("merged")!;
      const params = loaded.definition.state.params;
      // count from s1 (default: 10), size from s1 (default: 20), density from s2 (default: 0.5)
      expect(params.count).toBe(10);
      expect(params.size).toBe(20);
      expect(params.density).toBe(0.5);
    });

    it("produces empty algorithm placeholder for AI synthesis", async () => {
      await setupWorkspace(tmpDir, state);

      await mergeSketches(state, {
        sourceIds: ["s1", "s2"],
        newId: "merged",
        title: "Merged",
      });

      const loaded = state.getSketch("merged")!;
      expect(loaded.definition.algorithm).toContain("// Merged from: s1, s2");
      expect(loaded.definition.algorithm).toContain("// Strategy: blend");
      expect(loaded.definition.algorithm).toContain("// TODO:");
      // Should NOT contain the original algorithm code
      expect(loaded.definition.algorithm).not.toContain("p.setup");
    });

    it("concatenates philosophies from sources", async () => {
      // Write sketches with philosophies
      await writeFile(
        join(tmpDir, "p1.genart"),
        makeSketch("p1", "Philo A", {
          philosophy: "Explore the tension between order and chaos.",
        }),
      );
      await writeFile(
        join(tmpDir, "p2.genart"),
        makeSketch("p2", "Philo B", {
          philosophy: "Light emerges from darkness.",
        }),
      );

      const wsPath = join(tmpDir, "test.genart-workspace");
      await createWorkspace(state, {
        title: "Test",
        path: wsPath,
        sketches: [join(tmpDir, "p1.genart"), join(tmpDir, "p2.genart")],
        arrangement: "row",
        spacing: 200,
      });

      await mergeSketches(state, {
        sourceIds: ["p1", "p2"],
        newId: "philo-merged",
        title: "Philosophy Merged",
      });

      const loaded = state.getSketch("philo-merged")!;
      expect(loaded.definition.philosophy).toContain("Philo A");
      expect(loaded.definition.philosophy).toContain("order and chaos");
      expect(loaded.definition.philosophy).toContain("Philo B");
      expect(loaded.definition.philosophy).toContain("darkness");
    });

    it("merges themes with deduplication", async () => {
      await writeFile(
        join(tmpDir, "t1.genart"),
        makeSketch("t1", "Theme A", {
          themes: [
            { name: "Neon", colors: ["#00ff00", "#ff00ff"] },
            { name: "Earth", colors: ["#8B4513", "#2E8B57"] },
          ],
        }),
      );
      await writeFile(
        join(tmpDir, "t2.genart"),
        makeSketch("t2", "Theme B", {
          themes: [
            { name: "Neon", colors: ["#ff0000", "#0000ff"] },
            { name: "Ocean", colors: ["#0077be", "#20b2aa"] },
          ],
        }),
      );

      const wsPath = join(tmpDir, "test.genart-workspace");
      await createWorkspace(state, {
        title: "Test",
        path: wsPath,
        sketches: [join(tmpDir, "t1.genart"), join(tmpDir, "t2.genart")],
        arrangement: "row",
        spacing: 200,
      });

      await mergeSketches(state, {
        sourceIds: ["t1", "t2"],
        newId: "theme-merged",
        title: "Theme Merged",
      });

      const loaded = state.getSketch("theme-merged")!;
      const themes = loaded.definition.themes!;
      expect(themes).toHaveLength(3); // Neon (first wins), Earth, Ocean
      expect(themes.map((t) => t.name)).toEqual(["Neon", "Earth", "Ocean"]);
      // Neon from t1 should win
      expect(themes[0].colors).toEqual(["#00ff00", "#ff00ff"]);
    });

    it("merges skills as union", async () => {
      await writeFile(
        join(tmpDir, "sk1.genart"),
        makeSketch("sk1", "Skill A", {
          skills: ["golden-ratio", "color-harmony"],
        }),
      );
      await writeFile(
        join(tmpDir, "sk2.genart"),
        makeSketch("sk2", "Skill B", {
          skills: ["color-harmony", "gestalt-grouping"],
        }),
      );

      const wsPath = join(tmpDir, "test.genart-workspace");
      await createWorkspace(state, {
        title: "Test",
        path: wsPath,
        sketches: [join(tmpDir, "sk1.genart"), join(tmpDir, "sk2.genart")],
        arrangement: "row",
        spacing: 200,
      });

      await mergeSketches(state, {
        sourceIds: ["sk1", "sk2"],
        newId: "skill-merged",
        title: "Skill Merged",
      });

      const loaded = state.getSketch("skill-merged")!;
      const skills = loaded.definition.skills!;
      expect(skills).toHaveLength(3);
      expect(skills).toContain("golden-ratio");
      expect(skills).toContain("color-harmony");
      expect(skills).toContain("gestalt-grouping");
    });

    it("handles cross-renderer merge with notice", async () => {
      await writeFile(
        join(tmpDir, "cr1.genart"),
        makeSketch("cr1", "P5 Sketch"),
      );
      await writeFile(
        join(tmpDir, "cr2.genart"),
        makeSketch("cr2", "SVG Sketch", { renderer: "svg" }),
      );

      const wsPath = join(tmpDir, "test.genart-workspace");
      await createWorkspace(state, {
        title: "Test",
        path: wsPath,
        sketches: [join(tmpDir, "cr1.genart"), join(tmpDir, "cr2.genart")],
        arrangement: "row",
        spacing: 200,
      });

      const result = await mergeSketches(state, {
        sourceIds: ["cr1", "cr2"],
        newId: "cross-merged",
        title: "Cross Merged",
        renderer: "canvas2d",
      });

      expect(result.renderer).toBe("canvas2d");
      expect(result.crossRendererNotice).toContain("canvas2d");
    });
  });
});
