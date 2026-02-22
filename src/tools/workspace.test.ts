import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import {
  createWorkspace,
  openWorkspace,
  addSketchToWorkspace,
  removeSketchFromWorkspace,
  listWorkspaceSketches,
} from "./workspace.js";

/** Minimal valid .genart content. */
function makeSketch(id: string, title: string, width = 1200, height = 1200): string {
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
    algorithm:
      "function sketch(p, state) {\n  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };\n  p.draw = () => {};\n  return { initializeSystem() {} };\n}",
  });
}

describe("workspace tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-ws-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // create_workspace
  // -----------------------------------------------------------------------

  describe("create_workspace", () => {
    it("creates an empty workspace", async () => {
      const wsPath = join(tmpDir, "new.genart-workspace");
      const result = await createWorkspace(state, {
        title: "New Workspace",
        path: wsPath,
      });

      expect(result.success).toBe(true);
      expect(result.path).toBe(wsPath);
      expect(result.title).toBe("New Workspace");
      expect(result.sketchCount).toBe(0);

      // File exists on disk
      const raw = await readFile(wsPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed["genart-workspace"]).toBe("1.0");
      expect(parsed.id).toBe("new-workspace");
      expect(parsed.title).toBe("New Workspace");
    });

    it("creates a workspace with initial sketches in row layout", async () => {
      await writeFile(join(tmpDir, "a.genart"), makeSketch("sketch-a", "A"));
      await writeFile(join(tmpDir, "b.genart"), makeSketch("sketch-b", "B"));

      const wsPath = join(tmpDir, "with-sketches.genart-workspace");
      const result = await createWorkspace(state, {
        title: "With Sketches",
        path: wsPath,
        sketches: [join(tmpDir, "a.genart"), join(tmpDir, "b.genart")],
        arrangement: "row",
        spacing: 200,
      });

      expect(result.success).toBe(true);
      expect(result.sketchCount).toBe(2);

      // State is loaded
      expect(state.workspace).not.toBeNull();
      expect(state.sketches.size).toBe(2);
    });

    it("rejects non-.genart-workspace extension", async () => {
      await expect(
        createWorkspace(state, { title: "Bad", path: join(tmpDir, "bad.json") }),
      ).rejects.toThrow("Path must end with .genart-workspace");
    });

    it("rejects if file already exists", async () => {
      const wsPath = join(tmpDir, "exists.genart-workspace");
      await writeFile(wsPath, "{}");

      await expect(
        createWorkspace(state, { title: "Dup", path: wsPath }),
      ).rejects.toThrow("Workspace already exists");
    });

    it("rejects if parent directory does not exist", async () => {
      const wsPath = join(tmpDir, "nonexistent", "test.genart-workspace");
      await expect(
        createWorkspace(state, { title: "No Parent", path: wsPath }),
      ).rejects.toThrow("Parent directory does not exist");
    });

    it("rejects if sketch file is missing", async () => {
      const wsPath = join(tmpDir, "missing.genart-workspace");
      await expect(
        createWorkspace(state, {
          title: "Missing Sketch",
          path: wsPath,
          sketches: [join(tmpDir, "missing.genart")],
        }),
      ).rejects.toThrow("Sketch file not found");
    });
  });

  // -----------------------------------------------------------------------
  // open_workspace
  // -----------------------------------------------------------------------

  describe("open_workspace", () => {
    it("opens an existing workspace", async () => {
      await writeFile(join(tmpDir, "s1.genart"), makeSketch("s1", "Sketch 1"));
      await writeFile(join(tmpDir, "s2.genart"), makeSketch("s2", "Sketch 2"));

      const wsPath = join(tmpDir, "open.genart-workspace");
      await writeFile(
        wsPath,
        JSON.stringify({
          "genart-workspace": "1.0",
          id: "open-ws",
          title: "Open WS",
          created: "2026-02-14T00:00:00Z",
          modified: "2026-02-14T00:00:00Z",
          viewport: { x: 0, y: 0, zoom: 0.5 },
          sketches: [
            { file: "s1.genart", position: { x: 0, y: 0 } },
            { file: "s2.genart", position: { x: 1400, y: 0 } },
          ],
        }),
      );

      const result = await openWorkspace(state, { path: wsPath });

      expect(result.success).toBe(true);
      expect(result.id).toBe("open-ws");
      expect(result.sketchCount).toBe(2);
      expect((result.sketches as unknown[]).length).toBe(2);
      expect(state.sketches.size).toBe(2);
    });

    it("rejects non-workspace extension", async () => {
      await expect(
        openWorkspace(state, { path: join(tmpDir, "bad.json") }),
      ).rejects.toThrow("Path must end with .genart-workspace");
    });

    it("rejects if file does not exist", async () => {
      await expect(
        openWorkspace(state, { path: join(tmpDir, "nope.genart-workspace") }),
      ).rejects.toThrow("Workspace not found");
    });
  });

  // -----------------------------------------------------------------------
  // add_sketch_to_workspace
  // -----------------------------------------------------------------------

  describe("add_sketch_to_workspace", () => {
    let wsPath: string;

    beforeEach(async () => {
      await writeFile(join(tmpDir, "existing.genart"), makeSketch("existing", "Existing"));
      wsPath = join(tmpDir, "add.genart-workspace");
      await createWorkspace(state, {
        title: "Add Test",
        path: wsPath,
        sketches: [join(tmpDir, "existing.genart")],
      });
    });

    it("adds a new sketch to the workspace", async () => {
      await writeFile(join(tmpDir, "new.genart"), makeSketch("new-sketch", "New"));

      const result = await addSketchToWorkspace(state, {
        sketchPath: join(tmpDir, "new.genart"),
        position: { x: 2000, y: 0 },
      });

      expect(result.success).toBe(true);
      expect(result.id).toBe("new-sketch");
      expect(result.sketchCount).toBe(2);

      // Persisted to disk
      const raw = await readFile(wsPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.sketches.length).toBe(2);
    });

    it("auto-positions when no position is given", async () => {
      await writeFile(join(tmpDir, "auto.genart"), makeSketch("auto-pos", "Auto"));

      const result = await addSketchToWorkspace(state, {
        sketchPath: join(tmpDir, "auto.genart"),
      });

      expect(result.success).toBe(true);
      const pos = result.position as { x: number; y: number };
      expect(pos.x).toBeGreaterThan(0);
    });

    it("rejects duplicate sketch", async () => {
      await expect(
        addSketchToWorkspace(state, {
          sketchPath: join(tmpDir, "existing.genart"),
        }),
      ).rejects.toThrow("already in the workspace");
    });

    it("rejects missing file", async () => {
      await expect(
        addSketchToWorkspace(state, {
          sketchPath: join(tmpDir, "ghost.genart"),
        }),
      ).rejects.toThrow("Sketch file not found");
    });

    it("rejects when no workspace is open", async () => {
      const freshState = new EditorState();
      await expect(
        addSketchToWorkspace(freshState, {
          sketchPath: join(tmpDir, "existing.genart"),
        }),
      ).rejects.toThrow("No workspace is currently open");
    });
  });

  // -----------------------------------------------------------------------
  // remove_sketch_from_workspace
  // -----------------------------------------------------------------------

  describe("remove_sketch_from_workspace", () => {
    let wsPath: string;

    beforeEach(async () => {
      await writeFile(join(tmpDir, "r1.genart"), makeSketch("r1", "R1"));
      await writeFile(join(tmpDir, "r2.genart"), makeSketch("r2", "R2"));
      wsPath = join(tmpDir, "remove.genart-workspace");
      await createWorkspace(state, {
        title: "Remove Test",
        path: wsPath,
        sketches: [join(tmpDir, "r1.genart"), join(tmpDir, "r2.genart")],
      });
    });

    it("removes a sketch from the workspace", async () => {
      const result = await removeSketchFromWorkspace(state, {
        sketchId: "r1",
      });

      expect(result.success).toBe(true);
      expect(result.removedId).toBe("r1");
      expect(result.sketchCount).toBe(1);
      expect(result.fileDeleted).toBe(false);
      expect(state.sketches.has("r1")).toBe(false);

      // Persisted to disk
      const raw = await readFile(wsPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.sketches.length).toBe(1);
    });

    it("deletes the file when deleteFile is true", async () => {
      const filePath = join(tmpDir, "r2.genart");

      const result = await removeSketchFromWorkspace(state, {
        sketchId: "r2",
        deleteFile: true,
      });

      expect(result.fileDeleted).toBe(true);

      // File should be gone
      await expect(stat(filePath)).rejects.toThrow();
    });

    it("rejects unknown sketch ID", async () => {
      await expect(
        removeSketchFromWorkspace(state, { sketchId: "nonexistent" }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });
  });

  // -----------------------------------------------------------------------
  // list_workspace_sketches
  // -----------------------------------------------------------------------

  describe("list_workspace_sketches", () => {
    beforeEach(async () => {
      await writeFile(join(tmpDir, "l1.genart"), makeSketch("l1", "List 1"));
      await writeFile(join(tmpDir, "l2.genart"), makeSketch("l2", "List 2"));

      const wsPath = join(tmpDir, "list.genart-workspace");
      await createWorkspace(state, {
        title: "List Test",
        path: wsPath,
        sketches: [join(tmpDir, "l1.genart"), join(tmpDir, "l2.genart")],
      });
    });

    it("lists all sketches with metadata", async () => {
      const result = await listWorkspaceSketches(state, {});

      expect(result.success).toBe(true);
      expect(result.sketchCount).toBe(2);
      const sketches = result.sketches as Record<string, unknown>[];
      expect(sketches.length).toBe(2);
      expect(sketches[0]!.renderer).toBe("p5");
      expect(sketches[0]!.parameterCount).toBe(1);
      expect(sketches[0]!.colorCount).toBe(1);
    });

    it("includes state when requested", async () => {
      const result = await listWorkspaceSketches(state, {
        includeState: true,
      });

      const sketches = result.sketches as Record<string, unknown>[];
      const firstState = sketches[0]!.state as Record<string, unknown>;
      expect(firstState).toBeDefined();
      expect(firstState.seed).toBe(42);
    });

    it("rejects when no workspace is open", async () => {
      const freshState = new EditorState();
      await expect(
        listWorkspaceSketches(freshState, {}),
      ).rejects.toThrow("No workspace is currently open");
    });
  });
});
