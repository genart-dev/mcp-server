/**
 * Series & conceptual development tools — Phase 3 (ADRs 054, 056).
 * create_series, develop_concept, series_summary, promote_sketch
 */

import { writeFile } from "fs/promises";
import { basename, dirname, resolve } from "path";
import {
  serializeGenart,
  serializeWorkspace,
  type CompositionLevel,
  type SeriesStage,
  type SketchDefinition,
  type WorkspaceSeries,
} from "@genart-dev/core";
import type { EditorState } from "../state.js";
import { captureBatch, type BatchItemResult } from "./capture.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateKebabId(id: string): void {
  if (!KEBAB_RE.test(id)) {
    throw new Error(
      "ID must be kebab-case: lowercase letters, numbers, hyphens",
    );
  }
}

const VALID_STAGES: readonly SeriesStage[] = [
  "studies",
  "drafts",
  "refinements",
  "finals",
];

/** Map from stage to recommended compositionLevel. */
const STAGE_TO_LEVEL: Record<SeriesStage, CompositionLevel> = {
  studies: "study",
  drafts: "sketch",
  refinements: "developed",
  finals: "exhibition",
};

/** Map from compositionLevel to recommended next stage. */
const LEVEL_TO_NEXT_STAGE: Record<CompositionLevel, SeriesStage | null> = {
  study: "drafts",
  sketch: "refinements",
  developed: "finals",
  exhibition: null,
};

/** Canvas scale factor per compositionLevel. */
const LEVEL_SCALE: Record<CompositionLevel, number> = {
  study: 1,
  sketch: 1,
  developed: 1.5,
  exhibition: 2,
};

// ---------------------------------------------------------------------------
// create_series
// ---------------------------------------------------------------------------

export interface CreateSeriesInput {
  label: string;
  narrative: string;
  intent: string;
  progression?: string;
  stages?: SeriesStage[];
  sketchFiles?: string[];
}

export async function createSeries(
  state: EditorState,
  input: CreateSeriesInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  // Generate a kebab-case ID from the label
  const id = input.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  if (!id) {
    throw new Error("Could not derive a valid ID from the label");
  }

  // Check for duplicate series ID
  if (ws.series?.some((s) => s.id === id)) {
    throw new Error(`Series with ID '${id}' already exists in workspace`);
  }

  const stages = input.stages ?? [...VALID_STAGES];

  // Validate stages
  for (const stage of stages) {
    if (!VALID_STAGES.includes(stage)) {
      throw new Error(
        `Invalid stage: '${stage}'. Valid stages: ${VALID_STAGES.join(", ")}`,
      );
    }
  }

  // Validate sketch files exist in workspace
  const sketchFiles = input.sketchFiles ?? [];
  for (const file of sketchFiles) {
    const found = ws.sketches.some((s) => s.file === file);
    if (!found) {
      throw new Error(
        `Sketch file '${file}' not found in workspace`,
      );
    }
  }

  const series: WorkspaceSeries = {
    id,
    label: input.label,
    narrative: input.narrative,
    intent: input.intent,
    ...(input.progression ? { progression: input.progression } : {}),
    stages,
    sketchFiles,
  };

  // Update workspace
  state.workspace = {
    ...ws,
    modified: now(),
    series: [...(ws.series ?? []), series],
  };

  const workspaceJson = serializeWorkspace(state.workspace);
  if (!state.remoteMode) {
    await writeFile(state.workspacePath!, workspaceJson, "utf-8");
  }

  state.emitMutation("workspace:updated", { seriesAdded: id });

  return {
    success: true,
    series: {
      id,
      label: input.label,
      narrative: input.narrative,
      intent: input.intent,
      stages,
      sketchCount: sketchFiles.length,
    },
    workspaceContent: workspaceJson,
  };
}

// ---------------------------------------------------------------------------
// develop_concept
// ---------------------------------------------------------------------------

export interface DevelopConceptInput {
  concept: string;
  medium?: string;
}

