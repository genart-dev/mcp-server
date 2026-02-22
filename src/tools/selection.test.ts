import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import { getSelection, selectSketch, getEditorState } from "./selection.js";

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
    ],
    colors: [{ key: "bg", label: "Background", default: "#1a1a1a" }],
    state: { seed: 42, params: { count: 10 }, colorPalette: ["#1a1a1a"] },
    algorithm: VALID_ALGORITHM,
    philosophy: "# Test\n\nA test sketch.",
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<string> {
  await writeFile(join(tmpDir, "s1.genart"), makeSketch("s1", "Sketch 1"));
  await writeFile(join(tmpDir, "s2.genart"), makeSketch("s2", "Sketch 2"));
  await writeFile(join(tmpDir, "s3.genart"), makeSketch("s3", "Sketch 3"));

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

describe("selection tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-sel-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // get_selection
  // -----------------------------------------------------------------------

  describe("get_selection", () => {
    it("returns empty selection when nothing is selected", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await getSelection(state, {});
      expect(result.selected).toEqual([]);
      expect(result.workspace).toBeDefined();
      const ws = result.workspace as Record<string, unknown>;
      expect(ws.sketchCount).toBe(3);
    });

    it("returns selected sketch with full context", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await getSelection(state, {
        includeAlgorithm: true,
        includePhilosophy: true,
      });

      const selected = result.selected as Record<string, unknown>[];
      expect(selected.length).toBe(1);
      expect(selected[0]!.id).toBe("s1");
      expect(selected[0]!.title).toBe("Sketch 1");
      expect(selected[0]!.algorithm).toBe(VALID_ALGORITHM);
      expect(selected[0]!.philosophy).toBe("# Test\n\nA test sketch.");
      expect(selected[0]!.parameters).toBeDefined();
      expect(selected[0]!.colors).toBeDefined();
    });

    it("excludes algorithm when includeAlgorithm is false", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await getSelection(state, { includeAlgorithm: false });
      const selected = result.selected as Record<string, unknown>[];
      expect(selected[0]!.algorithm).toBeUndefined();
    });

    it("excludes philosophy when includePhilosophy is false", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await getSelection(state, { includePhilosophy: false });
      const selected = result.selected as Record<string, unknown>[];
      expect(selected[0]!.philosophy).toBeUndefined();
    });

    it("includes neighbors when requested", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await getSelection(state, { includeNeighbors: true });
      const neighbors = result.neighbors as Record<string, unknown>[];
      // s2 and s3 should be neighbors (within 2000px in a row layout)
      expect(neighbors.length).toBeGreaterThan(0);
      expect(neighbors.some((n) => n.id === "s2")).toBe(true);
    });

    it("returns multiple selected sketches", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1", "s2"]);

      const result = await getSelection(state, {});
      const selected = result.selected as Record<string, unknown>[];
      expect(selected.length).toBe(2);
    });

    it("rejects when no workspace is open", async () => {
      await expect(getSelection(state, {})).rejects.toThrow(
        "No workspace is currently open",
      );
    });
  });

  // -----------------------------------------------------------------------
  // select_sketch
  // -----------------------------------------------------------------------

  describe("select_sketch", () => {
    it("selects a single sketch", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await selectSketch(state, { sketchIds: ["s1"] });
      expect(result.success).toBe(true);
      expect(result.selected).toEqual(["s1"]);
      expect(result.selectionCount).toBe(1);
      expect(state.selection.has("s1")).toBe(true);
    });

    it("selects multiple sketches", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await selectSketch(state, {
        sketchIds: ["s1", "s2"],
      });
      expect(result.selectionCount).toBe(2);
    });

    it("replaces selection by default", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      await selectSketch(state, { sketchIds: ["s2"] });
      expect(state.selection.has("s1")).toBe(false);
      expect(state.selection.has("s2")).toBe(true);
    });

    it("adds to selection when addToSelection is true", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      await selectSketch(state, {
        sketchIds: ["s2"],
        addToSelection: true,
      });
      expect(state.selection.has("s1")).toBe(true);
      expect(state.selection.has("s2")).toBe(true);
    });

    it("rejects empty sketchIds", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        selectSketch(state, { sketchIds: [] }),
      ).rejects.toThrow("At least one sketch ID is required");
    });

    it("rejects unknown sketch ID", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        selectSketch(state, { sketchIds: ["nonexistent"] }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        selectSketch(state, { sketchIds: ["s1"] }),
      ).rejects.toThrow("No workspace is currently open");
    });
  });

  // -----------------------------------------------------------------------
  // get_editor_state
  // -----------------------------------------------------------------------

  describe("get_editor_state", () => {
    it("returns empty state when no workspace is open", async () => {
      const result = await getEditorState(state);
      expect(result.hasWorkspace).toBe(false);
      expect(result.workspace).toBeNull();
      expect(result.selection).toEqual([]);
      expect(result.sketches).toEqual([]);
    });

    it("returns full state with workspace open", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await getEditorState(state);
      expect(result.hasWorkspace).toBe(true);

      const ws = result.workspace as Record<string, unknown>;
      expect(ws.id).toBe("test-workspace");
      expect(ws.title).toBe("Test Workspace");
      expect(ws.sketchCount).toBe(3);

      expect(result.selection).toEqual(["s1"]);

      const sketches = result.sketches as Record<string, unknown>[];
      expect(sketches.length).toBe(3);
      expect(sketches[0]!.renderer).toBe("p5");
      expect(sketches[0]!.parameterCount).toBe(1);
      expect(sketches[0]!.colorCount).toBe(1);
    });
  });
});
