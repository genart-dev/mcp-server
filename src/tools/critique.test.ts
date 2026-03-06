import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

// ---------------------------------------------------------------------------
// Mock Puppeteer
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
import { critiqueSketch, compareSketches, ALL_ASPECTS } from "./critique.js";

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
  opts: { compositionLevel?: string; philosophy?: string } = {},
): string {
  return JSON.stringify({
    genart: "1.1",
    id,
    title,
    created: "2026-02-14T00:00:00Z",
    modified: "2026-02-14T00:00:00Z",
    renderer: { type: "p5", version: "1.x" },
    canvas: { width: 800, height: 600 },
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
    ...(opts.compositionLevel ? { compositionLevel: opts.compositionLevel } : {}),
    ...(opts.philosophy ? { philosophy: opts.philosophy } : {}),
  });
}

function setupTwoTierMock() {
  let callCount = 0;
  mockPage.screenshot.mockImplementation(async () => {
    callCount++;
    return callCount % 2 === 1 ? Buffer.from(FAKE_PNG) : Buffer.from(FAKE_JPEG);
  });
}

async function setupWorkspace(
  tmpDir: string,
  state: EditorState,
  sketches: Array<{ id: string; title: string; compositionLevel?: string; philosophy?: string }> = [
    { id: "s1", title: "Noise Grid" },
    { id: "s2", title: "Wave Pattern" },
    { id: "s3", title: "Color Fields", compositionLevel: "exhibition", philosophy: "Exploring chromatic tension" },
    { id: "s4", title: "Study Sketch", compositionLevel: "study" },
  ],
): Promise<string> {
  for (const s of sketches) {
    await writeFile(
      join(tmpDir, `${s.id}.genart`),
      makeSketch(s.id, s.title, { compositionLevel: s.compositionLevel, philosophy: s.philosophy }),
    );
  }

  const wsPath = join(tmpDir, "test.genart-workspace");
  await createWorkspace(state, {
    title: "Test Workspace",
    path: wsPath,
    sketches: sketches.map((s) => join(tmpDir, `${s.id}.genart`)),
  });
  return wsPath;
}

