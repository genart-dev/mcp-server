/**
 * Core design layer tools — always available, not plugin-contributed.
 * These operate directly on the LayerStackAccessor for the active sketch.
 */

import type {
  DesignLayer,
  LayerTransform,
  LayerProperties,
  BlendMode,
  PluginRegistry,
} from "@genart-dev/core";
import type { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function requireSketchId(
  state: EditorState,
  args: { sketchId?: string },
): string {
  return args.sketchId ?? state.requireSelectedSketchId();
}

const BLEND_MODES: BlendMode[] = [
  "normal", "multiply", "screen", "overlay",
  "darken", "lighten", "color-dodge", "color-burn",
  "hard-light", "soft-light", "difference", "exclusion",
  "hue", "saturation", "color", "luminosity",
];

function generateLayerId(): string {
  return `layer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

export async function designAddLayer(
  state: EditorState,
  args: {
    sketchId?: string;
    type: string;
    name?: string;
    properties?: Record<string, unknown>;
    transform?: Partial<LayerTransform>;
    opacity?: number;
    blendMode?: string;
    index?: number;
  },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const loaded = state.requireSketch(sketchId);
  const stack = state.getLayerStack(sketchId);
  const registry = state.pluginRegistry;

  // Resolve layer type from registry to get defaults
  const layerTypeDef = registry?.resolveLayerType(args.type);
  if (!layerTypeDef) {
    throw new Error(
      `Unknown layer type: '${args.type}'. Use design_list_layers types from registered plugins.`,
    );
  }

  const defaults = layerTypeDef.createDefault();
  const id = generateLayerId();
  const { width, height } = loaded.definition.canvas;

  const layer: DesignLayer = {
    id,
    type: args.type,
    name: args.name ?? layerTypeDef.displayName,
    visible: true,
    locked: false,
    opacity: args.opacity ?? 1,
    blendMode: (args.blendMode as BlendMode) ?? "normal",
    transform: {
      x: 0,
      y: 0,
      width,
      height,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      ...args.transform,
    },
    properties: { ...defaults, ...args.properties },
  };

  stack.add(layer, args.index);
  await state.saveSketch(sketchId);

  return {
    layerId: id,
    type: args.type,
    name: layer.name,
    index: args.index ?? stack.count - 1,
    sketchId,
  };
}

export async function designRemoveLayer(
  state: EditorState,
  args: { sketchId?: string; layerId: string },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const removed = stack.remove(args.layerId);
  if (!removed) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  await state.saveSketch(sketchId);
  return { removed: true, layerId: args.layerId, sketchId };
}

export async function designListLayers(
  state: EditorState,
  args: { sketchId?: string },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);
  const layers = stack.getAll();

  return {
    sketchId,
    count: layers.length,
    layers: layers.map((l, i) => ({
      index: i,
      id: l.id,
      type: l.type,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blendMode: l.blendMode,
    })),
  };
}

export async function designGetLayer(
  state: EditorState,
  args: { sketchId?: string; layerId: string },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const layer = stack.get(args.layerId);
  if (!layer) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  return {
    sketchId,
    layer: {
      id: layer.id,
      type: layer.type,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      transform: layer.transform,
      properties: layer.properties,
    },
  };
}

export async function designUpdateLayer(
  state: EditorState,
  args: {
    sketchId?: string;
    layerId: string;
    name?: string;
    properties?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const layer = stack.get(args.layerId);
  if (!layer) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  const updates: Record<string, unknown> = {};
  if (args.properties) {
    Object.assign(updates, args.properties);
  }

  if (Object.keys(updates).length > 0) {
    stack.updateProperties(args.layerId, updates as Partial<LayerProperties>);
  }

  if (args.name !== undefined) {
    stack.updateMeta(args.layerId, { name: args.name });
  }

  await state.saveSketch(sketchId);
  return { updated: true, layerId: args.layerId, sketchId };
}

export async function designSetTransform(
  state: EditorState,
  args: {
    sketchId?: string;
    layerId: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    anchorX?: number;
    anchorY?: number;
  },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const layer = stack.get(args.layerId);
  if (!layer) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  const mutable: Record<string, number> = {};
  if (args.x !== undefined) mutable.x = args.x;
  if (args.y !== undefined) mutable.y = args.y;
  if (args.width !== undefined) mutable.width = args.width;
  if (args.height !== undefined) mutable.height = args.height;
  if (args.rotation !== undefined) mutable.rotation = args.rotation;
  if (args.scaleX !== undefined) mutable.scaleX = args.scaleX;
  if (args.scaleY !== undefined) mutable.scaleY = args.scaleY;
  if (args.anchorX !== undefined) mutable.anchorX = args.anchorX;
  if (args.anchorY !== undefined) mutable.anchorY = args.anchorY;
  const partial = mutable as Partial<LayerTransform>;

  stack.updateTransform(args.layerId, partial);
  await state.saveSketch(sketchId);

  return {
    updated: true,
    layerId: args.layerId,
    transform: stack.get(args.layerId)!.transform,
    sketchId,
  };
}

export async function designSetBlend(
  state: EditorState,
  args: {
    sketchId?: string;
    layerId: string;
    blendMode?: string;
    opacity?: number;
  },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const layer = stack.get(args.layerId);
  if (!layer) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  if (args.blendMode && !BLEND_MODES.includes(args.blendMode as BlendMode)) {
    throw new Error(
      `Invalid blend mode '${args.blendMode}'. Must be one of: ${BLEND_MODES.join(", ")}`,
    );
  }

  stack.updateBlend(
    args.layerId,
    args.blendMode as BlendMode | undefined,
    args.opacity,
  );
  await state.saveSketch(sketchId);

  const updated = stack.get(args.layerId)!;
  return {
    updated: true,
    layerId: args.layerId,
    blendMode: updated.blendMode,
    opacity: updated.opacity,
    sketchId,
  };
}

export async function designReorderLayers(
  state: EditorState,
  args: { sketchId?: string; layerId: string; newIndex: number },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const layer = stack.get(args.layerId);
  if (!layer) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  stack.reorder(args.layerId, args.newIndex);
  await state.saveSketch(sketchId);

  return {
    reordered: true,
    layerId: args.layerId,
    newIndex: args.newIndex,
    sketchId,
  };
}

export async function designDuplicateLayer(
  state: EditorState,
  args: { sketchId?: string; layerId: string },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const layer = stack.get(args.layerId);
  if (!layer) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  const newId = stack.duplicate(args.layerId);
  await state.saveSketch(sketchId);

  return {
    duplicated: true,
    sourceLayerId: args.layerId,
    newLayerId: newId,
    sketchId,
  };
}

export async function designToggleVisibility(
  state: EditorState,
  args: { sketchId?: string; layerId: string; visible?: boolean },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const layer = stack.get(args.layerId);
  if (!layer) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  const newVisible = args.visible ?? !layer.visible;
  stack.updateMeta(args.layerId, { visible: newVisible });
  await state.saveSketch(sketchId);

  return {
    layerId: args.layerId,
    visible: newVisible,
    sketchId,
  };
}

export async function designLockLayer(
  state: EditorState,
  args: { sketchId?: string; layerId: string; locked?: boolean },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);

  const layer = stack.get(args.layerId);
  if (!layer) {
    throw new Error(`Layer '${args.layerId}' not found in sketch '${sketchId}'.`);
  }

  const newLocked = args.locked ?? !layer.locked;
  stack.updateMeta(args.layerId, { locked: newLocked });
  await state.saveSketch(sketchId);

  return {
    layerId: args.layerId,
    locked: newLocked,
    sketchId,
  };
}

export async function designCaptureComposite(
  state: EditorState,
  args: { sketchId?: string },
): Promise<Record<string, unknown>> {
  const sketchId = requireSketchId(state, args);
  const stack = state.getLayerStack(sketchId);
  const layers = stack.getAll();

  return {
    sketchId,
    layerCount: layers.length,
    visibleCount: layers.filter((l) => l.visible).length,
    message:
      "Composite capture requires a rendering surface. " +
      "Use capture_screenshot to get a rasterized preview of the sketch, " +
      "then use design_list_layers to see the design layer stack.",
  };
}