export async function developConcept(
  _state: EditorState,
  input: DevelopConceptInput,
): Promise<Record<string, unknown>> {
  // This tool returns a structured concept plan for the agent to execute.
  // It doesn't modify state — it provides a framework for creative development.

  const medium = input.medium ?? "p5";

  return {
    success: true,
    conceptPlan: {
      concept: input.concept,
      medium,
      mood: {
        instruction: "Define the emotional quality this concept should evoke.",
        prompts: [
          "What feeling should the viewer experience?",
          "Is this contemplative, energetic, unsettling, serene?",
          "What time of day, season, or environment does this concept suggest?",
        ],
      },
      palette: {
        instruction: "Design a color strategy that serves the mood.",
        prompts: [
          "What color temperature dominates (warm/cool)?",
          "How many distinct hues are needed?",
          "Should saturation be high (bold, graphic) or low (subtle, atmospheric)?",
          "What value range (light-to-dark contrast) supports the concept?",
        ],
      },
      composition: {
        instruction: "Plan the spatial structure.",
        prompts: [
          "Where should the viewer's eye land first?",
          "Is the composition centered, asymmetric, or edge-driven?",
          "How does negative space contribute to the concept?",
          "What rhythm (regular, progressive, chaotic) serves the idea?",
        ],
      },
      skills: {
        instruction: "Identify design skills to load for this concept.",
        prompts: [
          "Which composition skill applies (rule-of-thirds, golden-ratio, gestalt)?",
          "Which color skill applies (color-harmony, color-temperature, simultaneous-contrast)?",
          "Are there process skills needed (layering-strategy, iterative-refinement, thumbnail-studies)?",
          "Consider using `suggest_skills` with the concept as context.",
        ],
      },
      seriesStructure: {
        instruction: "Plan the body of work.",
        prompts: [
          "How many studies should explore the core idea (3-6 recommended)?",
          "What aspect varies between studies (color, density, rhythm, scale)?",
          "Which studies should be developed further into drafts?",
          "What progression tells the most compelling story?",
        ],
        recommendedStages: ["studies", "drafts", "refinements", "finals"],
      },
    },
    nextSteps: [
      "1. Use `create_series` with a label, narrative, and intent derived from this plan.",
      "2. Create 3-6 study-level sketches using `create_sketch` with compositionLevel: 'study'.",
      "3. Use `critique_sketch` on each study to evaluate against the concept.",
      "4. Use `promote_sketch` to advance the best studies to drafts.",
      "5. Iterate: critique → refine → promote through stages.",
      "6. Use `series_summary` to capture the full progression.",
    ],
  };
}

// ---------------------------------------------------------------------------
// series_summary
// ---------------------------------------------------------------------------

export interface SeriesSummaryInput {
  seriesId: string;
  captureScreenshots?: boolean;
  previewSize?: number;
}

export interface SeriesSummaryResult {
  metadata: Record<string, unknown>;
  previews?: Array<{ sketchId: string; inlineJpegBase64: string }>;
}

export async function seriesSummary(
  state: EditorState,
  input: SeriesSummaryInput,
): Promise<SeriesSummaryResult> {
  const ws = state.requireWorkspace();

  const series = ws.series?.find((s) => s.id === input.seriesId);
  if (!series) {
    throw new Error(`Series '${input.seriesId}' not found in workspace`);
  }

  // Gather sketch info for each file in the series
  const sketchInfos: Array<Record<string, unknown>> = [];
  const loadedIds: string[] = [];

  for (const file of series.sketchFiles) {
    // Find the sketch by file name
    let found = false;
    for (const [id, loaded] of state.sketches) {
      if (basename(loaded.path) === file) {
        const def = loaded.definition;
        sketchInfos.push({
          id,
          title: def.title,
          file,
          compositionLevel: def.compositionLevel ?? "sketch",
          lineage: def.lineage ?? null,
          renderer: def.renderer.type,
          canvas: `${def.canvas.width}x${def.canvas.height}`,
          seed: def.state.seed,
          parameterCount: def.parameters.length,
          colorCount: def.colors.length,
          philosophy: def.philosophy ?? null,
        });
        loadedIds.push(id);
        found = true;
        break;
      }
    }
    if (!found) {
      sketchInfos.push({ file, status: "not loaded" });
    }
  }

  // Optionally capture screenshots
  let previews: Array<{ sketchId: string; inlineJpegBase64: string }> | undefined;
  if (input.captureScreenshots !== false && loadedIds.length > 0) {
    const batchResult = await captureBatch(state, {
      sketchIds: loadedIds,
      previewSize: input.previewSize ?? 300,
    });
    previews = batchResult.items.map((item: BatchItemResult) => ({
      sketchId: (item.metadata as Record<string, unknown>)["sketchId"] as string,
      inlineJpegBase64: item.inlineJpegBase64,
    }));
  }

  const metadata: Record<string, unknown> = {
    success: true,
    series: {
      id: series.id,
      label: series.label,
      narrative: series.narrative,
      intent: series.intent,
      progression: series.progression ?? null,
      stages: series.stages ?? null,
    },
    sketches: sketchInfos,
    summary: {
      totalSketches: series.sketchFiles.length,
      loadedSketches: loadedIds.length,
      compositionLevels: countBy(
        sketchInfos
          .filter((s) => s["compositionLevel"])
          .map((s) => s["compositionLevel"] as string),
      ),
    },
    instructions: [
      "Review the series progression from studies through finals.",
      "Evaluate whether the narrative and intent are reflected in the body of work.",
      "Consider: does each sketch build on its predecessors? Is there a clear evolution?",
      "Identify the strongest and weakest pieces. What makes them succeed or fail?",
      "Document insights and decisions in the series narrative.",
    ],
  };

  return { metadata, previews };
}

// ---------------------------------------------------------------------------
// promote_sketch
// ---------------------------------------------------------------------------

