import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "./state.js";

/** Minimal valid .genart content. */
function makeSketch(id: string, title: string): string {
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
    algorithm:
      "function sketch(p, state) {\n  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };\n  p.draw = () => {};\n  return { initializeSystem() {} };\n}",
  });
}

/** Minimal valid .genart-workspace content. */
function makeWorkspace(
  id: string,
  title: string,
  sketches: { file: string; position: { x: number; y: number } }[],
): string {
  return JSON.stringify({
    "genart-workspace": "1.0",
    id,
    title,
    created: "2026-02-14T00:00:00Z",
    modified: "2026-02-14T00:00:00Z",
    viewport: { x: 0, y: 0, zoom: 1 },
    sketches,
  });
}

describe("EditorState", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-state-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("starts with null workspace and empty collections", () => {
    expect(state.workspacePath).toBeNull();
    expect(state.workspace).toBeNull();
    expect(state.sketches.size).toBe(0);
    expect(state.selection.size).toBe(0);
  });

  it("requireWorkspace throws when no workspace is open", () => {
    expect(() => state.requireWorkspace()).toThrow(
      "No workspace is currently open",
    );
  });

  it("requireSketch throws for unknown ID", () => {
    expect(() => state.requireSketch("missing")).toThrow(
      "Sketch not found: 'missing'",
    );
  });

  describe("loadWorkspace", () => {
    it("loads a workspace and all referenced sketches", async () => {
      // Write sketch files
      await writeFile(join(tmpDir, "a.genart"), makeSketch("sketch-a", "Sketch A"));
      await writeFile(join(tmpDir, "b.genart"), makeSketch("sketch-b", "Sketch B"));

      // Write workspace
      const wsPath = join(tmpDir, "test.genart-workspace");
      await writeFile(
        wsPath,
        makeWorkspace("test-ws", "Test Workspace", [
          { file: "a.genart", position: { x: 0, y: 0 } },
          { file: "b.genart", position: { x: 1400, y: 0 } },
        ]),
      );

      await state.loadWorkspace(wsPath);

      expect(state.workspacePath).toBe(wsPath);
      expect(state.workspace).not.toBeNull();
      expect(state.workspace!.id).toBe("test-ws");
      expect(state.sketches.size).toBe(2);
      expect(state.getSketch("sketch-a")).toBeDefined();
      expect(state.getSketch("sketch-b")).toBeDefined();
    });

    it("throws for missing sketch files", async () => {
      const wsPath = join(tmpDir, "bad.genart-workspace");
      await writeFile(
        wsPath,
        makeWorkspace("bad-ws", "Bad WS", [
          { file: "nonexistent.genart", position: { x: 0, y: 0 } },
        ]),
      );

      await expect(state.loadWorkspace(wsPath)).rejects.toThrow();
    });
  });

  describe("loadSketch", () => {
    it("loads and caches a sketch", async () => {
      const sketchPath = join(tmpDir, "c.genart");
      await writeFile(sketchPath, makeSketch("sketch-c", "Sketch C"));

      const def = await state.loadSketch(sketchPath);

      expect(def.id).toBe("sketch-c");
      expect(def.title).toBe("Sketch C");
      expect(state.getSketch("sketch-c")).toBeDefined();
      expect(state.getSketch("sketch-c")!.path).toBe(sketchPath);
    });
  });

  describe("saveWorkspace", () => {
    it("persists workspace changes to disk", async () => {
      await writeFile(join(tmpDir, "s.genart"), makeSketch("s", "S"));
      const wsPath = join(tmpDir, "save-test.genart-workspace");
      await writeFile(
        wsPath,
        makeWorkspace("save-ws", "Save WS", [
          { file: "s.genart", position: { x: 0, y: 0 } },
        ]),
      );

      await state.loadWorkspace(wsPath);
      expect(state.workspace!.title).toBe("Save WS");

      // Modify and save
      state.workspace = { ...state.workspace!, title: "Updated WS" };
      await state.saveWorkspace();

      // Reload and verify
      const state2 = new EditorState();
      await state2.loadWorkspace(wsPath);
      expect(state2.workspace!.title).toBe("Updated WS");
    });
  });

  describe("saveSketch", () => {
    it("persists sketch changes to disk", async () => {
      const sketchPath = join(tmpDir, "d.genart");
      await writeFile(sketchPath, makeSketch("sketch-d", "Sketch D"));

      await state.loadSketch(sketchPath);
      const loaded = state.requireSketch("sketch-d");

      // Mutate the definition
      state.sketches.set("sketch-d", {
        ...loaded,
        definition: { ...loaded.definition, title: "Updated D" },
      });

      await state.saveSketch("sketch-d");

      // Reload and verify
      const state2 = new EditorState();
      const def = await state2.loadSketch(sketchPath);
      expect(def.title).toBe("Updated D");
    });
  });

  describe("selection", () => {
    it("manages selection set", () => {
      state.setSelection(["a", "b"]);
      expect(state.selection.size).toBe(2);
      expect(state.selection.has("a")).toBe(true);

      state.setSelection(["c"]);
      expect(state.selection.size).toBe(1);
      expect(state.selection.has("a")).toBe(false);
      expect(state.selection.has("c")).toBe(true);
    });
  });

  describe("resolveSketchPath", () => {
    it("resolves relative path against workspace directory", async () => {
      await writeFile(join(tmpDir, "x.genart"), makeSketch("x", "X"));
      const wsPath = join(tmpDir, "resolve-test.genart-workspace");
      await writeFile(
        wsPath,
        makeWorkspace("r-ws", "R WS", [
          { file: "x.genart", position: { x: 0, y: 0 } },
        ]),
      );

      await state.loadWorkspace(wsPath);

      const resolved = state.resolveSketchPath("x.genart");
      expect(resolved).toBe(join(tmpDir, "x.genart"));
    });

    it("returns absolute paths as-is", async () => {
      await writeFile(join(tmpDir, "y.genart"), makeSketch("y", "Y"));
      const wsPath = join(tmpDir, "abs-test.genart-workspace");
      await writeFile(
        wsPath,
        makeWorkspace("a-ws", "A WS", [
          { file: "y.genart", position: { x: 0, y: 0 } },
        ]),
      );

      await state.loadWorkspace(wsPath);

      const absPath = "/absolute/path/to/sketch.genart";
      expect(state.resolveSketchPath(absPath)).toBe(absPath);
    });

    it("throws when no workspace is open", () => {
      expect(() => state.resolveSketchPath("relative.genart")).toThrow(
        "No workspace is currently open",
      );
    });
  });
});
