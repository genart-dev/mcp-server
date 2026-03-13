/**
 * Parameter manipulation tools.
 * set_parameters, set_colors, set_seed, set_canvas_size, randomize_parameters
 */

import {
  resolvePreset,
  type SketchDefinition,
  type SketchState,
} from "@genart-dev/core";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function updateSketchInState(
  state: EditorState,
  id: string,
  newDef: SketchDefinition,
): void {
  const loaded = state.requireSketch(id);
  state.sketches.set(id, { definition: newDef, path: loaded.path });
}

// ---------------------------------------------------------------------------
// set_parameters
// ---------------------------------------------------------------------------

export interface SetParametersInput {
  sketchId: string;
  params: Record<string, number>;
}

export async function setParameters(
  state: EditorState,
  input: SetParametersInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  const validKeys = new Set(def.parameters.map((p) => p.key));
  const updated: string[] = [];

  // Validate all keys and values
  for (const [key, value] of Object.entries(input.params)) {
    if (!validKeys.has(key)) {
      throw new Error(
        `Unknown parameter: '${key}'. Valid keys: ${[...validKeys].join(", ")}`,
      );
    }
    const paramDef = def.parameters.find((p) => p.key === key)!;
    if (value < paramDef.min || value > paramDef.max) {
      throw new Error(
        `Parameter '${key}' value ${value} outside range [${paramDef.min}, ${paramDef.max}]`,
      );
    }
    updated.push(key);
  }

  const newParams = { ...def.state.params, ...input.params };
  const newState: SketchState = { ...def.state, params: newParams };
  const newDef: SketchDefinition = { ...def, modified: now(), state: newState };

  updateSketchInState(state, input.sketchId, newDef);
  await state.saveSketch(input.sketchId);
  state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["params"] });

  return {
    success: true,
    sketchId: input.sketchId,
    updated,
    state: newState,
  };
}

// ---------------------------------------------------------------------------
// set_colors
// ---------------------------------------------------------------------------

export interface SetColorsInput {
  sketchId: string;
  colors: Record<string, string>;
}

export async function setColors(
  state: EditorState,
  input: SetColorsInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  const colorDefs = def.colors;
  const validKeys = new Set(colorDefs.map((c) => c.key));
  const updated: string[] = [];

  // Validate all keys and values
  for (const [key, value] of Object.entries(input.colors)) {
    if (!validKeys.has(key)) {
      throw new Error(
        `Unknown color: '${key}'. Valid keys: ${[...validKeys].join(", ")}`,
      );
    }
    if (!HEX_RE.test(value)) {
      throw new Error(`Invalid hex color for '${key}': '${value}'`);
    }
    updated.push(key);
  }

  // Build new colorPalette array preserving order from color definitions
  const newPalette: string[] = colorDefs.map((cDef) => {
    const override = input.colors[cDef.key];
    if (override !== undefined) {
      return override;
    }
    // Keep existing value from current palette
    const idx = colorDefs.findIndex((c) => c.key === cDef.key);
    return def.state.colorPalette[idx] ?? cDef.default;
  });

  const newState: SketchState = { ...def.state, colorPalette: newPalette };
  const newDef: SketchDefinition = { ...def, modified: now(), state: newState };

  updateSketchInState(state, input.sketchId, newDef);
  await state.saveSketch(input.sketchId);
  state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["colors"] });

  return {
    success: true,
    sketchId: input.sketchId,
    updated,
    colorPalette: newPalette,
  };
}

// ---------------------------------------------------------------------------
// set_seed
// ---------------------------------------------------------------------------

export interface SetSeedInput {
  sketchId: string;
  seed?: number;
}

export async function setSeed(
  state: EditorState,
  input: SetSeedInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  const previousSeed = def.state.seed;
  const newSeed = input.seed ?? Math.floor(Math.random() * 100000);

  const newState: SketchState = { ...def.state, seed: newSeed };
  const newDef: SketchDefinition = { ...def, modified: now(), state: newState };

  updateSketchInState(state, input.sketchId, newDef);
  await state.saveSketch(input.sketchId);
  state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["seed"] });

  return {
    success: true,
    sketchId: input.sketchId,
    seed: newSeed,
    previousSeed,
  };
}

// ---------------------------------------------------------------------------
// set_canvas_size
// ---------------------------------------------------------------------------

export interface SetCanvasSizeInput {
  sketchId: string;
  preset?: string;
  width?: number;
  height?: number;
}

export async function setCanvasSize(
  state: EditorState,
  input: SetCanvasSizeInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  const previousCanvas = { width: def.canvas.width, height: def.canvas.height };

  let newCanvas: { width: number; height: number };
  if (input.preset) {
    newCanvas = resolvePreset(input.preset);
  } else if (input.width !== undefined && input.height !== undefined) {
    newCanvas = { width: input.width, height: input.height };
  } else {
    throw new Error("Provide either a preset or both width and height");
  }

  const newDef: SketchDefinition = { ...def, modified: now(), canvas: newCanvas };

  updateSketchInState(state, input.sketchId, newDef);
  await state.saveSketch(input.sketchId);
  state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["canvas"] });

  return {
    success: true,
    sketchId: input.sketchId,
    canvas: newCanvas,
    previousCanvas,
  };
}

// ---------------------------------------------------------------------------
// randomize_parameters
// ---------------------------------------------------------------------------

export interface RandomizeParametersInput {
  sketchId: string;
  paramKeys?: string[];
  newSeed?: boolean;
}

export async function randomizeParameters(
  state: EditorState,
  input: RandomizeParametersInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  if (def.parameters.length === 0) {
    throw new Error("Sketch has no parameters to randomize");
  }

  // Determine which parameters to randomize
  let paramsToRandomize = def.parameters;
  if (input.paramKeys && input.paramKeys.length > 0) {
    const validKeys = new Set(def.parameters.map((p) => p.key));
    for (const key of input.paramKeys) {
      if (!validKeys.has(key)) {
        throw new Error(
          `Unknown parameter: '${key}'. Valid keys: ${[...validKeys].join(", ")}`,
        );
      }
    }
    const keySet = new Set(input.paramKeys);
    paramsToRandomize = def.parameters.filter((p) => keySet.has(p.key));
  }

  // Generate random values within each parameter's range, respecting step
  const newParams = { ...def.state.params };
  const randomized: string[] = [];
  for (const paramDef of paramsToRandomize) {
    const steps = Math.round((paramDef.max - paramDef.min) / paramDef.step);
    const randomStep = Math.floor(Math.random() * (steps + 1));
    newParams[paramDef.key] = paramDef.min + randomStep * paramDef.step;
    randomized.push(paramDef.key);
  }

  const newSeed = input.newSeed
    ? Math.floor(Math.random() * 100000)
    : def.state.seed;

  const newState: SketchState = { ...def.state, params: newParams, seed: newSeed };
  const newDef: SketchDefinition = { ...def, modified: now(), state: newState };

  updateSketchInState(state, input.sketchId, newDef);
  await state.saveSketch(input.sketchId);
  state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["params"] });

  return {
    success: true,
    sketchId: input.sketchId,
    randomized,
    state: newState,
  };
}
