/**
 * Workspace management tools.
 * create_workspace, open_workspace, add_sketch_to_workspace,
 * remove_sketch_from_workspace, list_workspace_sketches
 */

import { readFile, writeFile, stat } from "fs/promises";
import { basename, dirname } from "path";
import {
  parseGenart,
  parseWorkspace,
  serializeWorkspace,
  type SketchDefinition,
  type WorkspaceDefinition,
  type WorkspaceSketchRef,
} from "@genart-dev/core";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

function kebabify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

// resolvePath removed — use state.resolvePath() for sandbox-aware path resolution

/**
 * Arrange sketches in a grid, row, or column layout.
 * Returns position assignments.
 */
function arrangePositions(
  sketches: { file: string; width: number; height: number }[],
  layout: "grid" | "row" | "column",
  spacing: number,
): { file: string; position: { x: number; y: number } }[] {
  if (sketches.length === 0) return [];

  if (layout === "row") {
    let x = 0;
    return sketches.map((s) => {
      const pos = { file: s.file, position: { x, y: 0 } };
      x += s.width + spacing;
      return pos;
    });
  }

  if (layout === "column") {
    let y = 0;
    return sketches.map((s) => {
      const pos = { file: s.file, position: { x: 0, y } };
      y += s.height + spacing;
      return pos;
    });
  }

  // grid (default): row-major, cols = ceil(sqrt(n))
  const cols = Math.ceil(Math.sqrt(sketches.length));
  const maxW = Math.max(...sketches.map((s) => s.width));
  const maxH = Math.max(...sketches.map((s) => s.height));
  const cellW = maxW + spacing;
  const cellH = maxH + spacing;

  return sketches.map((s, i) => ({
    file: s.file,
    position: {
      x: (i % cols) * cellW,
      y: Math.floor(i / cols) * cellH,
    },
  }));
}

/**
 * Compute a viewport that fits all sketches.
 */
function computeViewport(
  positions: { position: { x: number; y: number }; width?: number; height?: number }[],
): { x: number; y: number; zoom: number } {
  if (positions.length === 0) return { x: 0, y: 0, zoom: 1 };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of positions) {
    const w = p.width ?? 1200;
    const h = p.height ?? 1200;
    if (p.position.x < minX) minX = p.position.x;
    if (p.position.y < minY) minY = p.position.y;
    if (p.position.x + w > maxX) maxX = p.position.x + w;
    if (p.position.y + h > maxY) maxY = p.position.y + h;
  }

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const totalW = maxX - minX;
  const totalH = maxY - minY;
  // Assume ~1920x1080 viewport; fit all sketches with some margin
  const zoom = Math.min(1, Math.min(1920 / (totalW + 200), 1080 / (totalH + 200)));
  return { x: Math.round(centerX), y: Math.round(centerY), zoom: Math.round(zoom * 100) / 100 };
}

// ---------------------------------------------------------------------------
// create_workspace
// ---------------------------------------------------------------------------

export interface CreateWorkspaceInput {
  title: string;
  path: string;
  sketches?: string[];
  arrangement?: "grid" | "row" | "column";
  spacing?: number;
}

