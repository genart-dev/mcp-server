/**
 * EditorState — server-scoped mutable state for the MCP server.
 * Tracks the active workspace, loaded sketches, and current selection.
 * Emits mutation events for real-time state broadcasting.
 */

import { EventEmitter } from "events";
import { readFile } from "fs/promises";
import { dirname, isAbsolute, resolve } from "path";
import { notifyMutation } from "./sidecar.js";
import {
  parseGenart,
  parseWorkspace,
  serializeGenart,
  serializeWorkspace,
  type SketchDefinition,
  type WorkspaceDefinition,
} from "@genart-dev/core";
import { writeFile } from "fs/promises";

/** A loaded sketch with its parsed definition and absolute file path. */
export interface LoadedSketch {
  definition: SketchDefinition;
  path: string;
}

/** Mutation event types emitted by EditorState. */
export type EditorMutationType =
  | "workspace:loaded"
  | "workspace:saved"
  | "workspace:updated"
  | "sketch:loaded"
  | "sketch:created"
  | "sketch:updated"
  | "sketch:saved"
  | "sketch:removed"
  | "sketch:deleted"
  | "selection:changed";

/** Payload for EditorState mutation events. */
export interface EditorMutationEvent {
  type: EditorMutationType;
  payload: unknown;
}

/** Serializable snapshot of the full editor state. */
export interface EditorStateSnapshot {
  workspacePath: string | null;
  workspace: WorkspaceDefinition | null;
  sketches: Array<{ id: string; definition: SketchDefinition; path: string }>;
  selection: string[];
}

/** Server-scoped mutable state for the MCP server. */
export class EditorState extends EventEmitter {
  /** Absolute path to the active .genart-workspace file, or null. */
  workspacePath: string | null = null;

  /** Parsed workspace definition, or null if no workspace is open. */
  workspace: WorkspaceDefinition | null = null;

  /** Loaded sketches keyed by sketch ID. */
  sketches: Map<string, LoadedSketch> = new Map();

  /** Currently selected sketch IDs. */
  selection: Set<string> = new Set();

  /**
   * Base directory for all file operations. When set, all paths are
   * resolved relative to this directory and constrained within it.
   * Used by mcp-host for per-session sandboxing.
   */
  basePath: string | null = null;

  /**
   * When true, the server is running remotely and cannot access the
   * user's local filesystem. Tools return file content in responses
   * instead of writing to disk. Set by mcp-host for HTTP-based sessions.
   */
  remoteMode = false;

  constructor(options?: { basePath?: string; remoteMode?: boolean }) {
    super();
    if (options?.basePath) {
      this.basePath = options.basePath;
    }
    if (options?.remoteMode) {
      this.remoteMode = true;
    }
  }

  /** Update the working directory / sandbox base path. */
  setBasePath(dir: string): void {
    this.basePath = dir;
  }

  /** Resolve a file path, respecting the sandbox basePath when set. */
  resolvePath(file: string): string {
    if (isAbsolute(file)) {
      if (this.basePath && !file.startsWith(this.basePath)) {
        throw new Error(`Path escapes sandbox: ${file}`);
      }
      return file;
    }
    // Expand ~ to home directory (only when no sandbox)
    if ((file.startsWith("~/") || file === "~") && !this.basePath) {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
      return resolve(home, file.slice(2));
    }
    const base = this.basePath ?? process.cwd();
    const resolved = resolve(base, file);
    if (this.basePath && !resolved.startsWith(this.basePath)) {
      throw new Error(`Path escapes sandbox: ${resolved}`);
    }
    return resolved;
  }

  /** Resolve a sketch file reference (relative to workspace dir) to an absolute path. */
  resolveSketchPath(file: string): string {
    if (isAbsolute(file)) {
      if (this.basePath && !file.startsWith(this.basePath)) {
        throw new Error(`Path escapes sandbox: ${file}`);
      }
      return file;
    }
    if (!this.workspacePath) {
      if (this.basePath) {
        return resolve(this.basePath, file);
      }
      throw new Error("No workspace is currently open");
    }
    const resolved = resolve(dirname(this.workspacePath), file);
    if (this.basePath && !resolved.startsWith(this.basePath)) {
      throw new Error(`Path escapes sandbox: ${resolved}`);
    }
    return resolved;
  }