export interface PromoteSketchInput {
  sketchId: string;
  toStage: SeriesStage;
  seriesId?: string;
  newId?: string;
  title?: string;
  agent?: string;
  model?: string;
}

export async function promoteSketch(
  state: EditorState,
  input: PromoteSketchInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();
  const source = state.requireSketch(input.sketchId);
  const sourceDef = source.definition;

  // Validate stage
  if (!VALID_STAGES.includes(input.toStage)) {
    throw new Error(
      `Invalid stage: '${input.toStage}'. Valid stages: ${VALID_STAGES.join(", ")}`,
    );
  }

  // Determine the target compositionLevel from the stage
  const targetLevel = STAGE_TO_LEVEL[input.toStage];
  const scale = LEVEL_SCALE[targetLevel];

  // Generate new ID
  const newId =
    input.newId ?? `${input.sketchId}-${input.toStage.replace(/s$/, "")}`;
  validateKebabId(newId);

  if (state.getSketch(newId)) {
    throw new Error(`Sketch with ID '${newId}' already exists`);
  }

  // Scale canvas
  const newWidth = Math.round(sourceDef.canvas.width * scale);
  const newHeight = Math.round(sourceDef.canvas.height * scale);

  // Build lineage
  const sourceGeneration = sourceDef.lineage?.generation ?? 1;

  const title =
    input.title ??
    `${sourceDef.title} (${input.toStage.replace(/s$/, "")})`;
  const ts = now();

  const promotedDef: SketchDefinition = {
    genart: "1.1",
    id: newId,
    title,
    created: ts,
    modified: ts,
    renderer: sourceDef.renderer,
    canvas: { width: newWidth, height: newHeight },
    parameters: [...sourceDef.parameters],
    colors: [...sourceDef.colors],
    state: {
      seed: sourceDef.state.seed,
      params: { ...sourceDef.state.params },
      colorPalette: [...sourceDef.state.colorPalette],
    },
    algorithm: sourceDef.algorithm,
    compositionLevel: targetLevel,
    lineage: {
      parentId: input.sketchId,
      parentTitle: sourceDef.title,
      generation: sourceGeneration + 1,
    },
    ...(sourceDef.philosophy ? { philosophy: sourceDef.philosophy } : {}),
    ...(sourceDef.themes ? { themes: [...sourceDef.themes] } : {}),
    ...(sourceDef.skills ? { skills: [...sourceDef.skills] } : {}),
    ...(sourceDef.components ? { components: sourceDef.components } : {}),
    ...(sourceDef.symbols ? { symbols: sourceDef.symbols } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
  };

  // Save to disk
  const sourceDir = dirname(source.path);
  const newPath = resolve(sourceDir, `${newId}.genart`);
  const json = serializeGenart(promotedDef);

  if (!state.remoteMode) {
    await writeFile(newPath, json, "utf-8");
  }

  // Load into state
  state.sketches.set(newId, { definition: promotedDef, path: newPath });

  // Auto-position below the source sketch
  const sourceRef = ws.sketches.find(
    (s) => s.file === basename(source.path),
  );
  const position = sourceRef
    ? { x: sourceRef.position.x, y: sourceRef.position.y + sourceDef.canvas.height + 200 }
    : { x: 0, y: 0 };

  // Add to workspace sketches
  const file = basename(newPath);
  state.workspace = {
    ...ws,
    modified: ts,
    sketches: [...ws.sketches, { file, position }],
  };

  // Add to series if specified
  if (input.seriesId) {
    const seriesIndex = state.workspace.series?.findIndex(
      (s) => s.id === input.seriesId,
    );
    if (seriesIndex !== undefined && seriesIndex >= 0 && state.workspace.series) {
      const series = state.workspace.series[seriesIndex]!;
      const updatedSeries: WorkspaceSeries = {
        ...series,
        sketchFiles: [...series.sketchFiles, file],
      };
      state.workspace = {
        ...state.workspace,
        series: state.workspace.series.map((s, i) =>
          i === seriesIndex ? updatedSeries : s,
        ),
      };
    }
  }

  const workspaceJson = serializeWorkspace(state.workspace);
  if (!state.remoteMode) {
    await writeFile(state.workspacePath!, workspaceJson, "utf-8");
  }

  state.emitMutation("sketch:created", { id: newId, path: newPath });
  state.emitMutation("workspace:updated", { added: file });

  return {
    success: true,
    sourceId: input.sketchId,
    promotedSketch: {
      id: newId,
      title,
      path: newPath,
      compositionLevel: targetLevel,
      stage: input.toStage,
      canvas: { width: newWidth, height: newHeight },
      position,
      lineage: promotedDef.lineage,
    },
    ...(scale > 1
      ? {
          canvasUpscaled: `Canvas scaled ${scale}x: ${sourceDef.canvas.width}x${sourceDef.canvas.height} → ${newWidth}x${newHeight}`,
        }
      : {}),
    fileContent: json,
    workspaceContent: workspaceJson,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function countBy(items: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}