export async function createWorkspace(
  state: EditorState,
  input: CreateWorkspaceInput,
): Promise<Record<string, unknown>> {
  const absPath = state.resolvePath(input.path);

  if (!absPath.endsWith(".genart-workspace")) {
    throw new Error("Path must end with .genart-workspace");
  }

  if (!state.remoteMode) {
    const parentDir = dirname(absPath);
    if (!(await dirExists(parentDir))) {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
    if (await fileExists(absPath)) {
      throw new Error(
        `Workspace already exists at ${absPath}. Use open_workspace to load it.`,
      );
    }
  }

  // Load and validate initial sketches
  const sketchRefs: WorkspaceSketchRef[] = [];
  const sketchDefs: { file: string; width: number; height: number }[] = [];

  if (input.sketches && input.sketches.length > 0) {
    for (const sketchPath of input.sketches) {
      const absSketchPath = state.resolvePath(sketchPath);
      if (!(await fileExists(absSketchPath))) {
        throw new Error(`Sketch file not found: ${absSketchPath}`);
      }
      try {
        const raw = await readFile(absSketchPath, "utf-8");
        const json = JSON.parse(raw) as unknown;
        const def = parseGenart(json);
        sketchDefs.push({
          file: basename(absSketchPath),
          width: def.canvas.width,
          height: def.canvas.height,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Invalid .genart file: ${absSketchPath} — ${msg}`);
      }
    }

    // Arrange sketches
    const layout = input.arrangement ?? "grid";
    const spacing = input.spacing ?? 200;
    const positions = arrangePositions(sketchDefs, layout, spacing);

    for (const p of positions) {
      sketchRefs.push({ file: p.file, position: p.position });
    }
  }

  const viewport = computeViewport(
    sketchRefs.map((r) => {
      const def = sketchDefs.find((d) => d.file === r.file);
      return { position: r.position, width: def?.width, height: def?.height };
    }),
  );

  const ts = now();
  const ws: WorkspaceDefinition = {
    "genart-workspace": "1.0",
    id: kebabify(input.title),
    title: input.title,
    created: ts,
    modified: ts,
    viewport,
    sketches: sketchRefs,
  };

  // Serialize workspace JSON
  const json = serializeWorkspace(ws);

  if (state.remoteMode) {
    // Remote mode: can't write to user's filesystem — set state directly,
    // file content is returned in the response for the client to write.
    state.workspacePath = absPath;
    state.workspace = ws;
    state.sketches.clear();
    state.selection.clear();
    state.emitMutation("workspace:loaded", { path: absPath, title: ws.title });
  } else {
    // Local mode: write to disk and load (which also loads referenced sketches)
    await writeFile(absPath, json, "utf-8");
    await state.loadWorkspace(absPath);
  }
  state.emitMutation("workspace:updated", { path: absPath });

  return {
    success: true,
    path: absPath,
    title: input.title,
    sketchCount: sketchRefs.length,
    viewport,
    fileContent: json,
  };
}

// ---------------------------------------------------------------------------
// open_workspace
// ---------------------------------------------------------------------------

export interface OpenWorkspaceInput {
  path: string;
}

export async function openWorkspace(
  state: EditorState,
  input: OpenWorkspaceInput,
): Promise<Record<string, unknown>> {
  const absPath = state.resolvePath(input.path);

  if (!absPath.endsWith(".genart-workspace")) {
    throw new Error("Path must end with .genart-workspace");
  }

  if (!(await fileExists(absPath))) {
    throw new Error(`Workspace not found: ${absPath}`);
  }

  // Load workspace (this validates and loads all sketches)
  try {
    await state.loadWorkspace(absPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Distinguish parse errors from missing sketch files
    if (msg.includes("not found") || msg.includes("ENOENT")) {
      throw e;
    }
    throw new Error(`Invalid workspace file: ${absPath} — ${msg}`);
  }

  const ws = state.requireWorkspace();

  // Build sketch summaries
  const sketches = ws.sketches.map((ref) => {
    const loaded = state.getSketch(
      // Find by filename match
      [...state.sketches.entries()].find(
        ([, v]) => basename(v.path) === ref.file,
      )?.[0] ?? "",
    );
    const def = loaded?.definition;
    return {
      file: ref.file,
      position: ref.position,
      label: ref.label,
      id: def?.id,
      title: def?.title,
      renderer: def?.renderer ? { type: def.renderer.type, version: def.renderer.version } : undefined,
      canvas: def?.canvas ? { width: def.canvas.width, height: def.canvas.height } : undefined,
      locked: ref.locked ?? false,
      visible: ref.visible ?? true,
    };
  });

  state.emitMutation("workspace:updated", { path: absPath });

  return {
    success: true,
    path: absPath,
    id: ws.id,
    title: ws.title,
    viewport: ws.viewport,
    sketchCount: ws.sketches.length,
    sketches,
    groups: ws.groups ?? [],
  };
}

// ---------------------------------------------------------------------------
// add_sketch_to_workspace
// ---------------------------------------------------------------------------

export interface AddSketchToWorkspaceInput {
  sketchPath: string;
  position?: { x: number; y: number };
  label?: string;
}

export async function addSketchToWorkspace(
  state: EditorState,
  input: AddSketchToWorkspaceInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();
  const absSketchPath = state.resolvePath(input.sketchPath);

  if (!(await fileExists(absSketchPath))) {
    throw new Error(`Sketch file not found: ${absSketchPath}`);
  }

  const file = basename(absSketchPath);

  // Check for duplicate
  if (ws.sketches.some((s) => s.file === file)) {
    throw new Error(
      `Sketch '${file}' is already in the workspace`,
    );
  }

  // Validate the sketch
  let def: SketchDefinition;
  try {
    def = await state.loadSketch(absSketchPath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Invalid .genart file: ${absSketchPath} — ${msg}`);
  }

  // Auto-position if not specified: place to the right of the rightmost sketch
  const position = input.position ?? autoPosition(ws, def);

  const newRef: WorkspaceSketchRef = {
    file,
    position,
    ...(input.label ? { label: input.label } : {}),
  };

  // Update workspace (immutable — create new object)
  state.workspace = {
    ...ws,
    modified: now(),
    sketches: [...ws.sketches, newRef],
  };

  await state.saveWorkspace();
  state.emitMutation("workspace:updated", { added: file });

  return {
    success: true,
    file,
    id: def.id,
    title: def.title,
    position,
    sketchCount: state.workspace.sketches.length,
  };
}

function autoPosition(
  ws: WorkspaceDefinition,
  def: SketchDefinition,
): { x: number; y: number } {
  if (ws.sketches.length === 0) return { x: 0, y: 0 };

  // Place to the right of the rightmost sketch
  let maxRight = -Infinity;
  for (const s of ws.sketches) {
    const right = s.position.x + 1200; // Assume 1200 default width
    if (right > maxRight) maxRight = right;
  }
  return { x: maxRight + 200, y: 0 };
}

// ---------------------------------------------------------------------------
// remove_sketch_from_workspace
// ---------------------------------------------------------------------------

export interface RemoveSketchFromWorkspaceInput {
  sketchId: string;
  deleteFile?: boolean;
}

export async function removeSketchFromWorkspace(
  state: EditorState,
  input: RemoveSketchFromWorkspaceInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  // Find the sketch by ID
  const loaded = state.getSketch(input.sketchId);
  if (!loaded) {
    throw new Error(`Sketch not found: '${input.sketchId}'`);
  }

  const file = basename(loaded.path);
  const hadSketch = ws.sketches.some((s) => s.file === file);
  if (!hadSketch) {
    throw new Error(`Sketch '${input.sketchId}' is not in the workspace`);
  }

  // Remove from sketches and groups
  const newSketches = ws.sketches.filter((s) => s.file !== file);
  const newGroups = ws.groups?.map((g) => ({
    ...g,
    sketchFiles: g.sketchFiles.filter((f) => f !== file),
  })).filter((g) => g.sketchFiles.length > 0);

  state.workspace = {
    ...ws,
    modified: now(),
    sketches: newSketches,
    ...(newGroups && newGroups.length > 0 ? { groups: newGroups } : {}),
  };

  // Remove from state cache
  state.sketches.delete(input.sketchId);
  state.selection.delete(input.sketchId);

  // Optionally delete the file
  if (input.deleteFile) {
    const { unlink } = await import("fs/promises");
    try {
      await unlink(loaded.path);
    } catch {
      // File may already be deleted
    }
  }

  await state.saveWorkspace();
  state.emitMutation("workspace:updated", { removed: file });

  return {
    success: true,
    removedId: input.sketchId,
    removedFile: file,
    fileDeleted: input.deleteFile ?? false,
    sketchCount: state.workspace.sketches.length,
  };
}

// ---------------------------------------------------------------------------
// list_workspace_sketches
// ---------------------------------------------------------------------------

export interface ListWorkspaceSketchesInput {
  includeState?: boolean;
}

export async function listWorkspaceSketches(
  state: EditorState,
  input: ListWorkspaceSketchesInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  const sketches = ws.sketches.map((ref) => {
    // Find loaded sketch by filename
    const loaded = [...state.sketches.values()].find(
      (v) => basename(v.path) === ref.file,
    );
    const def = loaded?.definition;

    const entry: Record<string, unknown> = {
      file: ref.file,
      position: ref.position,
      label: ref.label,
      id: def?.id,
      title: def?.title,
      renderer: def?.renderer.type,
      canvas: def ? { width: def.canvas.width, height: def.canvas.height } : undefined,
      parameterCount: def?.parameters.length ?? 0,
      colorCount: def?.colors.length ?? 0,
      locked: ref.locked ?? false,
      visible: ref.visible ?? true,
    };

    if (input.includeState && def) {
      entry.state = def.state;
    }

    return entry;
  });

  return {
    success: true,
    workspace: {
      id: ws.id,
      title: ws.title,
      path: state.workspacePath,
    },
    sketchCount: sketches.length,
    sketches,
  };
}
