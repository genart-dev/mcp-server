import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import { listSketches, searchSketches } from "./gallery.js";

const VALID_ALGORITHM = `function sketch(p, state) {
  p.setup = () => { p.createCanvas(state.canvas.width, state.canvas.height); };
  p.draw = () => {};
  return { initializeSystem() {} };
}`;

function makeSketch(
  id: string,
  title: string,
  opts: {
    renderer?: string;
    width?: number;
    height?: number;
    paramCount?: number;
    philosophy?: string;
    skills?: string[];
  } = {},
): string {
  const renderer = opts.renderer ?? "p5";
  const width = opts.width ?? 1200;
  const height = opts.height ?? 1200;
  const params = [];
  for (let i = 0; i < (opts.paramCount ?? 1); i++) {
    params.push({
      key: `param${i}`,
      label: `Param ${i}`,
      min: 0,
      max: 100,
      step: 1,
      default: 50,
    });
  }
  return JSON.stringify({
    genart: "1.1",
    id,
    title,
    created: "2026-02-14T00:00:00Z",
    modified: "2026-02-14T00:00:00Z",
    renderer: { type: renderer, version: "1.x" },
    canvas: { width, height },
    parameters: params,
    colors: [{ key: "bg", label: "Background", default: "#1a1a1a" }],
    state: {
      seed: 42,
      params: Object.fromEntries(params.map((p) => [p.key, p.default])),
      colorPalette: ["#1a1a1a"],
    },
    algorithm: VALID_ALGORITHM,
    ...(opts.philosophy ? { philosophy: opts.philosophy } : {}),
    ...(opts.skills ? { skills: opts.skills } : {}),
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<string> {
  await writeFile(join(tmpDir, "s1.genart"), makeSketch("s1", "Noise Grid", { paramCount: 4, philosophy: "# Noise\n\nA noise grid." }));
  await writeFile(join(tmpDir, "s2.genart"), makeSketch("s2", "Wave Pattern", { renderer: "canvas2d", paramCount: 2 }));
  await writeFile(join(tmpDir, "s3.genart"), makeSketch("s3", "Color Fields", { paramCount: 6, skills: ["rhythm", "contrast"] }));

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

describe("gallery tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-gallery-"));
    state = new EditorState();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // list_sketches
  // -----------------------------------------------------------------------

  describe("list_sketches", () => {
    it("lists all .genart files in workspace directory", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await listSketches(state, {});
      expect(result.success).toBe(true);
      expect(result.total).toBe(3);
      expect(result.inWorkspace).toBe(3);
      expect(result.unreferenced).toBe(0);
    });

    it("includes unreferenced .genart files by default", async () => {
      await setupWorkspace(tmpDir, state);

      // Write an extra .genart file not in the workspace
      await writeFile(
        join(tmpDir, "extra.genart"),
        makeSketch("extra", "Extra Sketch"),
      );

      const result = await listSketches(state, {});
      expect(result.total).toBe(4);
      expect(result.inWorkspace).toBe(3);
      expect(result.unreferenced).toBe(1);

      const sketches = result.sketches as Record<string, unknown>[];
      const extra = sketches.find((s) => s.id === "extra");
      expect(extra).toBeDefined();
      expect(extra!.inWorkspace).toBe(false);
    });

    it("excludes unreferenced files when includeUnreferenced is false", async () => {
      await setupWorkspace(tmpDir, state);
      await writeFile(
        join(tmpDir, "extra.genart"),
        makeSketch("extra", "Extra Sketch"),
      );

      const result = await listSketches(state, { includeUnreferenced: false });
      expect(result.total).toBe(3);
      expect(result.unreferenced).toBe(0);
    });

    it("scans subdirectories when recursive is true", async () => {
      await setupWorkspace(tmpDir, state);
      const subDir = join(tmpDir, "subdir");
      await mkdir(subDir);
      await writeFile(
        join(subDir, "nested.genart"),
        makeSketch("nested", "Nested Sketch"),
      );

      const result = await listSketches(state, { recursive: true });
      expect(result.total).toBe(4);
      const sketches = result.sketches as Record<string, unknown>[];
      expect(sketches.some((s) => s.id === "nested")).toBe(true);
    });

    it("does not scan subdirectories by default", async () => {
      await setupWorkspace(tmpDir, state);
      const subDir = join(tmpDir, "subdir");
      await mkdir(subDir);
      await writeFile(
        join(subDir, "nested.genart"),
        makeSketch("nested", "Nested Sketch"),
      );

      const result = await listSketches(state, {});
      expect(result.total).toBe(3);
    });

    it("accepts an explicit directory parameter", async () => {
      await setupWorkspace(tmpDir, state);
      const otherDir = join(tmpDir, "other");
      await mkdir(otherDir);
      await writeFile(
        join(otherDir, "alt.genart"),
        makeSketch("alt", "Alt Sketch"),
      );

      const result = await listSketches(state, { directory: otherDir });
      expect(result.total).toBe(1);
      expect(result.directory).toBe(otherDir);
    });

    it("includes metadata in each sketch entry", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await listSketches(state, {});
      const sketches = result.sketches as Record<string, unknown>[];
      const s1 = sketches.find((s) => s.id === "s1");
      expect(s1).toBeDefined();
      expect(s1!.title).toBe("Noise Grid");
      expect(s1!.renderer).toBe("p5");
      expect(s1!.canvas).toEqual({ width: 1200, height: 1200 });
      expect(s1!.parameterCount).toBe(4);
      expect(s1!.colorCount).toBe(1);
      expect(s1!.inWorkspace).toBe(true);
      expect(s1!.modified).toBeDefined();
    });

    it("rejects when no workspace and no directory specified", async () => {
      await expect(listSketches(state, {})).rejects.toThrow(
        "No workspace is currently open and no directory specified",
      );
    });

    it("rejects when directory does not exist", async () => {
      await expect(
        listSketches(state, { directory: "/nonexistent/path" }),
      ).rejects.toThrow("Directory does not exist");
    });

    it("rejects directory outside sandbox when basePath is set", async () => {
      const sandboxState = new EditorState({ basePath: tmpDir });
      await expect(
        listSketches(sandboxState, { directory: "/etc" }),
      ).rejects.toThrow("Path escapes sandbox");
    });

    it("skips malformed .genart files gracefully", async () => {
      await setupWorkspace(tmpDir, state);
      await writeFile(join(tmpDir, "bad.genart"), "not valid json{{{");

      const result = await listSketches(state, {});
      // Should still return the 3 valid sketches
      expect(result.total).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // search_sketches
  // -----------------------------------------------------------------------

  describe("search_sketches", () => {
    it("searches by title substring (case-insensitive)", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { query: "noise" });
      expect(result.success).toBe(true);
      expect(result.total).toBe(1);
      const matches = result.matches as Record<string, unknown>[];
      expect(matches[0]!.id).toBe("s1");
    });

    it("searches by renderer type", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { renderer: "canvas2d" });
      expect(result.total).toBe(1);
      const matches = result.matches as Record<string, unknown>[];
      expect(matches[0]!.id).toBe("s2");
    });

    it("searches by minimum parameter count", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { minParameters: 4 });
      expect(result.total).toBe(2); // s1 (4) and s3 (6)
    });

    it("searches by maximum parameter count", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { maxParameters: 2 });
      expect(result.total).toBe(1); // s2 (2)
    });

    it("searches by canvas width", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { canvasWidth: 1200 });
      expect(result.total).toBe(3);
    });

    it("searches by philosophy presence", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { hasPhilosophy: true });
      expect(result.total).toBe(1); // s1
      const matches = result.matches as Record<string, unknown>[];
      expect(matches[0]!.id).toBe("s1");
    });

    it("searches by skills", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { skills: ["rhythm"] });
      expect(result.total).toBe(1);
      const matches = result.matches as Record<string, unknown>[];
      expect(matches[0]!.id).toBe("s3");
    });

    it("combines multiple filters (AND logic)", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, {
        renderer: "p5",
        minParameters: 4,
      });
      expect(result.total).toBe(2); // s1 (4 params, p5) and s3 (6 params, p5)
    });

    it("returns applied filters in response", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, {
        query: "noise",
        renderer: "p5",
      });
      const filters = result.filters as Record<string, unknown>;
      expect(filters.query).toBe("noise");
      expect(filters.renderer).toBe("p5");
    });

    it("returns empty matches when nothing matches", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { query: "nonexistent" });
      expect(result.total).toBe(0);
      expect(result.matches).toEqual([]);
    });

    it("rejects when no filters provided", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(searchSketches(state, {})).rejects.toThrow(
        "At least one search filter is required",
      );
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        searchSketches(state, { query: "test" }),
      ).rejects.toThrow("No workspace is currently open");
    });

    it("includes metadata in match entries", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await searchSketches(state, { query: "color" });
      const matches = result.matches as Record<string, unknown>[];
      expect(matches.length).toBe(1);
      expect(matches[0]!.id).toBe("s3");
      expect(matches[0]!.title).toBe("Color Fields");
      expect(matches[0]!.parameterCount).toBe(6);
      expect(matches[0]!.colorCount).toBe(1);
      expect(matches[0]!.snapshotCount).toBe(0);
      expect(matches[0]!.hasPhilosophy).toBe(false);
      expect(matches[0]!.skills).toEqual(["rhythm", "contrast"]);
    });
  });
});
