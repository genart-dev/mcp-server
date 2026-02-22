/**
 * Spatial arrangement tools.
 * arrange_sketches, auto_arrange, group_sketches
 */

import { basename } from "path";
import type { WorkspaceDefinition, WorkspaceGroup } from "@genart-dev/core";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

/** Get sketch dimensions from the loaded state. */
function getSketchDimensions(
  state: EditorState,
  sketchId: string,
): { width: number; height: number } {
  const loaded = state.getSketch(sketchId);
  if (!loaded) return { width: 1200, height: 1200 };
  return {
    width: loaded.definition.canvas.width,
    height: loaded.definition.canvas.height,
  };
}

/** Compute a viewport that fits all positions. */
function computeViewport(
  positions: { position: { x: number; y: number }; width: number; height: number }[],
): { x: number; y: number; zoom: number } {
  if (positions.length === 0) return { x: 0, y: 0, zoom: 1 };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of positions) {
    if (p.position.x < minX) minX = p.position.x;
    if (p.position.y < minY) minY = p.position.y;
    if (p.position.x + p.width > maxX) maxX = p.position.x + p.width;
    if (p.position.y + p.height > maxY) maxY = p.position.y + p.height;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const totalW = maxX - minX;
  const totalH = maxY - minY;
  const zoom = Math.min(
    1,
    Math.min(1920 / (totalW + 200), 1080 / (totalH + 200)),
  );
  return {
    x: Math.round(centerX),
    y: Math.round(centerY),
    zoom: Math.round(zoom * 100) / 100,
  };
}

/** Layout sketches in a grid pattern. */
function layoutGrid(
  items: { id: string; width: number; height: number }[],
  spacing: number,
  origin: { x: number; y: number },
): { id: string; position: { x: number; y: number } }[] {
  if (items.length === 0) return [];

  const cols = Math.ceil(Math.sqrt(items.length));
  const maxW = Math.max(...items.map((s) => s.width));
  const maxH = Math.max(...items.map((s) => s.height));
  const cellW = maxW + spacing;
  const cellH = maxH + spacing;

  return items.map((s, i) => ({
    id: s.id,
    position: {
      x: origin.x + (i % cols) * cellW,
      y: origin.y + Math.floor(i / cols) * cellH,
    },
  }));
}

/** Layout sketches in a row. */
function layoutRow(
  items: { id: string; width: number; height: number }[],
  spacing: number,
  origin: { x: number; y: number },
): { id: string; position: { x: number; y: number } }[] {
  let x = origin.x;
  return items.map((s) => {
    const pos = { id: s.id, position: { x, y: origin.y } };
    x += s.width + spacing;
    return pos;
  });
}

/** Layout sketches in a column. */
function layoutColumn(
  items: { id: string; width: number; height: number }[],
  spacing: number,
  origin: { x: number; y: number },
): { id: string; position: { x: number; y: number } }[] {
  let y = origin.y;
  return items.map((s) => {
    const pos = { id: s.id, position: { x: origin.x, y } };
    y += s.height + spacing;
    return pos;
  });
}

/** Layout sketches in a masonry pattern (shortest column first). */
function layoutMasonry(
  items: { id: string; width: number; height: number }[],
  spacing: number,
  origin: { x: number; y: number },
): { id: string; position: { x: number; y: number } }[] {
  if (items.length === 0) return [];

  const cols = Math.ceil(Math.sqrt(items.length));
  const maxW = Math.max(...items.map((s) => s.width));
  const cellW = maxW + spacing;

  // Track the current height of each column
  const columnHeights = new Array(cols).fill(0) as number[];
  const result: { id: string; position: { x: number; y: number } }[] = [];

  for (const item of items) {
    // Find the shortest column
    let minCol = 0;
    for (let c = 1; c < cols; c++) {
      if (columnHeights[c]! < columnHeights[minCol]!) minCol = c;
    }

    result.push({
      id: item.id,
      position: {
        x: origin.x + minCol * cellW,
        y: origin.y + columnHeights[minCol]!,
      },
    });

    columnHeights[minCol]! += item.height + spacing;
  }

  return result;
}

const VALID_LAYOUTS = ["grid", "row", "column", "masonry"] as const;
type LayoutType = (typeof VALID_LAYOUTS)[number];

function applyLayout(
  items: { id: string; width: number; height: number }[],
  layout: LayoutType,
  spacing: number,
  origin: { x: number; y: number },
): { id: string; position: { x: number; y: number } }[] {
  switch (layout) {
    case "row":
      return layoutRow(items, spacing, origin);
    case "column":
      return layoutColumn(items, spacing, origin);
    case "masonry":
      return layoutMasonry(items, spacing, origin);
    case "grid":
    default:
      return layoutGrid(items, spacing, origin);
  }
}

// ---------------------------------------------------------------------------
// arrange_sketches
// ---------------------------------------------------------------------------

export interface ArrangeSketchesInput {
  positions: { sketchId: string; x: number; y: number }[];
}