  /** Load a workspace from disk and all its referenced sketches. */
  async loadWorkspace(absPath: string): Promise<void> {
    if (this.basePath && !absPath.startsWith(this.basePath)) {
      throw new Error(`Path escapes sandbox: ${absPath}`);
    }
    const raw = await readFile(absPath, "utf-8");
    const json = JSON.parse(raw) as unknown;
    const ws = parseWorkspace(json);

    this.workspacePath = absPath;
    this.workspace = ws;
    this.sketches.clear();
    this.selection.clear();

    // Load all referenced sketches
    for (const ref of ws.sketches) {
      const sketchPath = this.resolveSketchPath(ref.file);
      await this.loadSketch(sketchPath);
    }

    this.emitMutation("workspace:loaded", { path: absPath, title: ws.title });
  }

  /** Load a single sketch from disk and add it to the cache. */
  async loadSketch(absPath: string): Promise<SketchDefinition> {
    if (this.basePath && !absPath.startsWith(this.basePath)) {
      throw new Error(`Path escapes sandbox: ${absPath}`);
    }
    const raw = await readFile(absPath, "utf-8");
    const json = JSON.parse(raw) as unknown;
    const definition = parseGenart(json);
    this.sketches.set(definition.id, { definition, path: absPath });
    this.emitMutation("sketch:loaded", { id: definition.id, path: absPath });
    return definition;
  }

  /** Get a loaded sketch by ID. */
  getSketch(id: string): LoadedSketch | undefined {
    return this.sketches.get(id);
  }

  /** Require a loaded sketch by ID, throwing if not found. */
  requireSketch(id: string): LoadedSketch {
    const sketch = this.sketches.get(id);
    if (!sketch) {
      throw new Error(`Sketch not found: '${id}'`);
    }
    return sketch;
  }

  /** Require an open workspace, throwing if none is open. */
  requireWorkspace(): WorkspaceDefinition {
    if (!this.workspace) {
      throw new Error("No workspace is currently open");
    }
    return this.workspace;
  }

  /** Remove a sketch from the in-memory cache. */
  removeSketch(id: string): void {
    this.sketches.delete(id);
    this.selection.delete(id);
    this.emitMutation("sketch:removed", { id });
  }

  /** Save the active workspace to disk. */
  async saveWorkspace(): Promise<void> {
    if (!this.workspace || !this.workspacePath) {
      throw new Error("No workspace is currently open");
    }
    const json = serializeWorkspace(this.workspace);
    if (!this.remoteMode) {
      await writeFile(this.workspacePath, json, "utf-8");
    }
    this.emitMutation("workspace:saved", { path: this.workspacePath });
  }

  /** Save a sketch to disk. */
  async saveSketch(id: string): Promise<void> {
    const loaded = this.requireSketch(id);
    const json = serializeGenart(loaded.definition);
    if (!this.remoteMode) {
      await writeFile(loaded.path, json, "utf-8");
    }
    this.emitMutation("sketch:saved", { id, path: loaded.path });
  }

  /** Update the selection and return the new set. */
  setSelection(ids: string[]): void {
    this.selection.clear();
    for (const id of ids) {
      this.selection.add(id);
    }
    this.emitMutation("selection:changed", { ids });
  }

  /** Get a serializable snapshot of the full editor state. */
  getSnapshot(): EditorStateSnapshot {
    const sketches: EditorStateSnapshot["sketches"] = [];
    for (const [id, loaded] of this.sketches) {
      sketches.push({ id, definition: loaded.definition, path: loaded.path });
    }
    return {
      workspacePath: this.workspacePath,
      workspace: this.workspace,
      sketches,
      selection: Array.from(this.selection),
    };
  }

  /** Emit a mutation event for external listeners (WebSocket broadcast, sidecar IPC). */
  emitMutation(type: EditorMutationType, payload: unknown): void {
    this.emit("mutation", { type, payload } satisfies EditorMutationEvent);
    notifyMutation(type, payload);
  }
}
