import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import { groupSketches } from "./arrangement.js";
import { snapshotLayout } from "./snapshot-layout.js";

const VALID_ALGORITHM = `function sketch(p, state) {
  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };
  p.draw = () => {};
  return { initializeSystem() {} };
}`;

function makeSketch(
  id: string,
  title: string,
  opts: { renderer?: string; width?: number; height?: number } = {},
): string {
  return JSON.stringify({
    genart: "1.1",
    id,
    title,
    created: "2026-02-14T00:00:00Z",
    modified: "2026-02-14T00:00:00Z",
    renderer: { type: opts.renderer ?? "p5", version: "1.x" },
    canvas: { width: opts.width ?? 1200, height: opts.height ?? 1200 },
    parameters: [
      { key: "count", label: "Count", min: 1, max: 100, step: 1, default: 10 },
      { key: "size", label: "Size", min: 1, max: 50, step: 1, default: 20 },
    ],
    colors: [
      { key: "bg", label: "Background", default: "#1a1a1a" },
      { key: "fg", label: "Foreground", default: "#ffffff" },
    ],
    state: {
      seed: 42,
      params: { count: 10, size: 20 },
      colorPalette: ["#1a1a1a", "#ffffff"],
    },
    algorithm: VALID_ALGORITHM,
    philosophy: "# Test\n\nA test sketch.",
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<string> {
  await writeFile(join(tmpDir, "s1.genart"), makeSketch("s1", "Sketch 1"));
  await writeFile(
    join(tmpDir, "s2.genart"),
    makeSketch("s2", "Sketch 2", { renderer: "canvas2d" }),
  );
  await writeFile(
    join(tmpDir, "s3.genart"),
    makeSketch("s3", "Sketch 3", { width: 1800, height: 1200 }),
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

describe("snapshot-layout tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-snapshot-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("snapshot_layout", () => {
    it("returns workspace layout summary", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await snapshotLayout(state, {});
      expect(result.success).toBe(true);

      const ws = result.workspace as Record<string, unknown>;
      expect(ws.id).toBe("test-workspace");
      expect(ws.title).toBe("Test Workspace");
      expect(ws.viewport).toBeDefined();
    });

    it("includes all sketches with positions and metadata", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await snapshotLayout(state, {});
      const sketches = result.sketches as Record<string, unknown>[];
      expect(sketches.length).toBe(3);

      const s1 = sketches.find((s) => s.id === "s1");
      expect(s1).toBeDefined();
      expect(s1!.title).toBe("Sketch 1");
      expect(s1!.renderer).toBe("p5");
      expect(s1!.position).toBeDefined();
      expect(s1!.canvas).toEqual({ width: 1200, height: 1200 });
      expect(s1!.parameterCount).toBe(2);
      expect(s1!.colorCount).toBe(2);
      expect(s1!.snapshotCount).toBe(0);
      expect(s1!.locked).toBe(false);
      expect(s1!.visible).toBe(true);
    });

    it("computes bounding box correctly", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await snapshotLayout(state, {});
      const bb = result.boundingBox as {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      expect(bb.x).toBe(0);
      expect(bb.y).toBe(0);
      // Row layout: s1(1200) + 200 + s2(1200) + 200 + s3(1800)
      expect(bb.width).toBeGreaterThan(0);
      expect(bb.height).toBeGreaterThan(0);
    });

    it("reports renderer breakdown", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await snapshotLayout(state, {});
      const breakdown = result.rendererBreakdown as Record<string, number>;
      expect(breakdown.p5).toBe(2);
      expect(breakdown.canvas2d).toBe(1);
    });

    it("reports total sketch count", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await snapshotLayout(state, {});
      expect(result.totalSketches).toBe(3);
    });

    it("includes groups by default", async () => {
      await setupWorkspace(tmpDir, state);

      // Create a group
      await groupSketches(state, {
        groupId: "series-1",
        label: "Series 1",
        sketchIds: ["s1", "s2"],
        color: "#ff0000",
      });

      const result = await snapshotLayout(state, {});
      const groups = result.groups as Record<string, unknown>[];
      expect(groups.length).toBe(1);
      expect(groups[0]!.id).toBe("series-1");
      expect(groups[0]!.label).toBe("Series 1");
      const sketchIds = groups[0]!.sketchIds as string[];
      expect(sketchIds).toContain("s1");
      expect(sketchIds).toContain("s2");
      expect(groups[0]!.color).toBe("#ff0000");
    });

    it("excludes groups when includeGroups is false", async () => {
      await setupWorkspace(tmpDir, state);

      await groupSketches(state, {
        groupId: "series-1",
        label: "Series 1",
        sketchIds: ["s1"],
      });

      const result = await snapshotLayout(state, { includeGroups: false });
      expect(result.groups).toBeUndefined();
    });

    it("excludes state by default", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await snapshotLayout(state, {});
      const sketches = result.sketches as Record<string, unknown>[];
      expect(sketches[0]!.state).toBeUndefined();
    });

    it("includes state when includeState is true", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await snapshotLayout(state, { includeState: true });
      const sketches = result.sketches as Record<string, unknown>[];
      const s1 = sketches.find((s) => s.id === "s1");
      expect(s1!.state).toBeDefined();
      const sketchState = s1!.state as Record<string, unknown>;
      expect(sketchState.seed).toBe(42);
      expect(sketchState.params).toEqual({ count: 10, size: 20 });
      expect(sketchState.colorPalette).toEqual(["#1a1a1a", "#ffffff"]);
    });

    it("rejects when no workspace is open", async () => {
      await expect(snapshotLayout(state, {})).rejects.toThrow(
        "No workspace is currently open",
      );
    });

    it("handles empty workspace (no sketches)", async () => {
      const wsPath = join(tmpDir, "empty.genart-workspace");
      await createWorkspace(state, {
        title: "Empty Workspace",
        path: wsPath,
      });

      const result = await snapshotLayout(state, {});
      expect(result.totalSketches).toBe(0);
      expect(result.sketches).toEqual([]);
      const bb = result.boundingBox as Record<string, number>;
      expect(bb.width).toBe(0);
      expect(bb.height).toBe(0);
    });
  });
});
