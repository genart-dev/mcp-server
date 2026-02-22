import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import { arrangeSketches, autoArrange, groupSketches } from "./arrangement.js";

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
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<string> {
  await writeFile(join(tmpDir, "a.genart"), makeSketch("sketch-a", "Alpha"));
  await writeFile(join(tmpDir, "b.genart"), makeSketch("sketch-b", "Beta"));
  await writeFile(
    join(tmpDir, "c.genart"),
    makeSketch("sketch-c", "Charlie", 800, 600),
  );
  await writeFile(join(tmpDir, "d.genart"), makeSketch("sketch-d", "Delta"));

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: [
      join(tmpDir, "a.genart"),
      join(tmpDir, "b.genart"),
      join(tmpDir, "c.genart"),
      join(tmpDir, "d.genart"),
    ],
    arrangement: "grid",
    spacing: 200,
  });
  return wsPath;
}

describe("arrangement tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-arr-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // arrange_sketches
  // -----------------------------------------------------------------------

  describe("arrange_sketches", () => {
    it("moves sketches to explicit positions", async () => {
      const wsPath = await setupWorkspace(tmpDir, state);

      const result = await arrangeSketches(state, {
        positions: [
          { sketchId: "sketch-a", x: 0, y: 0 },
          { sketchId: "sketch-b", x: 2000, y: 0 },
        ],
      });

      expect(result.success).toBe(true);
      expect(result.moved).toBe(2);

      const positions = result.positions as { id: string; position: { x: number; y: number } }[];
      expect(positions[0]!.id).toBe("sketch-a");
      expect(positions[0]!.position).toEqual({ x: 0, y: 0 });
      expect(positions[1]!.id).toBe("sketch-b");
      expect(positions[1]!.position).toEqual({ x: 2000, y: 0 });
    });

    it("persists positions to disk", async () => {
      const wsPath = await setupWorkspace(tmpDir, state);

      await arrangeSketches(state, {
        positions: [{ sketchId: "sketch-a", x: 5000, y: 3000 }],
      });

      const raw = await readFile(wsPath, "utf-8");
      const parsed = JSON.parse(raw);
      const ref = parsed.sketches.find((s: { file: string }) => s.file === "a.genart");
      expect(ref.position).toEqual({ x: 5000, y: 3000 });
    });

    it("returns a viewport", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await arrangeSketches(state, {
        positions: [
          { sketchId: "sketch-a", x: 0, y: 0 },
          { sketchId: "sketch-b", x: 1400, y: 0 },
        ],
      });

      const vp = result.viewport as { x: number; y: number; zoom: number };
      expect(typeof vp.x).toBe("number");
      expect(typeof vp.y).toBe("number");
      expect(typeof vp.zoom).toBe("number");
    });

    it("rejects empty positions array", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        arrangeSketches(state, { positions: [] }),
      ).rejects.toThrow("At least one position is required");
    });

    it("rejects unknown sketch ID", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        arrangeSketches(state, {
          positions: [{ sketchId: "nonexistent", x: 0, y: 0 }],
        }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        arrangeSketches(state, {
          positions: [{ sketchId: "sketch-a", x: 0, y: 0 }],
        }),
      ).rejects.toThrow("No workspace is currently open");
    });
  });

  // -----------------------------------------------------------------------
  // auto_arrange
  // -----------------------------------------------------------------------

  describe("auto_arrange", () => {
    it("arranges all sketches in grid layout", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, { layout: "grid" });

      expect(result.success).toBe(true);
      expect(result.layout).toBe("grid");
      expect(result.arranged).toBe(4);

      const positions = result.positions as { id: string; position: { x: number; y: number } }[];
      expect(positions.length).toBe(4);
      // Grid with 4 items: ceil(sqrt(4)) = 2 columns
      // Positions should form a 2x2 grid
    });

    it("arranges in row layout", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, { layout: "row" });

      expect(result.layout).toBe("row");
      const positions = result.positions as { id: string; position: { x: number; y: number } }[];
      // All should have y=0
      for (const p of positions) {
        expect(p.position.y).toBe(0);
      }
      // Each x should be > previous
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i]!.position.x).toBeGreaterThan(positions[i - 1]!.position.x);
      }
    });

    it("arranges in column layout", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, { layout: "column" });

      expect(result.layout).toBe("column");
      const positions = result.positions as { id: string; position: { x: number; y: number } }[];
      // All should have x=0
      for (const p of positions) {
        expect(p.position.x).toBe(0);
      }
    });

    it("arranges in masonry layout", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, { layout: "masonry" });

      expect(result.layout).toBe("masonry");
      expect(result.arranged).toBe(4);
    });

    it("arranges only specific sketches", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, {
        sketchIds: ["sketch-a", "sketch-b"],
        layout: "row",
      });

      expect(result.arranged).toBe(2);
    });

    it("sorts by title", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, {
        layout: "row",
        sortBy: "title",
      });

      const positions = result.positions as { id: string }[];
      // Alpha, Beta, Charlie, Delta
      expect(positions[0]!.id).toBe("sketch-a");
      expect(positions[1]!.id).toBe("sketch-b");
      expect(positions[2]!.id).toBe("sketch-c");
      expect(positions[3]!.id).toBe("sketch-d");
    });

    it("uses custom spacing", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, {
        layout: "row",
        spacing: 500,
      });

      const positions = result.positions as { id: string; position: { x: number; y: number } }[];
      // Second sketch should be at width + 500
      expect(positions[1]!.position.x).toBe(1200 + 500);
    });

    it("uses custom origin", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, {
        layout: "grid",
        origin: { x: 1000, y: 2000 },
      });

      const positions = result.positions as { id: string; position: { x: number; y: number } }[];
      expect(positions[0]!.position.x).toBe(1000);
      expect(positions[0]!.position.y).toBe(2000);
    });

    it("returns bounding box", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, { layout: "grid" });

      const bb = result.boundingBox as { x: number; y: number; width: number; height: number };
      expect(bb.x).toBe(0);
      expect(bb.y).toBe(0);
      expect(bb.width).toBeGreaterThan(0);
      expect(bb.height).toBeGreaterThan(0);
    });

    it("returns viewport", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await autoArrange(state, { layout: "grid" });

      const vp = result.viewport as { x: number; y: number; zoom: number };
      expect(typeof vp.zoom).toBe("number");
      expect(vp.zoom).toBeGreaterThan(0);
      expect(vp.zoom).toBeLessThanOrEqual(1);
    });

    it("persists to disk", async () => {
      const wsPath = await setupWorkspace(tmpDir, state);

      await autoArrange(state, { layout: "row", spacing: 200 });

      const raw = await readFile(wsPath, "utf-8");
      const parsed = JSON.parse(raw);
      // First sketch at x=0, second at 1400 (1200 + 200)
      expect(parsed.sketches[0].position.x).toBe(0);
    });

    it("rejects unknown layout", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        autoArrange(state, { layout: "spiral" }),
      ).rejects.toThrow("Unknown layout: 'spiral'");
    });

    it("rejects unknown sketch ID in sketchIds", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        autoArrange(state, { sketchIds: ["nonexistent"] }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        autoArrange(state, {}),
      ).rejects.toThrow("No workspace is currently open");
    });
  });

  // -----------------------------------------------------------------------
  // group_sketches
  // -----------------------------------------------------------------------

  describe("group_sketches", () => {
    it("creates a new group", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await groupSketches(state, {
        groupId: "warm-tones",
        label: "Warm Tones",
        sketchIds: ["sketch-a", "sketch-b"],
        color: "#FF9800",
      });

      expect(result.success).toBe(true);
      const group = result.group as Record<string, unknown>;
      expect(group.id).toBe("warm-tones");
      expect(group.label).toBe("Warm Tones");
      expect((group.sketchFiles as string[]).length).toBe(2);
      expect(group.color).toBe("#FF9800");
      expect(result.groupCount).toBe(1);
    });

    it("persists group to disk", async () => {
      const wsPath = await setupWorkspace(tmpDir, state);

      await groupSketches(state, {
        groupId: "test-group",
        label: "Test Group",
        sketchIds: ["sketch-a"],
      });

      const raw = await readFile(wsPath, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.groups).toBeDefined();
      expect(parsed.groups.length).toBe(1);
      expect(parsed.groups[0].id).toBe("test-group");
    });

    it("replaces an existing group with the same ID", async () => {
      await setupWorkspace(tmpDir, state);

      await groupSketches(state, {
        groupId: "my-group",
        label: "V1",
        sketchIds: ["sketch-a"],
      });

      const result = await groupSketches(state, {
        groupId: "my-group",
        label: "V2",
        sketchIds: ["sketch-a", "sketch-b"],
      });

      expect(result.groupCount).toBe(1);
      const group = result.group as Record<string, unknown>;
      expect(group.label).toBe("V2");
      expect((group.sketchFiles as string[]).length).toBe(2);
    });

    it("creates multiple groups", async () => {
      await setupWorkspace(tmpDir, state);

      await groupSketches(state, {
        groupId: "group-1",
        label: "Group 1",
        sketchIds: ["sketch-a"],
      });

      const result = await groupSketches(state, {
        groupId: "group-2",
        label: "Group 2",
        sketchIds: ["sketch-b"],
      });

      expect(result.groupCount).toBe(2);
    });

    it("creates group without color", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await groupSketches(state, {
        groupId: "no-color",
        label: "No Color",
        sketchIds: ["sketch-a"],
      });

      const group = result.group as Record<string, unknown>;
      expect(group.color).toBeUndefined();
    });

    it("rejects empty sketchIds", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        groupSketches(state, {
          groupId: "empty",
          label: "Empty",
          sketchIds: [],
        }),
      ).rejects.toThrow("At least one sketch ID is required");
    });

    it("rejects unknown sketch ID", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        groupSketches(state, {
          groupId: "bad",
          label: "Bad",
          sketchIds: ["nonexistent"],
        }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        groupSketches(state, {
          groupId: "test",
          label: "Test",
          sketchIds: ["sketch-a"],
        }),
      ).rejects.toThrow("No workspace is currently open");
    });
  });
});
