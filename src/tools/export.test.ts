import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, readFile, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Mock Puppeteer — vi.hoisted ensures mocks are available before vi.mock hoist
// ---------------------------------------------------------------------------

const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const { mockPage, mockBrowser } = vi.hoisted(() => {
  const mockPage = {
    setViewport: vi.fn(),
    setContent: vi.fn(),
    screenshot: vi.fn(),
    close: vi.fn(),
  };
  const mockBrowser = {
    newPage: vi.fn(),
    connected: true,
    close: vi.fn(),
  };
  return { mockPage, mockBrowser };
});

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn().mockResolvedValue(mockBrowser),
  },
}));

import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import { exportSketch } from "./export.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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
  const renderer = opts.renderer ?? "p5";
  const width = opts.width ?? 800;
  const height = opts.height ?? 600;
  return JSON.stringify({
    genart: "1.1",
    id,
    title,
    created: "2026-02-14T00:00:00Z",
    modified: "2026-02-14T00:00:00Z",
    renderer: { type: renderer, version: "1.x" },
    canvas: { width, height },
    parameters: [
      { key: "density", label: "Density", min: 0, max: 100, step: 1, default: 50 },
    ],
    colors: [{ key: "bg", label: "Background", default: "#1a1a1a" }],
    state: {
      seed: 42,
      params: { density: 50 },
      colorPalette: ["#1a1a1a"],
    },
    algorithm: VALID_ALGORITHM,
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<string> {
  await writeFile(join(tmpDir, "s1.genart"), makeSketch("s1", "Noise Grid"));
  await writeFile(
    join(tmpDir, "s2.genart"),
    makeSketch("s2", "Wave Pattern", { renderer: "canvas2d" }),
  );

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: [join(tmpDir, "s1.genart"), join(tmpDir, "s2.genart")],
  });
  return wsPath;
}

describe("export tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-export-"));
    state = new EditorState();
    vi.clearAllMocks();

    // Re-setup mock returns
    mockPage.setViewport.mockResolvedValue(undefined);
    mockPage.setContent.mockResolvedValue(undefined);
    mockPage.screenshot.mockResolvedValue(Buffer.from(FAKE_PNG));
    mockPage.close.mockResolvedValue(undefined);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockBrowser.close.mockResolvedValue(undefined);
    mockBrowser.connected = true;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // export_sketch — HTML format
  // -----------------------------------------------------------------------

  describe("export html", () => {
    it("exports a standalone HTML file", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "export.html");

      const result = await exportSketch(state, {
        sketchId: "s1",
        format: "html",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.sketchId).toBe("s1");
      expect(result.format).toBe("html");
      expect(result.outputPath).toBe(outputPath);
      expect(result.renderer).toBe("p5");
      expect(typeof result.fileSize).toBe("number");
      expect(result.fileSize as number).toBeGreaterThan(0);

      const content = await readFile(outputPath, "utf-8");
      expect(content).toContain("<!DOCTYPE html>");
      expect(content).toContain("p5");
    });

    it("applies seed override in exported HTML", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "export-seed.html");

      await exportSketch(state, {
        sketchId: "s1",
        format: "html",
        outputPath,
        seed: 99999,
      });

      const content = await readFile(outputPath, "utf-8");
      expect(content).toContain("99999");

      // Original should be unchanged
      const loaded = state.requireSketch("s1");
      expect(loaded.definition.state.seed).toBe(42);
    });
  });

  // -----------------------------------------------------------------------
  // export_sketch — PNG format
  // -----------------------------------------------------------------------

  describe("export png", () => {
    it("exports a PNG file", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "export.png");

      const result = await exportSketch(state, {
        sketchId: "s1",
        format: "png",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("png");
      expect(result.fileSize as number).toBeGreaterThan(0);

      const content = await readFile(outputPath);
      expect(content.length).toBeGreaterThan(0);
    });

    it("applies custom dimensions for PNG export", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "export-dim.png");

      await exportSketch(state, {
        sketchId: "s1",
        format: "png",
        outputPath,
        width: 400,
        height: 300,
      });

      expect(mockPage.setViewport).toHaveBeenCalledWith(
        expect.objectContaining({ width: 400, height: 300 }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // export_sketch — Algorithm format
  // -----------------------------------------------------------------------

  describe("export algorithm", () => {
    it("exports raw algorithm source code", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "export.js");

      const result = await exportSketch(state, {
        sketchId: "s1",
        format: "algorithm",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("algorithm");

      const content = await readFile(outputPath, "utf-8");
      expect(content).toContain("function sketch(p, state)");
    });

    it("does not require Puppeteer for algorithm export", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "algo.js");

      await exportSketch(state, {
        sketchId: "s1",
        format: "algorithm",
        outputPath,
      });

      // Puppeteer should not have been called
      expect(mockBrowser.newPage).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // export_sketch — SVG format
  // -----------------------------------------------------------------------

  describe("export svg", () => {
    it("exports non-SVG renderer as rasterized PNG in SVG container", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "export.svg");

      const result = await exportSketch(state, {
        sketchId: "s1",
        format: "svg",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("svg");
      expect(result.notice).toContain("rasterized");

      const content = await readFile(outputPath, "utf-8");
      expect(content).toContain("<svg");
      expect(content).toContain("data:image/png;base64,");
    });
  });

  // -----------------------------------------------------------------------
  // export_sketch — ZIP format
  // -----------------------------------------------------------------------

  describe("export zip", () => {
    it("exports a ZIP bundle with all formats", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "export.zip");

      const result = await exportSketch(state, {
        sketchId: "s1",
        format: "zip",
        outputPath,
      });

      expect(result.success).toBe(true);
      expect(result.format).toBe("zip");
      expect(result.fileSize as number).toBeGreaterThan(0);
      expect(result.contents).toEqual([
        "s1.html",
        "s1.png",
        "s1.js",
        "s1.genart",
      ]);

      const s = await stat(outputPath);
      expect(s.size).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Error cases
  // -----------------------------------------------------------------------

  describe("error cases", () => {
    it("rejects when no workspace is open", async () => {
      await expect(
        exportSketch(state, {
          sketchId: "s1",
          format: "html",
          outputPath: join(tmpDir, "out.html"),
        }),
      ).rejects.toThrow("No workspace is currently open");
    });

    it("rejects when sketch not found", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        exportSketch(state, {
          sketchId: "nonexistent",
          format: "html",
          outputPath: join(tmpDir, "out.html"),
        }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when parent directory does not exist", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        exportSketch(state, {
          sketchId: "s1",
          format: "html",
          outputPath: "/nonexistent/dir/out.html",
        }),
      ).rejects.toThrow("Parent directory does not exist");
    });

    it("rejects when file already exists", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "existing.html");
      await writeFile(outputPath, "existing content");

      await expect(
        exportSketch(state, {
          sketchId: "s1",
          format: "html",
          outputPath,
        }),
      ).rejects.toThrow("File already exists");
    });

    it("does not mutate sketch state on export", async () => {
      await setupWorkspace(tmpDir, state);
      const outputPath = join(tmpDir, "out.html");

      await exportSketch(state, {
        sketchId: "s1",
        format: "html",
        outputPath,
        seed: 99999,
        params: { density: 75 },
      });

      const loaded = state.requireSketch("s1");
      expect(loaded.definition.state.seed).toBe(42);
      expect(loaded.definition.state.params.density).toBe(50);
    });
  });
});
