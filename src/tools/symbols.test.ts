import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import { searchSymbolsTool, listSymbolCategoriesTool, addSymbol, removeSymbol, createSymbol } from "./symbols.js";

const CANVAS2D_ALGORITHM = `function sketch(ctx, state) {
  function initializeSystem() {
    ctx.clearRect(0, 0, state.canvas.width, state.canvas.height);
  }
  return { initializeSystem };
}`;

const GLSL_ALGORITHM = `#version 300 es
precision highp float;
uniform vec2 u_resolution;
out vec4 fragColor;
void main() {
  fragColor = vec4(1.0);
}`;

async function setupCanvas2dSketch(tmpDir: string, state: EditorState): Promise<{ wsPath: string; sketchPath: string }> {
  const sketchPath = join(tmpDir, "test-sketch.genart");
  await writeFile(sketchPath, JSON.stringify({
    genart: "1.2",
    id: "test-sketch",
    title: "Test Sketch",
    created: "2026-03-04T00:00:00Z",
    modified: "2026-03-04T00:00:00Z",
    renderer: { type: "canvas2d" },
    canvas: { width: 800, height: 600 },
    parameters: [],
    colors: [],
    state: { seed: 42, params: {}, colorPalette: [] },
    algorithm: CANVAS2D_ALGORITHM,
  }));
  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, { title: "Test", path: wsPath, sketches: [sketchPath] });
  return { wsPath, sketchPath };
}

async function setupGlslSketch(tmpDir: string, state: EditorState): Promise<{ wsPath: string; sketchPath: string }> {
  const sketchPath = join(tmpDir, "glsl-sketch.genart");
  await writeFile(sketchPath, JSON.stringify({
    genart: "1.2",
    id: "glsl-sketch",
    title: "GLSL Sketch",
    created: "2026-03-04T00:00:00Z",
    modified: "2026-03-04T00:00:00Z",
    renderer: { type: "glsl" },
    canvas: { width: 800, height: 600 },
    parameters: [],
    colors: [],
    state: { seed: 42, params: {}, colorPalette: [] },
    algorithm: GLSL_ALGORITHM,
  }));
  const wsPath = join(tmpDir, "glsl.genart-workspace");
  await createWorkspace(state, { title: "GLSL", path: wsPath, sketches: [sketchPath] });
  return { wsPath, sketchPath };
}

let tmpDir: string;
let state: EditorState;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "symbol-tools-test-"));
  state = new EditorState();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// search_symbols
// ---------------------------------------------------------------------------

