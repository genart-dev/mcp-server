/**
 * Merge tool.
 * merge_sketches
 */

import { basename, dirname, join } from "path";
import { writeFile } from "fs/promises";
import {
  serializeGenart,
  type SketchDefinition,
  type ParamDef,
  type ColorDef,
  type ThemeDef,
  type RendererType,
} from "@genart-dev/core";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

const VALID_STRATEGIES = ["blend", "layer", "alternate"] as const;
type MergeStrategy = (typeof VALID_STRATEGIES)[number];

/** Merge parameters using the blend strategy: union with first-wins on conflicts. */
function blendParameters(sources: SketchDefinition[]): ParamDef[] {
  const seen = new Set<string>();
  const result: ParamDef[] = [];

  for (const source of sources) {
    for (const param of source.parameters) {
      if (!seen.has(param.key)) {
        seen.add(param.key);
        result.push(param);
      }
    }
  }

  return result;
}

/** Merge parameters using the layer strategy: namespace per source. */
function layerParameters(sources: SketchDefinition[]): ParamDef[] {
  const result: ParamDef[] = [];

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const prefix = `source${i + 1}_`;
    for (const param of source.parameters) {
      result.push({
        ...param,
        key: `${prefix}${param.key}`,
        label: `[${i + 1}] ${param.label}`,
      });
    }
  }

  return result;
}

/** Merge parameters using the alternate strategy: odd-indexed sources only. */
function alternateParameters(sources: SketchDefinition[]): ParamDef[] {
  const seen = new Set<string>();
  const result: ParamDef[] = [];

  for (let i = 0; i < sources.length; i += 2) {
    const source = sources[i]!;
    for (const param of source.parameters) {
      if (!seen.has(param.key)) {
        seen.add(param.key);
        result.push(param);
      }
    }
  }

  return result;
}

/** Merge colors: union with first-wins on conflicts. */
function mergeColors(sources: SketchDefinition[]): ColorDef[] {
  const seen = new Set<string>();
  const result: ColorDef[] = [];

  for (const source of sources) {
    for (const color of source.colors) {
      if (!seen.has(color.key)) {
        seen.add(color.key);
        result.push(color);
      }
    }
  }

  return result;
}

/** Merge colors for alternate strategy: even-indexed sources. */
function alternateColors(sources: SketchDefinition[]): ColorDef[] {
  const seen = new Set<string>();
  const result: ColorDef[] = [];

  for (let i = 1; i < sources.length; i += 2) {
    const source = sources[i]!;
    for (const color of source.colors) {
      if (!seen.has(color.key)) {
        seen.add(color.key);
        result.push(color);
      }
    }
  }

  // If no even-indexed sources contributed colors, fall back to all sources
  if (result.length === 0) {
    return mergeColors(sources);
  }

  return result;
}

// ---------------------------------------------------------------------------
// merge_sketches
// ---------------------------------------------------------------------------

export interface MergeSketchesInput {
  sourceIds: string[];
  newId: string;
  title: string;
  strategy?: string;
  renderer?: string;
  canvas?: { width?: number; height?: number };
}

