/**
 * Selection and context tools.
 * get_selection, select_sketch, get_editor_state
 */

import { basename } from "path";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// get_selection
// ---------------------------------------------------------------------------

export interface GetSelectionInput {
  includeAlgorithm?: boolean;
  includePhilosophy?: boolean;
  includeNeighbors?: boolean;
}

export async function getSelection(
  state: EditorState,
  input: GetSelectionInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  const includeAlgorithm = input.includeAlgorithm !== false;
  const includePhilosophy = input.includePhilosophy !== false;
  const includeNeighbors = input.includeNeighbors === true;

  const selected: Record<string, unknown>[] = [];

  for (const id of state.selection) {
    const loaded = state.getSketch(id);
    if (!loaded) continue;

    const def = loaded.definition;
    const ref = ws.sketches.find((s) => s.file === basename(loaded.path));

    const entry: Record<string, unknown> = {
      id: def.id,
      title: def.title,
      path: loaded.path,
      renderer: { type: def.renderer.type, version: def.renderer.version },
      canvas: { preset: undefined, width: def.canvas.width, height: def.canvas.height },
      state: def.state,
      parameters: def.parameters,
      colors: def.colors,
      themes: def.themes ?? [],
      skills: def.skills ?? [],
      position: ref?.position ?? { x: 0, y: 0 },
      snapshotCount: def.snapshots?.length ?? 0,
    };

    if (includePhilosophy) {
      entry.philosophy = def.philosophy ?? null;
    }

    if (includeAlgorithm) {
      entry.algorithm = def.algorithm;
    }

    selected.push(entry);
  }

  // Compute neighbors if requested
  const neighbors: Record<string, unknown>[] = [];
  if (includeNeighbors && selected.length > 0) {
    const selectedIds = new Set(state.selection);

    for (const ref of ws.sketches) {
      const loaded = [...state.sketches.values()].find(
        (v) => basename(v.path) === ref.file,
      );
      if (!loaded || selectedIds.has(loaded.definition.id)) continue;

      // Check if within 2000px of any selected sketch
      const isNear = selected.some((sel) => {
        const selPos = sel.position as { x: number; y: number };
        const dx = Math.abs(ref.position.x - selPos.x);
        const dy = Math.abs(ref.position.y - selPos.y);
        return dx <= 2000 && dy <= 2000;
      });

      if (isNear) {
        neighbors.push({
          id: loaded.definition.id,
          title: loaded.definition.title,
          renderer: loaded.definition.renderer.type,
          position: ref.position,
        });
      }
    }
  }

  return {
    selected,
    workspace: {
      id: ws.id,
      title: ws.title,
      sketchCount: ws.sketches.length,
    },
    neighbors,
  };
}

// ---------------------------------------------------------------------------
// select_sketch
// ---------------------------------------------------------------------------

export interface SelectSketchInput {
  sketchIds: string[];
  addToSelection?: boolean;
}

export async function selectSketch(
  state: EditorState,
  input: SelectSketchInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();

  if (!input.sketchIds || input.sketchIds.length === 0) {
    throw new Error("At least one sketch ID is required");
  }

  // Validate all IDs exist
  for (const id of input.sketchIds) {
    state.requireSketch(id);
  }

  if (input.addToSelection) {
    for (const id of input.sketchIds) {
      state.selection.add(id);
    }
  } else {
    state.setSelection(input.sketchIds);
  }

  const selected = [...state.selection];
  state.emitMutation("selection:changed", { selected });

  return {
    success: true,
    selected,
    selectionCount: selected.length,
  };
}

// ---------------------------------------------------------------------------
// get_editor_state
// ---------------------------------------------------------------------------

export async function getEditorState(
  state: EditorState,
): Promise<Record<string, unknown>> {
  if (!state.workspace) {
    return {
      hasWorkspace: false,
      workingDirectory: state.basePath,
      workspace: null,
      selection: [],
      sketches: [],
    };
  }

  const ws = state.workspace;
  const sketches = [...state.sketches.values()].map((loaded) => {
    const def = loaded.definition;
    return {
      id: def.id,
      title: def.title,
      renderer: def.renderer.type,
      canvas: { width: def.canvas.width, height: def.canvas.height },
      parameterCount: def.parameters.length,
      colorCount: def.colors.length,
      seed: def.state.seed,
    };
  });

  return {
    hasWorkspace: true,
    workingDirectory: state.basePath,
    workspace: {
      id: ws.id,
      title: ws.title,
      path: state.workspacePath,
      sketchCount: ws.sketches.length,
      viewport: ws.viewport,
      groups: ws.groups ?? [],
    },
    selection: [...state.selection],
    sketches,
  };
}
