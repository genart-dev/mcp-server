/**
 * Gallery tools.
 * list_sketches, search_sketches
 */

import { readdir, readFile, stat } from "fs/promises";
import { basename, dirname, join } from "path";
import { parseGenart } from "@genart-dev/core";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Try to parse a .genart file, returning null on failure. */
async function tryParseGenart(
  absPath: string,
): Promise<{ id: string; title: string; renderer: string; canvas: { width: number; height: number }; parameterCount: number; colorCount: number; snapshotCount: number; hasPhilosophy: boolean; skills: readonly string[]; modified: string; path: string } | null> {
  try {
    const raw = await readFile(absPath, "utf-8");
    const json = JSON.parse(raw) as unknown;
    const def = parseGenart(json);
    return {
      id: def.id,
      title: def.title,
      renderer: def.renderer.type,
      canvas: { width: def.canvas.width, height: def.canvas.height },
      parameterCount: def.parameters.length,
      colorCount: def.colors.length,
      snapshotCount: def.snapshots?.length ?? 0,
      hasPhilosophy: !!def.philosophy,
      skills: def.skills ?? [],
      modified: def.modified,
      path: absPath,
    };
  } catch {
    return null;
  }
}

/** Scan a directory for .genart files. */
async function scanGenartFiles(
  dir: string,
  recursive: boolean,
): Promise<string[]> {
  const results: string[] = [];

  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isFile() && entry.name.endsWith(".genart")) {
      results.push(fullPath);
    } else if (recursive && entry.isDirectory()) {
      const sub = await scanGenartFiles(fullPath, true);
      results.push(...sub);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// list_sketches
// ---------------------------------------------------------------------------

export interface ListSketchesInput {
  directory?: string;
  recursive?: boolean;
  includeUnreferenced?: boolean;
}

export async function listSketches(
  state: EditorState,
  input: ListSketchesInput,
): Promise<Record<string, unknown>> {
  const dir = input.directory
    ? state.resolvePath(input.directory)
    : state.workspacePath
      ? dirname(state.workspacePath)
      : null;
  if (!dir) {
    throw new Error("No workspace is currently open and no directory specified");
  }

  // Verify directory exists
  try {
    const s = await stat(dir);
    if (!s.isDirectory()) {
      throw new Error(`Not a directory: '${dir}'`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Not a directory")) throw e;
    throw new Error(`Directory does not exist: '${dir}'`);
  }

  const recursive = input.recursive ?? false;
  const includeUnreferenced = input.includeUnreferenced !== false;

  // Get workspace file set for inWorkspace flag
  const wsFiles = new Set<string>();
  if (state.workspace) {
    for (const ref of state.workspace.sketches) {
      const absPath = state.resolveSketchPath(ref.file);
      wsFiles.add(absPath);
    }
  }

  // Scan directory
  const genartFiles = await scanGenartFiles(dir, recursive);
  const sketches: Record<string, unknown>[] = [];

  for (const filePath of genartFiles) {
    const inWorkspace = wsFiles.has(filePath);
    if (!includeUnreferenced && !inWorkspace) continue;

    const info = await tryParseGenart(filePath);
    if (!info) continue;

    sketches.push({
      id: info.id,
      title: info.title,
      renderer: info.renderer,
      canvas: info.canvas,
      parameterCount: info.parameterCount,
      colorCount: info.colorCount,
      path: info.path,
      inWorkspace,
      modified: info.modified,
    });
  }

  const inWorkspaceCount = sketches.filter(
    (s) => (s as { inWorkspace: boolean }).inWorkspace,
  ).length;

  return {
    success: true,
    directory: dir,
    sketches,
    total: sketches.length,
    inWorkspace: inWorkspaceCount,
    unreferenced: sketches.length - inWorkspaceCount,
  };
}

// ---------------------------------------------------------------------------
// search_sketches
// ---------------------------------------------------------------------------

export interface SearchSketchesInput {
  query?: string;
  renderer?: string;
  minParameters?: number;
  maxParameters?: number;
  canvasWidth?: number;
  canvasHeight?: number;
  hasPhilosophy?: boolean;
  skills?: string[];
}

export async function searchSketches(
  state: EditorState,
  input: SearchSketchesInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();

  // Validate at least one filter
  const hasFilter =
    input.query !== undefined ||
    input.renderer !== undefined ||
    input.minParameters !== undefined ||
    input.maxParameters !== undefined ||
    input.canvasWidth !== undefined ||
    input.canvasHeight !== undefined ||
    input.hasPhilosophy !== undefined ||
    (input.skills !== undefined && input.skills.length > 0);

  if (!hasFilter) {
    throw new Error("At least one search filter is required");
  }

  const matches: Record<string, unknown>[] = [];
  const filters: Record<string, unknown> = {};

  // Track applied filters
  if (input.query !== undefined) filters.query = input.query;
  if (input.renderer !== undefined) filters.renderer = input.renderer;
  if (input.minParameters !== undefined) filters.minParameters = input.minParameters;
  if (input.maxParameters !== undefined) filters.maxParameters = input.maxParameters;
  if (input.canvasWidth !== undefined) filters.canvasWidth = input.canvasWidth;
  if (input.canvasHeight !== undefined) filters.canvasHeight = input.canvasHeight;
  if (input.hasPhilosophy !== undefined) filters.hasPhilosophy = input.hasPhilosophy;
  if (input.skills !== undefined) filters.skills = input.skills;

  for (const [, loaded] of state.sketches) {
    const def = loaded.definition;

    // Apply filters
    if (input.query !== undefined) {
      if (!def.title.toLowerCase().includes(input.query.toLowerCase())) continue;
    }

    if (input.renderer !== undefined) {
      if (def.renderer.type !== input.renderer) continue;
    }

    if (input.minParameters !== undefined) {
      if (def.parameters.length < input.minParameters) continue;
    }

    if (input.maxParameters !== undefined) {
      if (def.parameters.length > input.maxParameters) continue;
    }

    if (input.canvasWidth !== undefined) {
      if (def.canvas.width !== input.canvasWidth) continue;
    }

    if (input.canvasHeight !== undefined) {
      if (def.canvas.height !== input.canvasHeight) continue;
    }

    if (input.hasPhilosophy !== undefined) {
      const has = !!def.philosophy;
      if (has !== input.hasPhilosophy) continue;
    }

    if (input.skills !== undefined && input.skills.length > 0) {
      const sketchSkills = new Set(def.skills ?? []);
      const hasAny = input.skills.some((s) => sketchSkills.has(s));
      if (!hasAny) continue;
    }

    matches.push({
      id: def.id,
      title: def.title,
      renderer: def.renderer.type,
      canvas: { width: def.canvas.width, height: def.canvas.height },
      parameterCount: def.parameters.length,
      colorCount: def.colors.length,
      snapshotCount: def.snapshots?.length ?? 0,
      hasPhilosophy: !!def.philosophy,
      skills: def.skills ?? [],
    });
  }

  return {
    success: true,
    matches,
    total: matches.length,
    filters,
  };
}