export async function mergeSketches(
  state: EditorState,
  input: MergeSketchesInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  if (!input.sourceIds || input.sourceIds.length < 2) {
    throw new Error("At least 2 source sketches are required");
  }

  // Validate strategy
  const strategy = (input.strategy ?? "blend") as string;
  if (!VALID_STRATEGIES.includes(strategy as MergeStrategy)) {
    throw new Error(
      `Unknown merge strategy: '${strategy}'. Valid strategies: ${VALID_STRATEGIES.join(", ")}`,
    );
  }

  // Check for duplicate ID
  if (state.getSketch(input.newId)) {
    throw new Error(`Sketch with ID '${input.newId}' already exists`);
  }

  // Load all source sketches
  const sources: SketchDefinition[] = [];
  for (const id of input.sourceIds) {
    const loaded = state.requireSketch(id);
    sources.push(loaded.definition);
  }

  // Determine renderer and canvas
  const renderer = (input.renderer ?? sources[0]!.renderer.type) as RendererType;
  const canvasWidth =
    input.canvas?.width ??
    Math.max(...sources.map((s) => s.canvas.width));
  const canvasHeight =
    input.canvas?.height ??
    Math.max(...sources.map((s) => s.canvas.height));

  // Merge parameters based on strategy
  let parameters: ParamDef[];
  let algorithm: string;
  let colors: ColorDef[];

  switch (strategy as MergeStrategy) {
    case "layer":
      parameters = layerParameters(sources);
      colors = mergeColors(sources);
      break;
    case "alternate":
      parameters = alternateParameters(sources);
      colors = alternateColors(sources);
      break;
    case "blend":
    default:
      parameters = blendParameters(sources);
      colors = mergeColors(sources);
      break;
  }

  // Empty algorithm placeholder for AI synthesis
  algorithm = `// Merged from: ${input.sourceIds.join(", ")}\n// Strategy: ${strategy}\n// TODO: Write a unified algorithm combining the source concepts.\n`;

  // Concatenate philosophies
  const philosophyParts = sources
    .filter((s) => s.philosophy)
    .map((s) => `## ${s.title}\n\n${s.philosophy}`);
  const philosophy =
    philosophyParts.length > 0 ? philosophyParts.join("\n\n---\n\n") : undefined;

  // Merge themes (deduplicate by name)
  const themes: ThemeDef[] = [];
  const seenThemeNames = new Set<string>();
  for (const source of sources) {
    for (const theme of source.themes ?? []) {
      if (!seenThemeNames.has(theme.name)) {
        seenThemeNames.add(theme.name);
        themes.push(theme);
      }
    }
  }

  // Merge skills (union, deduplicated)
  const skills = [...new Set(sources.flatMap((s) => s.skills ?? []))];

  // Build initial state
  const params: Record<string, number> = {};
  for (const p of parameters) {
    params[p.key] = p.default;
  }
  const colorPalette = colors.map((c) => c.default);

  // Build lineage with blend sources
  const maxGeneration = Math.max(
    ...sources.map((s) => s.lineage?.generation ?? 1),
  );
  const lineage = {
    blendSources: input.sourceIds,
    generation: maxGeneration + 1,
  };

  const timestamp = now();
  const newDef: SketchDefinition = {
    genart: "1.1",
    id: input.newId,
    title: input.title,
    created: timestamp,
    modified: timestamp,
    ...(skills.length > 0 ? { skills } : {}),
    lineage,
    renderer: { type: renderer, version: sources[0]!.renderer.version },
    canvas: { width: canvasWidth, height: canvasHeight },
    ...(philosophy ? { philosophy } : {}),
    parameters,
    colors,
    ...(themes.length > 0 ? { themes } : {}),
    state: {
      seed: Math.floor(Math.random() * 100000),
      params,
      colorPalette,
    },
    algorithm,
  };

  // Save to disk
  const wsDir = dirname(state.workspacePath!);
  const fileName = `${input.newId}.genart`;
  const filePath = join(wsDir, fileName);
  const json = serializeGenart(newDef);
  await writeFile(filePath, json, "utf-8");

  // Add to state
  state.sketches.set(input.newId, { definition: newDef, path: filePath });

  // Add to workspace
  const maxX = ws.sketches.reduce(
    (max, ref) => Math.max(max, ref.position.x),
    0,
  );
  const newRef = {
    file: fileName,
    position: { x: maxX + 1400, y: 0 },
  };

  state.workspace = {
    ...ws,
    modified: timestamp,
    sketches: [...ws.sketches, newRef],
  };
  await state.saveWorkspace();
  state.emitMutation("sketch:created", { id: input.newId });

  const crossRenderer = sources.some((s) => s.renderer.type !== renderer);

  return {
    success: true,
    sketchId: input.newId,
    title: input.title,
    path: filePath,
    renderer,
    strategy,
    sources: input.sourceIds,
    parameterCount: parameters.length,
    colorCount: colors.length,
    ...(crossRenderer
      ? {
          crossRendererNotice: `Source sketches use different renderers. The merged sketch targets '${renderer}' — the algorithm must be written for this renderer.`,
        }
      : {}),
  };
}
