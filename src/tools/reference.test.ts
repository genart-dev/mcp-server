/**
 * Tests for reference & inspiration tools (Phase 4, ADR 057).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  serializeWorkspace,
  serializeGenart,
  type SketchDefinition,
  type WorkspaceDefinition,
  type WorkspaceSeries,
} from "@genart-dev/core";
import { EditorState } from "../state.js";
import {
  addReference,
  analyzeReference,
  updateReferenceAnalysis,
  extractPalette,
} from "./reference.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSketch(overrides: Partial<SketchDefinition> = {}): SketchDefinition {
  return {
    genart: "1.1",
    id: "test-sketch",
    title: "Test Sketch",
    created: "2025-01-01T00:00:00.000Z",
    modified: "2025-01-01T00:00:00.000Z",
    renderer: { type: "p5", version: "1.x" },
    canvas: { width: 800, height: 800 },
    parameters: [
      { key: "density", label: "Density", min: 1, max: 100, step: 1, default: 50 },
    ],
    colors: [
      { key: "bg", label: "Background", default: "#1a1a1a" },
    ],
    state: {
      seed: 42,
      params: { density: 50 },
      colorPalette: ["#1a1a1a"],
    },
    algorithm: "// test",
    ...overrides,
  };
}

/** Create a 1x1 PNG file for testing. */
async function createTestImage(dir: string, name: string): Promise<string> {
  // Minimal valid PNG (1x1 red pixel)
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64",
  );
  const path = join(dir, name);
  await writeFile(path, png);
  return path;
}

