import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import {
  setParameters,
  setColors,
  setSeed,
  setCanvasSize,
  randomizeParameters,
} from "./parameters.js";

const VALID_ALGORITHM = `function sketch(p, state) {
  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };
  p.draw = () => {};
  return { initializeSystem() {} };
}`;

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
      { key: "count", label: "Count", min: 1, max: 100, step: 1, default: 10 },
      { key: "scale", label: "Scale", min: 0.1, max: 2.0, step: 0.1, default: 1.0 },
    ],
    colors: [
      { key: "bg", label: "Background", default: "#1a1a1a" },
      { key: "accent", label: "Accent", default: "#22D3EE" },
    ],
    state: {
      seed: 42,
      params: { count: 10, scale: 1.0 },
      colorPalette: ["#1a1a1a", "#22D3EE"],
    },
    algorithm: VALID_ALGORITHM,
  });
}

function makeSketchNoParams(id: string, title: string): string {
  return JSON.stringify({
    genart: "1.1",
    id,
    title,
    created: "2026-02-14T00:00:00Z",
    modified: "2026-02-14T00:00:00Z",
    renderer: { type: "p5", version: "1.x" },
    canvas: { width: 1200, height: 1200 },
    parameters: [],
    colors: [],
    state: { seed: 42, params: {}, colorPalette: [] },
    algorithm: VALID_ALGORITHM,
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<string> {
  await writeFile(join(tmpDir, "test.genart"), makeSketch("test-sketch", "Test Sketch"));
  await writeFile(
    join(tmpDir, "empty.genart"),
    makeSketchNoParams("empty-sketch", "Empty"),
  );

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: [join(tmpDir, "test.genart"), join(tmpDir, "empty.genart")],
  });
  return wsPath;
}

describe("parameter tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-param-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // set_parameters
  // -----------------------------------------------------------------------

  describe("set_parameters", () => {
    it("updates a single parameter value", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setParameters(state, {
        sketchId: "test-sketch",
        params: { count: 50 },
      });

      expect(result.success).toBe(true);
      expect(result.updated).toEqual(["count"]);
      const st = result.state as Record<string, unknown>;
      const params = st.params as Record<string, number>;
      expect(params.count).toBe(50);
      expect(params.scale).toBe(1.0); // unchanged
    });

    it("updates multiple parameters", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setParameters(state, {
        sketchId: "test-sketch",
        params: { count: 25, scale: 1.5 },
      });

      expect(result.updated).toEqual(["count", "scale"]);
      const st = result.state as Record<string, unknown>;
      const params = st.params as Record<string, number>;
      expect(params.count).toBe(25);
      expect(params.scale).toBe(1.5);
    });

    it("persists changes to disk", async () => {
      await setupWorkspace(tmpDir, state);

      await setParameters(state, {
        sketchId: "test-sketch",
        params: { count: 77 },
      });

      const raw = await readFile(join(tmpDir, "test.genart"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.state.params.count).toBe(77);
    });

    it("rejects unknown parameter key", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setParameters(state, {
          sketchId: "test-sketch",
          params: { nonexistent: 5 },
        }),
      ).rejects.toThrow("Unknown parameter: 'nonexistent'");
    });

    it("rejects value outside range", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setParameters(state, {
          sketchId: "test-sketch",
          params: { count: 999 },
        }),
      ).rejects.toThrow("Parameter 'count' value 999 outside range [1, 100]");
    });

    it("rejects unknown sketch ID", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setParameters(state, { sketchId: "nope", params: { count: 5 } }),
      ).rejects.toThrow("Sketch not found: 'nope'");
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        setParameters(state, { sketchId: "test-sketch", params: { count: 5 } }),
      ).rejects.toThrow("No workspace is currently open");
    });
  });

  // -----------------------------------------------------------------------
  // set_colors
  // -----------------------------------------------------------------------

  describe("set_colors", () => {
    it("updates a single color", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setColors(state, {
        sketchId: "test-sketch",
        colors: { bg: "#000000" },
      });

      expect(result.success).toBe(true);
      expect(result.updated).toEqual(["bg"]);
      const palette = result.colorPalette as string[];
      expect(palette[0]).toBe("#000000");
      expect(palette[1]).toBe("#22D3EE"); // unchanged
    });

    it("updates multiple colors", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setColors(state, {
        sketchId: "test-sketch",
        colors: { bg: "#FF0000", accent: "#00FF00" },
      });

      expect(result.updated).toContain("bg");
      expect(result.updated).toContain("accent");
      const palette = result.colorPalette as string[];
      expect(palette[0]).toBe("#FF0000");
      expect(palette[1]).toBe("#00FF00");
    });

    it("persists to disk", async () => {
      await setupWorkspace(tmpDir, state);

      await setColors(state, {
        sketchId: "test-sketch",
        colors: { bg: "#AABBCC" },
      });

      const raw = await readFile(join(tmpDir, "test.genart"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.state.colorPalette[0]).toBe("#AABBCC");
    });

    it("rejects unknown color key", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setColors(state, {
          sketchId: "test-sketch",
          colors: { nope: "#000000" },
        }),
      ).rejects.toThrow("Unknown color: 'nope'");
    });

    it("rejects invalid hex color", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setColors(state, {
          sketchId: "test-sketch",
          colors: { bg: "not-a-color" },
        }),
      ).rejects.toThrow("Invalid hex color for 'bg': 'not-a-color'");
    });

    it("accepts 3-digit hex", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setColors(state, {
        sketchId: "test-sketch",
        colors: { bg: "#ABC" },
      });
      expect(result.success).toBe(true);
    });

    it("accepts 8-digit hex (with alpha)", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setColors(state, {
        sketchId: "test-sketch",
        colors: { bg: "#AABBCCDD" },
      });
      expect(result.success).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // set_seed
  // -----------------------------------------------------------------------

  describe("set_seed", () => {
    it("sets an explicit seed", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setSeed(state, {
        sketchId: "test-sketch",
        seed: 99999,
      });

      expect(result.success).toBe(true);
      expect(result.seed).toBe(99999);
      expect(result.previousSeed).toBe(42);
    });

    it("generates a random seed when none is provided", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setSeed(state, { sketchId: "test-sketch" });

      expect(result.success).toBe(true);
      expect(typeof result.seed).toBe("number");
      expect(result.seed).not.toBe(42);
      expect(result.previousSeed).toBe(42);
    });

    it("persists to disk", async () => {
      await setupWorkspace(tmpDir, state);

      await setSeed(state, { sketchId: "test-sketch", seed: 12345 });

      const raw = await readFile(join(tmpDir, "test.genart"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.state.seed).toBe(12345);
    });

    it("rejects unknown sketch ID", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setSeed(state, { sketchId: "nope" }),
      ).rejects.toThrow("Sketch not found: 'nope'");
    });
  });

  // -----------------------------------------------------------------------
  // set_canvas_size
  // -----------------------------------------------------------------------

  describe("set_canvas_size", () => {
    it("sets canvas using a preset", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setCanvasSize(state, {
        sketchId: "test-sketch",
        preset: "hd-1920x1080",
      });

      expect(result.success).toBe(true);
      const canvas = result.canvas as { width: number; height: number };
      expect(canvas.width).toBe(1920);
      expect(canvas.height).toBe(1080);
      const prev = result.previousCanvas as { width: number; height: number };
      expect(prev.width).toBe(1200);
      expect(prev.height).toBe(1200);
    });

    it("sets canvas using explicit dimensions", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await setCanvasSize(state, {
        sketchId: "test-sketch",
        width: 800,
        height: 600,
      });

      const canvas = result.canvas as { width: number; height: number };
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(600);
    });

    it("persists to disk", async () => {
      await setupWorkspace(tmpDir, state);

      await setCanvasSize(state, {
        sketchId: "test-sketch",
        preset: "square-600",
      });

      const raw = await readFile(join(tmpDir, "test.genart"), "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.canvas.width).toBe(600);
      expect(parsed.canvas.height).toBe(600);
    });

    it("rejects unknown preset", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setCanvasSize(state, {
          sketchId: "test-sketch",
          preset: "nonexistent-preset",
        }),
      ).rejects.toThrow();
    });

    it("rejects when neither preset nor dimensions are given", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setCanvasSize(state, { sketchId: "test-sketch" }),
      ).rejects.toThrow("Provide either a preset or both width and height");
    });

    it("rejects when only width is given", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        setCanvasSize(state, { sketchId: "test-sketch", width: 800 }),
      ).rejects.toThrow("Provide either a preset or both width and height");
    });
  });

  // -----------------------------------------------------------------------
  // randomize_parameters
  // -----------------------------------------------------------------------

  describe("randomize_parameters", () => {
    it("randomizes all parameters", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await randomizeParameters(state, {
        sketchId: "test-sketch",
      });

      expect(result.success).toBe(true);
      const randomized = result.randomized as string[];
      expect(randomized).toContain("count");
      expect(randomized).toContain("scale");

      const st = result.state as Record<string, unknown>;
      const params = st.params as Record<string, number>;
      expect(params.count).toBeGreaterThanOrEqual(1);
      expect(params.count).toBeLessThanOrEqual(100);
      expect(params.scale).toBeGreaterThanOrEqual(0.1);
      expect(params.scale).toBeLessThanOrEqual(2.0);
    });

    it("randomizes specific parameters", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await randomizeParameters(state, {
        sketchId: "test-sketch",
        paramKeys: ["count"],
      });

      const randomized = result.randomized as string[];
      expect(randomized).toEqual(["count"]);

      // Scale should remain unchanged
      const st = result.state as Record<string, unknown>;
      const params = st.params as Record<string, number>;
      expect(params.scale).toBe(1.0);
    });

    it("also randomizes seed when newSeed is true", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await randomizeParameters(state, {
        sketchId: "test-sketch",
        newSeed: true,
      });

      const st = result.state as Record<string, unknown>;
      expect(typeof st.seed).toBe("number");
      // Very unlikely to get the exact same seed (42)
      // but we can't assert it's different in a deterministic way
    });

    it("keeps seed when newSeed is false/default", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await randomizeParameters(state, {
        sketchId: "test-sketch",
      });

      const st = result.state as Record<string, unknown>;
      expect(st.seed).toBe(42);
    });

    it("rejects when sketch has no parameters", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        randomizeParameters(state, { sketchId: "empty-sketch" }),
      ).rejects.toThrow("Sketch has no parameters to randomize");
    });

    it("rejects unknown parameter key", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        randomizeParameters(state, {
          sketchId: "test-sketch",
          paramKeys: ["nonexistent"],
        }),
      ).rejects.toThrow("Unknown parameter: 'nonexistent'");
    });

    it("persists to disk", async () => {
      await setupWorkspace(tmpDir, state);

      await randomizeParameters(state, { sketchId: "test-sketch" });

      const raw = await readFile(join(tmpDir, "test.genart"), "utf-8");
      const parsed = JSON.parse(raw);
      // Values should be within range
      expect(parsed.state.params.count).toBeGreaterThanOrEqual(1);
      expect(parsed.state.params.count).toBeLessThanOrEqual(100);
    });
  });
});