describe("searchSymbolsTool", () => {
  it("returns symbols with no filter", async () => {
    const result = await searchSymbolsTool(state, {});
    expect((result.count as number)).toBeGreaterThan(0);
    const symbols = result.symbols as Array<Record<string, unknown>>;
    expect(symbols.length).toBeGreaterThan(0);
  });

  it("filters by keyword", async () => {
    const result = await searchSymbolsTool(state, { query: "tree" });
    const symbols = result.symbols as Array<{ id: string; tags: string[] }>;
    expect(symbols.length).toBeGreaterThan(0);
    for (const s of symbols) {
      const haystack = [s.id, ...s.tags].join(" ").toLowerCase();
      expect(haystack).toContain("tree");
    }
  });

  it("filters by category", async () => {
    const result = await searchSymbolsTool(state, { category: "nature" });
    const symbols = result.symbols as Array<{ category: string }>;
    for (const s of symbols) {
      expect(s.category).toBe("nature");
    }
  });

  it("respects limit", async () => {
    const result = await searchSymbolsTool(state, { limit: 3 });
    expect((result.symbols as unknown[]).length).toBeLessThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// list_symbol_categories
// ---------------------------------------------------------------------------

describe("listSymbolCategoriesTool", () => {
  it("returns categories with counts", async () => {
    const result = await listSymbolCategoriesTool(state);
    expect((result.total as number)).toBeGreaterThan(0);
    const cats = result.categories as Array<{ category: string; count: number }>;
    expect(cats.length).toBeGreaterThan(0);
    for (const c of cats) {
      expect(c.category).toBeTruthy();
      expect(c.count).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// add_symbol
// ---------------------------------------------------------------------------

describe("addSymbol", () => {
  it("adds a symbol to a canvas2d sketch", async () => {
    const { sketchPath } = await setupCanvas2dSketch(tmpDir, state);
    const result = await addSymbol(state, { sketchId: "test-sketch", symbol: "pine-tree" });
    expect(result.success).toBe(true);
    expect(result.added).toContain("pine-tree");

    // Verify it's saved to file
    const sketch = state.requireSketch("test-sketch");
    expect(sketch.definition.symbols?.["pine-tree"]).toBeDefined();
    expect(sketch.definition.genart).toBe("1.3");
    expect(sketchPath).toBeTruthy(); // confirm we have a real path
  });

  it("adds symbol-draw component automatically", async () => {
    await setupCanvas2dSketch(tmpDir, state);
    await addSymbol(state, { sketchId: "test-sketch", symbol: "pine-tree" });
    const sketch = state.requireSketch("test-sketch");
    expect(sketch.definition.components?.["symbol-draw"]).toBeDefined();
  });

  it("supports style variant", async () => {
    await setupCanvas2dSketch(tmpDir, state);
    await addSymbol(state, { sketchId: "test-sketch", symbol: "pine-tree", style: "silhouette" });
    const sketch = state.requireSketch("test-sketch");
    const sym = sketch.definition.symbols?.["pine-tree"];
    expect(sym && typeof sym === "object" ? sym.style : null).toBe("silhouette");
  });

  it("throws for unknown symbol", async () => {
    await setupCanvas2dSketch(tmpDir, state);
    await expect(addSymbol(state, { sketchId: "test-sketch", symbol: "nonexistent-xyz" }))
      .rejects.toThrow(/Unknown symbol/);
  });

  it("throws for GLSL renderer", async () => {
    await setupGlslSketch(tmpDir, state);
    await expect(addSymbol(state, { sketchId: "glsl-sketch", symbol: "pine-tree" }))
      .rejects.toThrow(/JS-based renderer/);
  });

  it("throws for duplicate symbol", async () => {
    await setupCanvas2dSketch(tmpDir, state);
    await addSymbol(state, { sketchId: "test-sketch", symbol: "pine-tree" });
    await expect(addSymbol(state, { sketchId: "test-sketch", symbol: "pine-tree" }))
      .rejects.toThrow(/already present/);
  });
});

// ---------------------------------------------------------------------------
// remove_symbol
// ---------------------------------------------------------------------------

describe("removeSymbol", () => {
  it("removes an existing symbol", async () => {
    await setupCanvas2dSketch(tmpDir, state);
    await addSymbol(state, { sketchId: "test-sketch", symbol: "pine-tree" });
    const result = await removeSymbol(state, { sketchId: "test-sketch", symbol: "pine-tree" });
    expect(result.success).toBe(true);
    expect(result.removed).toBe("pine-tree");
    const sketch = state.requireSketch("test-sketch");
    expect(sketch.definition.symbols?.["pine-tree"]).toBeUndefined();
  });

  it("throws when symbol not present", async () => {
    await setupCanvas2dSketch(tmpDir, state);
    await expect(removeSymbol(state, { sketchId: "test-sketch", symbol: "pine-tree" }))
      .rejects.toThrow(/not present/);
  });

  it("warns when algorithm references the symbol", async () => {
    const sketchPath = join(tmpDir, "ref-sketch.genart");
    await writeFile(sketchPath, JSON.stringify({
      genart: "1.2",
      id: "ref-sketch",
      title: "Ref",
      created: "2026-03-04T00:00:00Z",
      modified: "2026-03-04T00:00:00Z",
      renderer: { type: "canvas2d" },
      canvas: { width: 800, height: 600 },
      parameters: [],
      colors: [],
      state: { seed: 42, params: {}, colorPalette: [] },
      algorithm: `function sketch(ctx, state) { drawSymbol(ctx, "pine-tree", 50, 50, 80, 120); return {}; }`,
    }));
    const wsPath = join(tmpDir, "ref.genart-workspace");
    await createWorkspace(state, { title: "Ref", path: wsPath, sketches: [sketchPath] });
    await addSymbol(state, { sketchId: "ref-sketch", symbol: "pine-tree" });
    const result = await removeSymbol(state, { sketchId: "ref-sketch", symbol: "pine-tree" });
    expect(result.warning).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// create_symbol
// ---------------------------------------------------------------------------

describe("createSymbol", () => {
  it("creates a custom symbol", async () => {
    const result = await createSymbol(state, {
      name: "Custom Bush",
      category: "nature",
      tags: ["bush", "shrub", "plant"],
      description: "A simple bush",
      paths: [{ d: "M50 80 C20 80 10 50 30 30 C40 10 60 10 70 30 C90 50 80 80 50 80 Z", fill: "#3a7c3e" }],
      viewBox: "0 0 100 100",
      style: "geometric",
    });
    expect(result.success).toBe(true);
    const sym = result.symbol as { id: string; name: string; custom: boolean };
    expect(sym.id).toBe("custom-bush");
    expect(sym.name).toBe("Custom Bush");
    expect(sym.custom).toBe(true);
  });

  it("caches in sketch when sketchId provided", async () => {
    await setupCanvas2dSketch(tmpDir, state);
    const result = await createSymbol(state, {
      name: "Cactus",
      category: "nature",
      tags: ["cactus", "desert"],
      description: "A desert cactus",
      paths: [{ d: "M50 10 L50 90 M30 50 L50 50 M70 40 L50 40", fill: "none", stroke: "#2d5a27", strokeWidth: 4 }],
      viewBox: "0 0 100 100",
      style: "geometric",
      sketchId: "test-sketch",
    });
    expect(result.addedToSketch).toBe(true);
    const sketch = state.requireSketch("test-sketch");
    expect(sketch.definition.symbols?.["cactus"]).toBeDefined();
  });

  it("uses custom id when provided", async () => {
    const result = await createSymbol(state, {
      name: "My Symbol",
      id: "my-custom-id",
      category: "abstract",
      tags: ["custom"],
      description: "Test",
      paths: [{ d: "M10 10 L90 90 L50 5 Z", fill: "#111" }],
      viewBox: "0 0 100 100",
      style: "geometric",
    });
    const sym = result.symbol as { id: string };
    expect(sym.id).toBe("my-custom-id");
  });

  it("rejects invalid path data", async () => {
    await expect(createSymbol(state, {
      name: "Bad Symbol",
      category: "abstract",
      tags: [],
      description: "Bad",
      paths: [{ d: "" }],
      viewBox: "0 0 100 100",
      style: "geometric",
    })).rejects.toThrow(/validation failed/);
  });

  it("rejects invalid viewBox", async () => {
    await expect(createSymbol(state, {
      name: "Bad VB",
      category: "abstract",
      tags: [],
      description: "Bad",
      paths: [{ d: "M0 0 L10 10" }],
      viewBox: "bad viewbox",
      style: "geometric",
    })).rejects.toThrow(/validation failed/);
  });
});
