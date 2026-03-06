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
  createLayerStack,
  type SketchDefinition,
  type WorkspaceDefinition,
  type PluginRegistry,
  type LayerStackAccessor,
  type McpToolContext,
  type DesignChangeType,
  type SketchStateAccessor,
  type SketchMutator,
  type DesignLayer,
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
  | "selection:changed"
  | "design:layer-added"
  | "design:layer-removed"
  | "design:layer-updated"
  | "design:layer-reordered";

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

  /** Plugin registry for design mode. Set during server initialization. */
  pluginRegistry: PluginRegistry | null = null;

  /** Layer stacks keyed by sketch ID. Created lazily when design tools are used. */
  layerStacks: Map<string, LayerStackAccessor> = new Map();

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
    this.layerStacks.clear();

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
    this.layerStacks.delete(id);
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

  /**
   * Get or create a LayerStackAccessor for a sketch.
   * Initializes from the sketch's persisted design layers.
   */
  getLayerStack(sketchId: string): LayerStackAccessor {
    let stack = this.layerStacks.get(sketchId);
    if (stack) return stack;

    const loaded = this.requireSketch(sketchId);
    const initialLayers = (loaded.definition.layers ?? []) as DesignLayer[];

    stack = createLayerStack(initialLayers, (changeType: DesignChangeType) => {
      this.syncLayersToDefinition(sketchId);
      const mutationType = `design:${changeType}` as EditorMutationType;
      this.emitMutation(mutationType, { sketchId, changeType });
    });

    this.layerStacks.set(sketchId, stack);
    return stack;
  }

  /**
   * Sync the layer stack's current state back to the sketch definition.
   * Called automatically on every layer mutation.
   */
  private syncLayersToDefinition(sketchId: string): void {
    const loaded = this.sketches.get(sketchId);
    const stack = this.layerStacks.get(sketchId);
    if (!loaded || !stack) return;

    const layers = stack.getAll();
    loaded.definition = {
      ...loaded.definition,
      layers: layers.length > 0 ? layers : undefined,
    };
  }

  /**
   * Create an McpToolContext for a plugin's MCP tool handler.
   * Provides access to the layer stack, sketch state, and change notifications.
   */
  createMcpToolContext(sketchId: string): McpToolContext {
    const loaded = this.requireSketch(sketchId);
    const layerStack = this.getLayerStack(sketchId);
    const def = loaded.definition;

    const sketchState: SketchStateAccessor = {
      seed: def.state.seed,
      params: def.state.params,
      colorPalette: def.state.colorPalette,
      canvasWidth: def.canvas.width,
      canvasHeight: def.canvas.height,
      rendererId: def.renderer.type,
    };

    const sketch: SketchMutator = {
      getSymbols() {
        return (loaded.definition.symbols ?? {}) as Readonly<Record<string, unknown>>;
      },
      setSymbols(symbols: Record<string, unknown> | undefined) {
        loaded.definition = { ...loaded.definition, symbols: symbols as typeof loaded.definition.symbols };
      },
      getComponents() {
        return (loaded.definition.components ?? {}) as Readonly<Record<string, unknown>>;
      },
      setComponents(components: Record<string, unknown>) {
        loaded.definition = { ...loaded.definition, components: components as typeof loaded.definition.components };
      },
      getThirdParty() {
        const def = loaded.definition as unknown as Record<string, unknown>;
        return ((def["thirdParty"] as unknown[]) ?? []) as readonly Record<string, unknown>[];
      },
      setThirdParty(notices: Record<string, unknown>[] | undefined) {
        (loaded.definition as unknown as Record<string, unknown>)["thirdParty"] = notices;
      },
      getRenderer() {
        return loaded.definition.renderer.type;
      },
      getGenartVersion() {
        return loaded.definition.genart;
      },
      setGenartVersion(version: string) {
        loaded.definition = { ...loaded.definition, genart: version };
      },
    };

    return {
      layers: layerStack,
      sketchState,
      sketch,
      canvasWidth: def.canvas.width,
      canvasHeight: def.canvas.height,
      async resolveAsset(_assetId: string): Promise<Buffer | null> {
        return null;
      },
      async captureComposite(_format?: "png" | "jpeg"): Promise<Buffer> {
        throw new Error("captureComposite is not available in headless MCP mode");
      },
      emitChange(_changeType: DesignChangeType): void {
        // onChange is already handled by the layer stack's callback
      },
    };
  }

  /**
   * Get the currently selected sketch ID for design operations.
   * Returns the single selected sketch, or throws if none/multiple selected.
   */
  requireSelectedSketchId(): string {
    if (this.selection.size === 0) {
      throw new Error("No sketch is selected. Use select_sketch or open_sketch first.");
    }
    if (this.selection.size > 1) {
      throw new Error("Multiple sketches are selected. Design operations require a single sketch.");
    }
    return this.selection.values().next().value!;
  }

  /** Emit a mutation event for external listeners (WebSocket broadcast, sidecar IPC). */
  emitMutation(type: EditorMutationType, payload: unknown): void {
    this.emit("mutation", { type, payload } satisfies EditorMutationEvent);
    notifyMutation(type, payload);
  }
}
