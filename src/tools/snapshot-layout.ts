/**
 * Snapshot layout tool.
 * snapshot_layout
 */

import { basename } from "path";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// snapshot_layout
// ---------------------------------------------------------------------------

export interface SnapshotLayoutInput {
  includeGroups?: boolean;
  includeState?: boolean;
}

export async function snapshotLayout(
  state: EditorState,
  input: SnapshotLayoutInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  const includeGroups = input.includeGroups !== false;
  const includeState = input.includeState === true;

  // Build sketch summaries
  const sketches: Record<string, unknown>[] = [];
  const rendererCounts: Record<string, number> = {};

  for (const ref of ws.sketches) {
    // Find the loaded sketch by matching file name
    const loaded = [...state.sketches.values()].find(
      (v) => basename(v.path) === ref.file,
    );
    if (!loaded) continue;

    const def = loaded.definition;

    const entry: Record<string, unknown> = {
      id: def.id,
      title: def.title,
      renderer: def.renderer.type,
      position: ref.position,
      canvas: { width: def.canvas.width, height: def.canvas.height },
      parameterCount: def.parameters.length,
      colorCount: def.colors.length,
      snapshotCount: def.snapshots?.length ?? 0,
      locked: false,
      visible: true,
    };

    if (includeState) {
      entry.state = {
        seed: def.state.seed,
        params: def.state.params,
        colorPalette: def.state.colorPalette,
      };
    }

    sketches.push(entry);

    // Count renderers
    const rt = def.renderer.type;
    rendererCounts[rt] = (rendererCounts[rt] ?? 0) + 1;
  }

  // Compute bounding box
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const sketch of sketches) {
    const pos = sketch.position as { x: number; y: number };
    const canvas = sketch.canvas as { width: number; height: number };
    if (pos.x < minX) minX = pos.x;
    if (pos.y < minY) minY = pos.y;
    if (pos.x + canvas.width > maxX) maxX = pos.x + canvas.width;
    if (pos.y + canvas.height > maxY) maxY = pos.y + canvas.height;
  }

  const boundingBox =
    sketches.length > 0
      ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
      : { x: 0, y: 0, width: 0, height: 0 };

  // Build groups
  const groups: Record<string, unknown>[] = [];
  if (includeGroups && ws.groups) {
    for (const group of ws.groups) {
      // Map sketchFiles to sketch IDs
      const sketchIds: string[] = [];
      for (const file of group.sketchFiles) {
        const loaded = [...state.sketches.values()].find(
          (v) => basename(v.path) === file,
        );
        if (loaded) {
          sketchIds.push(loaded.definition.id);
        }
      }

      groups.push({
        id: group.id,
        label: group.label,
        sketchIds,
        ...(group.color ? { color: group.color } : {}),
      });
    }
  }

  const result: Record<string, unknown> = {
    success: true,
    workspace: {
      id: ws.id,
      title: ws.title,
      viewport: ws.viewport,
    },
    sketches,
    boundingBox,
    totalSketches: sketches.length,
    rendererBreakdown: rendererCounts,
  };

  if (includeGroups) {
    result.groups = groups;
  }

  return result;
}