export async function arrangeSketches(
  state: EditorState,
  input: ArrangeSketchesInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  if (!input.positions || input.positions.length === 0) {
    throw new Error("At least one position is required");
  }

  // Validate all sketch IDs
  for (const pos of input.positions) {
    state.requireSketch(pos.sketchId);
  }

  // Build a map of sketchId → file for workspace refs
  const idToFile = new Map<string, string>();
  for (const [id, loaded] of state.sketches) {
    idToFile.set(id, basename(loaded.path));
  }

  // Update positions in workspace
  const positionMap = new Map(
    input.positions.map((p) => [idToFile.get(p.sketchId)!, { x: p.x, y: p.y }]),
  );

  const newSketches = ws.sketches.map((ref) => {
    const newPos = positionMap.get(ref.file);
    if (newPos) {
      return { ...ref, position: newPos };
    }
    return ref;
  });

  // Compute viewport for moved sketches
  const viewportItems = input.positions.map((p) => {
    const dims = getSketchDimensions(state, p.sketchId);
    return { position: { x: p.x, y: p.y }, width: dims.width, height: dims.height };
  });
  const viewport = computeViewport(viewportItems);

  state.workspace = { ...ws, modified: now(), sketches: newSketches, viewport };
  await state.saveWorkspace();
  state.emitMutation("workspace:updated", { arranged: input.positions.length });

  return {
    success: true,
    moved: input.positions.length,
    positions: input.positions.map((p) => ({
      id: p.sketchId,
      position: { x: p.x, y: p.y },
    })),
    viewport,
  };
}

// ---------------------------------------------------------------------------
// auto_arrange
// ---------------------------------------------------------------------------

export interface AutoArrangeInput {
  layout?: string;
  sketchIds?: string[];
  spacing?: number;
  sortBy?: string;
  origin?: { x: number; y: number };
}

export async function autoArrange(
  state: EditorState,
  input: AutoArrangeInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  const layout = (input.layout ?? "grid") as string;
  if (!VALID_LAYOUTS.includes(layout as LayoutType)) {
    throw new Error(
      `Unknown layout: '${layout}'. Valid layouts: ${VALID_LAYOUTS.join(", ")}`,
    );
  }

  const spacing = input.spacing ?? 200;
  const origin = input.origin ?? { x: 0, y: 0 };

  // Determine which sketches to arrange
  let sketchIds: string[];
  if (input.sketchIds && input.sketchIds.length > 0) {
    for (const id of input.sketchIds) {
      state.requireSketch(id);
    }
    sketchIds = input.sketchIds;
  } else {
    // All sketches in workspace
    sketchIds = [...state.sketches.keys()];
  }

  if (sketchIds.length === 0) {
    throw new Error("No sketches to arrange");
  }

  // Sort sketches
  const sortBy = input.sortBy ?? "created";
  const sortedItems = sketchIds
    .map((id) => {
      const loaded = state.requireSketch(id);
      const def = loaded.definition;
      return {
        id,
        title: def.title,
        created: def.created,
        modified: def.modified,
        renderer: def.renderer.type,
        width: def.canvas.width,
        height: def.canvas.height,
      };
    })
    .sort((a, b) => {
      switch (sortBy) {
        case "title":
          return a.title.localeCompare(b.title);
        case "modified":
          return a.modified.localeCompare(b.modified);
        case "renderer":
          return a.renderer.localeCompare(b.renderer);
        case "created":
        default:
          return a.created.localeCompare(b.created);
      }
    });

  // Apply layout
  const arranged = applyLayout(sortedItems, layout as LayoutType, spacing, origin);

  // Build file map and update workspace
  const idToFile = new Map<string, string>();
  for (const [id, loaded] of state.sketches) {
    idToFile.set(id, basename(loaded.path));
  }

  const positionMap = new Map(
    arranged.map((a) => [idToFile.get(a.id)!, a.position]),
  );

  const newSketches = ws.sketches.map((ref) => {
    const newPos = positionMap.get(ref.file);
    if (newPos) {
      return { ...ref, position: newPos };
    }
    return ref;
  });

  // Compute bounding box and viewport
  const viewportItems = arranged.map((a) => {
    const item = sortedItems.find((s) => s.id === a.id)!;
    return { position: a.position, width: item.width, height: item.height };
  });

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const item of viewportItems) {
    if (item.position.x < minX) minX = item.position.x;
    if (item.position.y < minY) minY = item.position.y;
    if (item.position.x + item.width > maxX) maxX = item.position.x + item.width;
    if (item.position.y + item.height > maxY) maxY = item.position.y + item.height;
  }

  const boundingBox = {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };

  const viewport = computeViewport(viewportItems);

  state.workspace = { ...ws, modified: now(), sketches: newSketches, viewport };
  await state.saveWorkspace();
  state.emitMutation("workspace:updated", { arranged: arranged.length });

  return {
    success: true,
    layout,
    arranged: arranged.length,
    positions: arranged.map((a) => ({
      id: a.id,
      position: a.position,
    })),
    boundingBox,
    viewport,
  };
}

// ---------------------------------------------------------------------------
// group_sketches
// ---------------------------------------------------------------------------

export interface GroupSketchesInput {
  groupId: string;
  label: string;
  sketchIds: string[];
  color?: string;
}

export async function groupSketches(
  state: EditorState,
  input: GroupSketchesInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  if (!input.sketchIds || input.sketchIds.length === 0) {
    throw new Error("At least one sketch ID is required");
  }

  // Validate all sketch IDs and collect their file names
  const sketchFiles: string[] = [];
  for (const id of input.sketchIds) {
    const loaded = state.requireSketch(id);
    sketchFiles.push(basename(loaded.path));
  }

  const newGroup: WorkspaceGroup = {
    id: input.groupId,
    label: input.label,
    sketchFiles,
    ...(input.color ? { color: input.color } : {}),
  };

  // Replace existing group with same ID, or add new one
  const existingGroups = ws.groups ?? [];
  const filtered = existingGroups.filter((g) => g.id !== input.groupId);
  const newGroups = [...filtered, newGroup];

  state.workspace = { ...ws, modified: now(), groups: newGroups };
  await state.saveWorkspace();
  state.emitMutation("workspace:updated", { groupUpdated: input.groupId });

  return {
    success: true,
    group: newGroup,
    groupCount: newGroups.length,
  };
}
