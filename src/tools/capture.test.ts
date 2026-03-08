import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Mock Puppeteer — vi.hoisted ensures mocks are available before vi.mock hoist
// ---------------------------------------------------------------------------

const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

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
import { captureScreenshot, captureBatch } from "./capture.js";

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

/** Default mock: PNG for first screenshot call, JPEG for second (two-tier pattern). */
function setupTwoTierMock() {
  let callCount = 0;
  mockPage.screenshot.mockImplementation(async () => {
    callCount++;
    // Odd calls = PNG (preview), even calls = JPEG (inline)
    return callCount % 2 === 1 ? Buffer.from(FAKE_PNG) : Buffer.from(FAKE_JPEG);
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
): Promise<string> {
  await writeFile(join(tmpDir, "s1.genart"), makeSketch("s1", "Noise Grid"));
  await writeFile(join(tmpDir, "s2.genart"), makeSketch("s2", "Wave Pattern", { renderer: "canvas2d" }));
  await writeFile(join(tmpDir, "s3.genart"), makeSketch("s3", "Color Fields"));

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: [
      join(tmpDir, "s1.genart"),
      join(tmpDir, "s2.genart"),
      join(tmpDir, "s3.genart"),
    ],
  });
  return wsPath;
}

describe("capture tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-capture-"));
    state = new EditorState();
    vi.clearAllMocks();

    // Re-setup mock returns after clearAllMocks
    mockPage.setViewport.mockResolvedValue(undefined);
    mockPage.setContent.mockResolvedValue(undefined);
    mockPage.close.mockResolvedValue(undefined);
    mockBrowser.newPage.mockResolvedValue(mockPage);
    mockBrowser.close.mockResolvedValue(undefined);
    mockBrowser.connected = true;
    setupTwoTierMock();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // capture_screenshot
  // -----------------------------------------------------------------------

  describe("capture_screenshot", () => {
    it("returns structured result with metadata and JPEG preview", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await captureScreenshot(state, {});
      expect(result.metadata.success).toBe(true);
      expect(result.metadata.target).toBe("selected");
      expect(result.metadata.sketchId).toBe("s1");
      expect(result.metadata.width).toBe(800);
      expect(result.metadata.height).toBe(600);
      expect(result.metadata.seed).toBe(42);
      expect(typeof result.previewJpegBase64).toBe("string");
      expect(result.previewJpegBase64.length).toBeGreaterThan(0);
    });

    it("auto-saves preview PNG to snapshots/ directory in local mode", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await captureScreenshot(state, {});
      const expectedPath = join(tmpDir, "snapshots", "s1-42-preview.png");
      expect(result.metadata.previewPath).toBe(expectedPath);
      expect(result.metadata.savedPreviewTo).toBe(expectedPath);
      expect(result.metadata.previewWritten).toBe(true);

      // Verify file was written
      const content = await readFile(expectedPath);
      expect(content.length).toBeGreaterThan(0);
    });

    it("skips preview file in remote mode (no disk write)", async () => {
      // Setup workspace in local mode first (loads sketches from disk), then enable remote
      await setupWorkspace(tmpDir, state);
      state.remoteMode = true;
      state.setSelection(["s1"]);

      const result = await captureScreenshot(state, {});
      expect(result.metadata.savedPreviewTo).toBeUndefined();
      expect(result.metadata.previewWritten).toBeUndefined();
    });

    it("captures a specific sketch by ID", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await captureScreenshot(state, {
        target: "sketch",
        sketchId: "s2",
      });
      expect(result.metadata.success).toBe(true);
      expect(result.metadata.sketchId).toBe("s2");
    });

    it("applies seed override without mutating state", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await captureScreenshot(state, { seed: 99999 });
      expect(result.metadata.seed).toBe(99999);

      // Original sketch state should be unchanged
      const loaded = state.requireSketch("s1");
      expect(loaded.definition.state.seed).toBe(42);
    });

    it("applies param overrides without mutating state", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await captureScreenshot(state, {
        params: { density: 75 },
      });
      expect(result.metadata.success).toBe(true);

      // Original sketch state should be unchanged
      const loaded = state.requireSketch("s1");
      expect(loaded.definition.state.params.density).toBe(50);
    });

    it("applies custom width/height", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await captureScreenshot(state, {
        width: 400,
        height: 300,
      });
      expect(result.metadata.width).toBe(400);
      expect(result.metadata.height).toBe(300);
    });

    it("derives snapshot path as snapshots/<id>-<seed>-preview.png", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await captureScreenshot(state, {});
      expect(result.metadata.previewPath).toBe(
        join(tmpDir, "snapshots", "s1-42-preview.png"),
      );
    });

    it("uses overridden seed in snapshot filename", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      const result = await captureScreenshot(state, { seed: 99999 });
      expect(result.metadata.previewPath).toBe(
        join(tmpDir, "snapshots", "s1-99999-preview.png"),
      );
    });

    it("rejects when nothing is selected (target=selected)", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(captureScreenshot(state, {})).rejects.toThrow(
        "No sketch is currently selected",
      );
    });

    it("rejects when sketchId missing for target=sketch", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        captureScreenshot(state, { target: "sketch" }),
      ).rejects.toThrow("sketchId is required when target is 'sketch'");
    });

    it("rejects when sketch not found", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        captureScreenshot(state, { target: "sketch", sketchId: "nonexistent" }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when no workspace is open", async () => {
      await expect(captureScreenshot(state, {})).rejects.toThrow(
        "No workspace is currently open",
      );
    });

    it("calls page.setContent with generated HTML", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s1"]);

      await captureScreenshot(state, {});
      expect(mockPage.setContent).toHaveBeenCalledWith(
        expect.stringContaining("<!DOCTYPE html>"),
        expect.any(Object),
      );
    });
  });

  // -----------------------------------------------------------------------
  // capture_batch
  // -----------------------------------------------------------------------

  describe("capture_batch", () => {
    it("captures all sketches when no sketchIds specified", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await captureBatch(state, {});
      expect(result.metadata.success).toBe(true);
      expect(result.metadata.total).toBe(3);
      expect(result.metadata.captured).toBe(3);
      expect(result.metadata.failed).toBe(0);
      expect(result.items).toHaveLength(3);
    });

    it("captures specific sketches by ID", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await captureBatch(state, {
        sketchIds: ["s1", "s3"],
      });
      expect(result.metadata.total).toBe(2);
      expect(result.metadata.captured).toBe(2);

      const ids = result.items.map((item) => item.metadata.sketchId);
      expect(ids).toContain("s1");
      expect(ids).toContain("s3");
    });

    it("each item has metadata and inlineJpegBase64", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await captureBatch(state, { sketchIds: ["s1"] });
      expect(result.items).toHaveLength(1);
      const item = result.items[0]!;
      expect(item.metadata.success).toBe(true);
      expect(item.metadata.sketchId).toBe("s1");
      expect(typeof item.inlineJpegBase64).toBe("string");
      expect(item.inlineJpegBase64.length).toBeGreaterThan(0);
    });

    it("auto-saves preview PNGs to snapshots/ in local mode", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await captureBatch(state, { sketchIds: ["s1"] });
      const item = result.items[0]!;
      const expectedPath = join(tmpDir, "snapshots", "s1-42-preview.png");
      expect(item.metadata.previewPath).toBe(expectedPath);
      expect(item.metadata.savedPreviewTo).toBe(expectedPath);
      expect(item.metadata.previewWritten).toBe(true);

      const content = await readFile(expectedPath);
      expect(content.length).toBeGreaterThan(0);
    });

    it("skips preview file in remote mode", async () => {
      await setupWorkspace(tmpDir, state);
      state.remoteMode = true;

      const result = await captureBatch(state, { sketchIds: ["s1"] });
      const item = result.items[0]!;
      expect(item.metadata.savedPreviewTo).toBeUndefined();
      expect(item.metadata.previewWritten).toBeUndefined();
    });

    it("applies global width/height override", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await captureBatch(state, {
        sketchIds: ["s1"],
        width: 256,
        height: 256,
      });
      expect(result.items[0]!.metadata.width).toBe(256);
      expect(result.items[0]!.metadata.height).toBe(256);
    });

    it("applies global seed override", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await captureBatch(state, {
        sketchIds: ["s1"],
        seed: 77777,
      });
      expect(result.items[0]!.metadata.seed).toBe(77777);
    });

    it("handles individual capture failures gracefully", async () => {
      await setupWorkspace(tmpDir, state);

      // Make screenshot fail for the second sketch's first screenshot (call 3)
      let callCount = 0;
      mockPage.screenshot.mockImplementation(async () => {
        callCount++;
        if (callCount === 3) {
          throw new Error("Render timeout");
        }
        return callCount % 2 === 1 ? Buffer.from(FAKE_PNG) : Buffer.from(FAKE_JPEG);
      });

      const result = await captureBatch(state, {
        sketchIds: ["s1", "s2", "s3"],
      });
      expect(result.metadata.success).toBe(false);
      expect(result.metadata.captured).toBe(2);
      expect(result.metadata.failed).toBe(1);
      expect(result.metadata.errors).toBeDefined();

      const errors = result.metadata.errors as Record<string, unknown>[];
      expect(errors).toHaveLength(1);
    });

    it("rejects when no workspace is open", async () => {
      await expect(captureBatch(state, {})).rejects.toThrow(
        "No workspace is currently open",
      );
    });

    it("rejects when sketch not found", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        captureBatch(state, { sketchIds: ["nonexistent"] }),
      ).rejects.toThrow("Sketch not found: 'nonexistent'");
    });

    it("rejects when no sketches to capture", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        captureBatch(state, { sketchIds: [] }),
      ).rejects.toThrow("No sketches to capture");
    });
  });
});
