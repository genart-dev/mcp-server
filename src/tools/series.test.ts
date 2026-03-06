/**
 * Tests for series & conceptual development tools (Phase 3).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtemp, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { serializeWorkspace, serializeGenart, type SketchDefinition, type WorkspaceDefinition } from "@genart-dev/core";
import { EditorState } from "../state.js";
import { createSeries, developConcept, promoteSketch } from "./series.js";

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

async function setupState(): Promise<{ state: EditorState; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "series-test-"));

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

describe("series tools", () => {
  let state: EditorState;

  beforeEach(async () => {
    const setup = await setupState();
    state = setup.state;
  });

  describe("create_series", () => {
    it("creates a series with default stages", async () => {
      const result = await createSeries(state, {
        label: "Flow Field Explorations",
        narrative: "Exploring the intersection of noise fields and particle systems.",
        intent: "Discover how flow and density interact visually.",
      });

      expect(result.success).toBe(true);
      expect(result.series).toBeDefined();
      const series = result.series as Record<string, unknown>;
      expect(series.id).toBe("flow-field-explorations");
      expect(series.label).toBe("Flow Field Explorations");
      expect(series.stages).toEqual(["studies", "drafts", "refinements", "finals"]);
    });

    it("adds series to workspace", async () => {
      await createSeries(state, {
        label: "Test Series",
        narrative: "Test narrative.",
        intent: "Test intent.",
      });

      expect(state.workspace!.series).toBeDefined();
      expect(state.workspace!.series!.length).toBe(1);
      expect(state.workspace!.series![0]!.id).toBe("test-series");
    });

    it("rejects duplicate series ID", async () => {
      await createSeries(state, {
        label: "Test Series",
        narrative: "First.",
        intent: "First.",
      });

      await expect(
        createSeries(state, {
          label: "Test Series",
          narrative: "Second.",
          intent: "Second.",
        }),
      ).rejects.toThrow("already exists");
    });

    it("validates sketch files exist in workspace", async () => {
      await expect(
        createSeries(state, {
          label: "Bad Series",
          narrative: "Test.",
          intent: "Test.",
          sketchFiles: ["nonexistent.genart"],
        }),
      ).rejects.toThrow("not found in workspace");
    });

    it("accepts valid sketch files", async () => {
      const result = await createSeries(state, {
        label: "Valid Series",
        narrative: "Test.",
        intent: "Test.",
        sketchFiles: ["test-sketch.genart"],
      });

      const series = result.series as Record<string, unknown>;
      expect(series.sketchCount).toBe(1);
    });

    it("accepts custom stages", async () => {
      const result = await createSeries(state, {
        label: "Quick Series",
        narrative: "Test.",
        intent: "Test.",
        stages: ["studies", "finals"],
      });

      const series = result.series as Record<string, unknown>;
      expect(series.stages).toEqual(["studies", "finals"]);
    });
  });

  describe("develop_concept", () => {
    it("returns a structured concept plan", async () => {
      const result = await developConcept(state, {
        concept: "Generative landscapes inspired by Japanese ink painting",
      });

      expect(result.success).toBe(true);
      expect(result.conceptPlan).toBeDefined();
      const plan = result.conceptPlan as Record<string, unknown>;
      expect(plan.concept).toBe("Generative landscapes inspired by Japanese ink painting");
      expect(plan.medium).toBe("p5");
      expect(plan.mood).toBeDefined();
      expect(plan.palette).toBeDefined();
      expect(plan.composition).toBeDefined();
      expect(plan.skills).toBeDefined();
      expect(plan.seriesStructure).toBeDefined();
    });

    it("respects medium override", async () => {
      const result = await developConcept(state, {
        concept: "3D wireframe sculptures",
        medium: "three",
      });

      const plan = result.conceptPlan as Record<string, unknown>;
      expect(plan.medium).toBe("three");
    });

    it("includes next steps", async () => {
      const result = await developConcept(state, {
        concept: "Abstract color fields",
      });

      expect(result.nextSteps).toBeDefined();
      expect(Array.isArray(result.nextSteps)).toBe(true);
      expect((result.nextSteps as string[]).length).toBeGreaterThan(0);
    });
  });

  describe("promote_sketch", () => {
    it("promotes a study to drafts stage", async () => {
      // Set up a study-level sketch
      const studySketch = makeSketch({
        id: "study-01",
        title: "Flow Study 1",
        compositionLevel: "study",
        canvas: { width: 600, height: 600 },
      });
      const studyPath = join(state.workspacePath!.replace(/[^/]+$/, ""), "study-01.genart");
      await writeFile(studyPath, serializeGenart(studySketch));
      state.sketches.set("study-01", { definition: studySketch, path: studyPath });
      state.workspace = {
        ...state.workspace!,
        sketches: [
          ...state.workspace!.sketches,
          { file: "study-01.genart", position: { x: 0, y: 0 } },
        ],
      };

      const result = await promoteSketch(state, {
        sketchId: "study-01",
        toStage: "drafts",
      });

      expect(result.success).toBe(true);
      const promoted = result.promotedSketch as Record<string, unknown>;
      expect(promoted.compositionLevel).toBe("sketch");
      expect(promoted.stage).toBe("drafts");
    });

    it("upscales canvas for refinements stage", async () => {
      const result = await promoteSketch(state, {
        sketchId: "test-sketch",
        toStage: "refinements",
      });

      const promoted = result.promotedSketch as Record<string, unknown>;
      const canvas = promoted.canvas as { width: number; height: number };
      expect(canvas.width).toBe(1200); // 800 * 1.5
      expect(canvas.height).toBe(1200);
      expect(promoted.compositionLevel).toBe("developed");
    });

    it("upscales canvas 2x for finals stage", async () => {
      const result = await promoteSketch(state, {
        sketchId: "test-sketch",
        toStage: "finals",
      });

      const promoted = result.promotedSketch as Record<string, unknown>;
      const canvas = promoted.canvas as { width: number; height: number };
      expect(canvas.width).toBe(1600); // 800 * 2
      expect(canvas.height).toBe(1600);
      expect(promoted.compositionLevel).toBe("exhibition");
    });

    it("populates lineage from parent", async () => {
      const result = await promoteSketch(state, {
        sketchId: "test-sketch",
        toStage: "drafts",
      });

      const promoted = result.promotedSketch as Record<string, unknown>;
      const lineage = promoted.lineage as Record<string, unknown>;
      expect(lineage.parentId).toBe("test-sketch");
      expect(lineage.parentTitle).toBe("Test Sketch");
      expect(lineage.generation).toBe(2);
    });

    it("adds promoted sketch to series when specified", async () => {
      // Create a series first
      await createSeries(state, {
        label: "Test Series",
        narrative: "Test.",
        intent: "Test.",
        sketchFiles: ["test-sketch.genart"],
      });

      const result = await promoteSketch(state, {
        sketchId: "test-sketch",
        toStage: "drafts",
        seriesId: "test-series",
      });

      expect(result.success).toBe(true);
      const series = state.workspace!.series!.find((s) => s.id === "test-series");
      expect(series!.sketchFiles).toContain("test-sketch-draft.genart");
    });

    it("rejects invalid stage", async () => {
      await expect(
        promoteSketch(state, {
          sketchId: "test-sketch",
          toStage: "invalid" as any,
        }),
      ).rejects.toThrow("Invalid stage");
    });

    it("rejects duplicate promoted sketch ID", async () => {
      await promoteSketch(state, {
        sketchId: "test-sketch",
        toStage: "drafts",
      });

      await expect(
        promoteSketch(state, {
          sketchId: "test-sketch",
          toStage: "drafts",
        }),
      ).rejects.toThrow("already exists");
    });
  });
});