async function setupState(): Promise<{ state: EditorState; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reference-test-"));

  const ws: WorkspaceDefinition = {
    "genart-workspace": "1.0",
    id: "test-ws",
    title: "Test Workspace",
    created: "2025-01-01T00:00:00.000Z",
    modified: "2025-01-01T00:00:00.000Z",
    viewport: { x: 0, y: 0, zoom: 1 },
    sketches: [
      { file: "test-sketch.genart", position: { x: 0, y: 0 } },
    ],
    series: [
      {
        id: "test-series",
        label: "Test Series",
        narrative: "Test narrative.",
        intent: "Test intent.",
        sketchFiles: ["test-sketch.genart"],
      },
    ],
  };

  const wsPath = join(dir, "test.genart-workspace");
  await writeFile(wsPath, serializeWorkspace(ws));

  const sketch = makeSketch();
  const sketchPath = join(dir, "test-sketch.genart");
  await writeFile(sketchPath, serializeGenart(sketch));

  const state = new EditorState();
  state.workspacePath = wsPath;
  state.workspace = ws;
  state.sketches.set("test-sketch", { definition: sketch, path: sketchPath });

  return { state, dir };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("reference tools", () => {
  let state: EditorState;
  let dir: string;

  beforeEach(async () => {
    const setup = await setupState();
    state = setup.state;
    dir = setup.dir;
  });

  describe("add_reference", () => {
    it("adds a reference to a series", async () => {
      const imagePath = await createTestImage(dir, "inspiration.png");

      const result = await addReference(state, {
        image: imagePath,
        seriesId: "test-series",
        source: "Test Artist",
      });

      expect(result.success).toBe(true);
      expect(result.attachedTo).toBe("series:test-series");
      const ref = result.reference as Record<string, unknown>;
      expect(ref.id).toBe("inspiration");
      expect(ref.type).toBe("image");
      expect(ref.path).toBe("references/inspiration.png");
      expect(ref.source).toBe("Test Artist");
    });

    it("adds a reference to a sketch", async () => {
      const imagePath = await createTestImage(dir, "ref-photo.jpg");

      const result = await addReference(state, {
        image: imagePath,
        sketchId: "test-sketch",
        type: "photograph",
      });

      expect(result.success).toBe(true);
      expect(result.attachedTo).toBe("sketch:test-sketch");
      expect(result.fileContent).toBeDefined();

      // Verify sketch was updated in state
      const sketch = state.sketches.get("test-sketch")!.definition;
      expect(sketch.references).toBeDefined();
      expect(sketch.references!.length).toBe(1);
      expect(sketch.references![0]!.id).toBe("ref-photo");
    });

    it("rejects non-image files", async () => {
      await expect(
        addReference(state, {
          image: "/some/file.txt",
          seriesId: "test-series",
        }),
      ).rejects.toThrow("Not a recognized image file");
    });

    it("requires seriesId or sketchId", async () => {
      const imagePath = await createTestImage(dir, "orphan.png");

      await expect(
        addReference(state, { image: imagePath }),
      ).rejects.toThrow("Either seriesId or sketchId must be specified");
    });

    it("rejects duplicate reference ID on series", async () => {
      const img1 = await createTestImage(dir, "dup.png");
      await addReference(state, { image: img1, seriesId: "test-series" });

      const img2 = await createTestImage(dir, "dup.png");
      await expect(
        addReference(state, { image: img2, seriesId: "test-series" }),
      ).rejects.toThrow("already exists");
    });

    it("accepts custom ID", async () => {
      const imagePath = await createTestImage(dir, "photo123.png");

      const result = await addReference(state, {
        image: imagePath,
        seriesId: "test-series",
        id: "sunset-ref",
      });

      const ref = result.reference as Record<string, unknown>;
      expect(ref.id).toBe("sunset-ref");
    });

    it("accepts custom reference type", async () => {
      const imagePath = await createTestImage(dir, "texture-ref.png");

      const result = await addReference(state, {
        image: imagePath,
        seriesId: "test-series",
        type: "texture",
      });

      const ref = result.reference as Record<string, unknown>;
      expect(ref.type).toBe("texture");
    });
  });

  describe("analyze_reference", () => {
    it("returns analysis framework for a series reference", async () => {
      const imagePath = await createTestImage(dir, "to-analyze.png");
      await addReference(state, {
        image: imagePath,
        seriesId: "test-series",
      });

      const result = await analyzeReference(state, {
        referenceId: "to-analyze",
        seriesId: "test-series",
      });

      expect(result.metadata.success).toBe(true);
      expect(result.metadata.referenceId).toBe("to-analyze");
      expect(result.metadata.analysisFramework).toBeDefined();
      const framework = result.metadata.analysisFramework as Record<string, unknown>;
      expect(framework.composition).toBeDefined();
      expect(framework.palette).toBeDefined();
      expect(framework.rhythm).toBeDefined();
      expect(framework.mood).toBeDefined();
      expect(framework.technique).toBeDefined();
      expect(result.previewJpegBase64).toBeDefined();
    });

    it("throws for nonexistent reference", async () => {
      await expect(
        analyzeReference(state, {
          referenceId: "nonexistent",
          seriesId: "test-series",
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("update_reference_analysis", () => {
    it("saves analysis to a series reference", async () => {
      const imagePath = await createTestImage(dir, "analyzed.png");
      await addReference(state, {
        image: imagePath,
        seriesId: "test-series",
      });

      const result = await updateReferenceAnalysis(state, {
        referenceId: "analyzed",
        seriesId: "test-series",
        analysis: {
          composition: "Strong diagonal from lower-left to upper-right",
          palette: ["#1a1a2e", "#e94560", "#0f3460", "#16213e"],
          rhythm: "Progressive rhythm with accelerating density",
          mood: "Contemplative with underlying tension",
          technique: "Layered washes with sharp linear accents",
          keyQualities: ["diagonal energy", "value contrast", "atmospheric depth"],
        },
      });

      expect(result.success).toBe(true);

      // Verify the analysis was saved
      const series = state.workspace!.series!.find((s) => s.id === "test-series")!;
      const ref = series.references!.find((r) => r.id === "analyzed")!;
      expect(ref.analysis).toBeDefined();
      expect(ref.analysis!.composition).toBe("Strong diagonal from lower-left to upper-right");
      expect(ref.analysis!.palette).toEqual(["#1a1a2e", "#e94560", "#0f3460", "#16213e"]);
      expect(ref.analysis!.keyQualities).toContain("diagonal energy");
    });

    it("saves analysis to a sketch reference", async () => {
      const imagePath = await createTestImage(dir, "sketch-ref.png");
      await addReference(state, {
        image: imagePath,
        sketchId: "test-sketch",
      });

      const result = await updateReferenceAnalysis(state, {
        referenceId: "sketch-ref",
        sketchId: "test-sketch",
        analysis: {
          mood: "Serene",
          palette: ["#ffffff", "#000000"],
        },
      });

      expect(result.success).toBe(true);
      const sketch = state.sketches.get("test-sketch")!.definition;
      const ref = sketch.references!.find((r) => r.id === "sketch-ref")!;
      expect(ref.analysis!.mood).toBe("Serene");
    });
  });

  describe("extract_palette", () => {
    it("returns palette extraction framework", async () => {
      const imagePath = await createTestImage(dir, "palette-src.png");
      await addReference(state, {
        image: imagePath,
        seriesId: "test-series",
      });

      const result = await extractPalette(state, {
        referenceId: "palette-src",
        seriesId: "test-series",
        count: 5,
      });

      expect(result.metadata.success).toBe(true);
      expect(result.metadata.requestedColors).toBe(5);
      expect(result.metadata.instructions).toBeDefined();
      expect(result.metadata.extractionGuidelines).toBeDefined();
      expect(result.previewJpegBase64).toBeDefined();
    });

    it("defaults to 6 colors", async () => {
      const imagePath = await createTestImage(dir, "default-palette.png");
      await addReference(state, {
        image: imagePath,
        seriesId: "test-series",
      });

      const result = await extractPalette(state, {
        referenceId: "default-palette",
        seriesId: "test-series",
      });

      expect(result.metadata.requestedColors).toBe(6);
    });

    it("throws for nonexistent reference", async () => {
      await expect(
        extractPalette(state, {
          referenceId: "nonexistent",
        }),
      ).rejects.toThrow("not found");
    });
  });
});