describe("critique tools", () => {
  let tmpDir: string;
  let state: EditorState;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-critique-"));
    state = new EditorState();
    vi.clearAllMocks();

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
  // critique_sketch
  // -----------------------------------------------------------------------

  describe("critique_sketch", () => {
    it("returns structured critique with all aspects by default", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s1" });
      expect(result.metadata.success).toBe(true);
      expect(result.metadata.sketchId).toBe("s1");
      expect(result.metadata.title).toBe("Noise Grid");

      const frameworks = result.metadata.frameworks as Array<{ aspect: string }>;
      expect(frameworks).toHaveLength(5);
      const aspects = frameworks.map((f) => f.aspect);
      expect(aspects).toEqual(["composition", "color", "rhythm", "unity", "expression"]);
    });

    it("returns preview JPEG base64", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s1" });
      expect(typeof result.previewJpegBase64).toBe("string");
      expect(result.previewJpegBase64.length).toBeGreaterThan(0);
    });

    // Note: compositionLevel is stripped by the published parser.
    // Once @genart-dev/format is republished, update these to test
    // exhibition/study-level calibration.

    it("includes severity calibration with all required fields", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s3" });
      const severity = result.metadata.severity as Record<string, string>;
      expect(severity.level).toBeTruthy();
      expect(severity.description).toBeTruthy();
      expect(severity.focus).toBeTruthy();
      expect(severity.tolerance).toBeTruthy();
    });

    it("defaults to sketch-level severity when compositionLevel not set", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s1" });
      const severity = result.metadata.severity as Record<string, string>;
      expect(severity.level).toBe("sketch");
    });

    it("severity object has description and tolerance", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s4" });
      const severity = result.metadata.severity as Record<string, string>;
      expect(severity.level).toBeTruthy();
      expect(severity.description).toBeTruthy();
      expect(severity.tolerance).toBeTruthy();
    });

    it("filters to specific aspects", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, {
        sketchId: "s1",
        aspects: ["color", "expression"],
      });
      const frameworks = result.metadata.frameworks as Array<{ aspect: string }>;
      expect(frameworks).toHaveLength(2);
      expect(frameworks[0]!.aspect).toBe("color");
      expect(frameworks[1]!.aspect).toBe("expression");
    });

    it("each framework has questions, principles, and pitfalls", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s1" });
      const frameworks = result.metadata.frameworks as Array<{
        aspect: string;
        questions: string[];
        principles: string[];
        pitfalls: string[];
      }>;

      for (const fw of frameworks) {
        expect(fw.questions.length).toBeGreaterThanOrEqual(3);
        expect(fw.principles.length).toBeGreaterThanOrEqual(3);
        expect(fw.pitfalls.length).toBeGreaterThanOrEqual(3);
      }
    });

    it("includes relevant skills", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s1" });
      const skills = result.metadata.relevantSkills as Array<{ id: string; name: string; relevantTo: string }>;
      expect(skills.length).toBeGreaterThan(0);
      // Should include composition skills since composition is in default aspects
      expect(skills.some((s) => s.relevantTo === "composition")).toBe(true);
    });

    it("includes instructions array", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s1" });
      const instructions = result.metadata.instructions as string[];
      expect(instructions.length).toBeGreaterThanOrEqual(3);
    });

    it("includes philosophy when set", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await critiqueSketch(state, { sketchId: "s3" });
      expect(result.metadata.philosophy).toBe("Exploring chromatic tension");
    });

    it("uses selected sketch when no sketchId provided", async () => {
      await setupWorkspace(tmpDir, state);
      state.setSelection(["s2"]);

      const result = await critiqueSketch(state, {});
      expect(result.metadata.sketchId).toBe("s2");
    });

    it("rejects when no sketch specified and nothing selected", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(critiqueSketch(state, {})).rejects.toThrow(
        "No sketch specified and nothing selected",
      );
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        critiqueSketch(state, { sketchId: "s1" }),
      ).rejects.toThrow("No workspace is currently open");
    });
  });

  // -----------------------------------------------------------------------
  // compare_sketches
  // -----------------------------------------------------------------------

  describe("compare_sketches", () => {
    it("returns comparison framework for 2 sketches", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await compareSketches(state, {
        sketchIds: ["s1", "s2"],
      });
      expect(result.metadata.success).toBe(true);

      const sketches = result.metadata.sketches as Array<{ id: string }>;
      expect(sketches).toHaveLength(2);
      expect(sketches[0]!.id).toBe("s1");
      expect(sketches[1]!.id).toBe("s2");
    });

    it("returns per-sketch previews", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await compareSketches(state, {
        sketchIds: ["s1", "s2"],
      });
      expect(result.previews).toHaveLength(2);
      for (const preview of result.previews) {
        expect(typeof preview.inlineJpegBase64).toBe("string");
        expect(preview.inlineJpegBase64.length).toBeGreaterThan(0);
      }
    });

    it("includes all aspect frameworks by default", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await compareSketches(state, {
        sketchIds: ["s1", "s2"],
      });
      const frameworks = result.metadata.frameworks as Array<{ aspect: string }>;
      expect(frameworks).toHaveLength(5);
    });

    it("filters to specific aspects", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await compareSketches(state, {
        sketchIds: ["s1", "s2"],
        aspects: ["color"],
      });
      const frameworks = result.metadata.frameworks as Array<{ aspect: string }>;
      expect(frameworks).toHaveLength(1);
      expect(frameworks[0]!.aspect).toBe("color");
    });

    it("includes comparison-specific questions", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await compareSketches(state, {
        sketchIds: ["s1", "s2"],
      });
      const cq = result.metadata.comparisonQuestions as Array<{
        aspect: string;
        questions: string[];
      }>;
      expect(cq.length).toBe(5);
      for (const item of cq) {
        expect(item.questions.length).toBeGreaterThanOrEqual(3);
      }
    });

    it("adds extra comparison question for 3+ sketches", async () => {
      await setupWorkspace(tmpDir, state);

      const result2 = await compareSketches(state, {
        sketchIds: ["s1", "s2"],
        aspects: ["composition"],
      });
      const q2 = (result2.metadata.comparisonQuestions as Array<{ questions: string[] }>)[0]!.questions;

      const result3 = await compareSketches(state, {
        sketchIds: ["s1", "s2", "s3"],
        aspects: ["composition"],
      });
      const q3 = (result3.metadata.comparisonQuestions as Array<{ questions: string[] }>)[0]!.questions;

      expect(q3.length).toBeGreaterThan(q2.length);
    });

    it("includes sketch metadata (compositionLevel, philosophy)", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await compareSketches(state, {
        sketchIds: ["s1", "s3"],
      });
      const sketches = result.metadata.sketches as Array<{
        id: string;
        compositionLevel: string;
        philosophy: string | null;
      }>;

      expect(sketches[0]!.compositionLevel).toBe("sketch");
      expect(sketches[0]!.philosophy).toBeNull();
      // compositionLevel defaults to "sketch" until format package is republished
      expect(sketches[1]!.compositionLevel).toBeTruthy();
      expect(sketches[1]!.philosophy).toBe("Exploring chromatic tension");
    });

    it("supports up to 4 sketches", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await compareSketches(state, {
        sketchIds: ["s1", "s2", "s3", "s4"],
      });
      expect(result.metadata.success).toBe(true);
      expect(result.previews).toHaveLength(4);
    });

    it("rejects fewer than 2 sketches", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        compareSketches(state, { sketchIds: ["s1"] }),
      ).rejects.toThrow("at least 2");
    });

    it("rejects more than 4 sketches", async () => {
      await setupWorkspace(tmpDir, state);

      await expect(
        compareSketches(state, {
          sketchIds: ["s1", "s2", "s3", "s4", "nonexistent"],
        }),
      ).rejects.toThrow("maximum of 4");
    });

    it("rejects when no workspace is open", async () => {
      await expect(
        compareSketches(state, { sketchIds: ["s1", "s2"] }),
      ).rejects.toThrow("No workspace is currently open");
    });

    it("includes instructions array", async () => {
      await setupWorkspace(tmpDir, state);

      const result = await compareSketches(state, {
        sketchIds: ["s1", "s2"],
      });
      const instructions = result.metadata.instructions as string[];
      expect(instructions.length).toBeGreaterThanOrEqual(3);
    });
  });

  // -----------------------------------------------------------------------
  // ALL_ASPECTS
  // -----------------------------------------------------------------------

  describe("ALL_ASPECTS", () => {
    it("contains all five aspects", () => {
      expect(ALL_ASPECTS).toEqual([
        "composition",
        "color",
        "rhythm",
        "unity",
        "expression",
      ]);
    });
  });
});
