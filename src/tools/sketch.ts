/**
 * Sketch lifecycle tools.
 * create_sketch, open_sketch, update_sketch, update_algorithm,
 * save_sketch, fork_sketch, delete_sketch
 */

import { mkdir, readFile, writeFile, stat, unlink } from "fs/promises";
import { basename, dirname, resolve } from "path";
import {
  createDefaultRegistry,
  parseGenart,
  resolveComponents,
  resolvePreset,
  serializeGenart,
  serializeWorkspace,
  type ColorDef,
  type ParamDef,
  type RendererType,
  type SketchComponentDef,
  type SketchComponentValue,
  type SketchDataSource,
  type SketchDefinition,
  type SketchState,
  type ThemeDef,
  type AlgorithmDataChannel,
} from "@genart-dev/core";
import { resolveLibraries, type LibraryDependency } from "@genart-dev/core";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const VALID_RENDERERS: readonly RendererType[] = [
  "p5",
  "three",
  "glsl",
  "canvas2d",
  "svg",
  "genart",
];
const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

// resolvePath removed — use state.resolvePath() for sandbox-aware path resolution

function validateRendererType(type: string): asserts type is RendererType {
  if (!VALID_RENDERERS.includes(type as RendererType)) {
    throw new Error(
      `Unknown renderer type: '${type}'. Valid types: ${VALID_RENDERERS.join(", ")}`,
    );
  }
}

function validateKebabId(id: string): void {
  if (!KEBAB_RE.test(id)) {
    throw new Error(
      "ID must be kebab-case: lowercase letters, numbers, hyphens",
    );
  }
}

function validateParameters(parameters: ParamDef[]): void {
  const keys = new Set<string>();
  for (const p of parameters) {
    if (keys.has(p.key)) {
      throw new Error(`Duplicate parameter key: '${p.key}'`);
    }
    keys.add(p.key);
    if (p.default < p.min || p.default > p.max) {
      throw new Error(
        `Parameter '${p.key}' default (${p.default}) outside range [${p.min}, ${p.max}]`,
      );
    }
  }
}

function resolveCanvas(
  canvas?: { preset?: string; width?: number; height?: number },
): { width: number; height: number } {
  if (!canvas) {
    return resolvePreset("square-1200");
  }
  if (canvas.preset) {
    return resolvePreset(canvas.preset);
  }
  return {
    width: canvas.width ?? 1200,
    height: canvas.height ?? 1200,
  };
}

function buildState(
  parameters: readonly ParamDef[],
  colors: readonly ColorDef[],
  seed: number,
): SketchState {
  const params: Record<string, number> = {};
  for (const p of parameters) {
    params[p.key] = p.default;
  }
  const colorPalette = colors.map((c) => c.default);
  return { seed, params, colorPalette };
}

// ---------------------------------------------------------------------------
// create_sketch
// ---------------------------------------------------------------------------

export interface CreateSketchInput {
  id: string;
  title: string;
  path: string;
  renderer?: string;
  canvas?: { preset?: string; width?: number; height?: number };
  philosophy?: string;
  parameters?: ParamDef[];
  colors?: ColorDef[];
  themes?: ThemeDef[];
  algorithm?: string;
  seed?: number;
  skills?: string[];
  components?: Record<string, string | { version?: string; code?: string; exports?: string[] }>;
  libraries?: string[];
  data?: Record<string, SketchDataSource>;
  dataChannels?: AlgorithmDataChannel[];
  addToWorkspace?: string;
  agent?: string;
  model?: string;
  capture?: boolean;
}

export async function createSketch(
  state: EditorState,
  input: CreateSketchInput,
): Promise<Record<string, unknown>> {
  const absPath = state.resolvePath(input.path);

  if (!absPath.endsWith(".genart")) {
    throw new Error("Path must end with .genart");
  }

  validateKebabId(input.id);

  if (!state.remoteMode && await fileExists(absPath)) {
    throw new Error(
      `File already exists at ${absPath}. Use update_sketch or fork_sketch.`,
    );
  }

  const rendererType = (input.renderer ?? "p5") as string;
  validateRendererType(rendererType);

  const canvasDims = resolveCanvas(input.canvas);
  const parameters = input.parameters ?? [];
  const colors = input.colors ?? [];

  if (parameters.length > 0) {
    validateParameters(parameters);
  }

  // Resolve external libraries (e.g. p5.brush) — names → LibraryDependency objects
  let resolvedLibs: LibraryDependency[] | undefined;
  let rendererVersion = "1.x";
  if (input.libraries && input.libraries.length > 0) {
    resolvedLibs = resolveLibraries(input.libraries);
    // If any library requires a specific renderer version, adopt it
    for (const lib of resolvedLibs) {
      if (lib.rendererVersionRequirement) {
        rendererVersion = lib.rendererVersionRequirement;
      }
    }
  }

  // Get algorithm from input or renderer template
  let algorithm = input.algorithm;
  if (!algorithm) {
    const registry = createDefaultRegistry();
    const adapter = registry.resolve(rendererType);
    algorithm = adapter.getAlgorithmTemplate(resolvedLibs);
  }

  // Resolve components if provided
  let resolvedComponents: Record<string, SketchComponentDef> | undefined;
  if (input.components && Object.keys(input.components).length > 0) {
    // Build shorthand map for the resolver
    const shorthand: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.components)) {
      if (typeof value === "string") {
        shorthand[name] = value;
      } else if (value.version) {
        shorthand[name] = value.version;
      } else if (value.code) {
        // Inline component — skip resolver, include directly
        if (!resolvedComponents) resolvedComponents = {};
        resolvedComponents[name] = {
          ...(value.version ? { version: value.version } : {}),
          code: value.code,
          ...(value.exports ? { exports: value.exports } : {}),
        };
      }
    }

    // Resolve registry components
    if (Object.keys(shorthand).length > 0) {
      const resolved = resolveComponents(shorthand, rendererType as RendererType);
      if (!resolvedComponents) resolvedComponents = {};
      for (const rc of resolved) {
        resolvedComponents[rc.name] = {
          version: rc.version,
          code: rc.code,
          exports: [...rc.exports],
        };
      }
    }
  }

  const seed =
    input.seed ?? Math.floor(Math.random() * 100000);
  const ts = now();
  const hasComponents = resolvedComponents && Object.keys(resolvedComponents).length > 0;

  const sketch: SketchDefinition = {
    genart: hasComponents ? "1.2" : "1.1",
    id: input.id,
    title: input.title,
    created: ts,
    modified: ts,
    renderer: { type: rendererType, version: rendererVersion },
    canvas: canvasDims,
    libraries: resolvedLibs,
    parameters,
    colors,
    state: buildState(parameters, colors, seed),
    algorithm,
    ...(input.philosophy ? { philosophy: input.philosophy } : {}),
    ...(input.themes && input.themes.length > 0
      ? { themes: input.themes }
      : {}),
    ...(input.skills && input.skills.length > 0
      ? { skills: input.skills }
      : {}),
    ...(hasComponents ? { components: resolvedComponents } : {}),
    ...(input.data && Object.keys(input.data).length > 0 ? { data: input.data } : {}),
    ...(input.dataChannels && input.dataChannels.length > 0 ? { dataChannels: input.dataChannels } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
  };

  // Serialize sketch JSON
  const json = serializeGenart(sketch);

  // Write to disk in local mode
  if (!state.remoteMode) {
    await mkdir(dirname(absPath), { recursive: true });
    await writeFile(absPath, json, "utf-8");
  }

  // Load into state
  state.sketches.set(input.id, { definition: sketch, path: absPath });
  state.emitMutation("sketch:created", { id: input.id, path: absPath });

  // Auto-manage the workspace so every sketch is visible in the editor
  // and preview_sketch can find the workspace directory for HTML previews.
  if (!input.addToWorkspace) {
    const file = basename(absPath);
    if (!state.workspace) {
      // Auto-create a workspace for the first sketch in this session
      const ts = now();
      const wsPath = resolve(dirname(absPath), "workspace.genart-workspace");
      state.workspace = {
        "genart-workspace": "1.0",
        id: "session",
        title: "genart.dev",
        created: ts,
        modified: ts,
        viewport: { x: 0, y: 0, zoom: 1 },
        sketches: [{ file, position: { x: 0, y: 0 } }],
      };
      state.workspacePath = wsPath;
      // In local mode, persist the workspace file
      if (!state.remoteMode) {
        await writeFile(wsPath, serializeWorkspace(state.workspace), "utf-8");
      }
      state.emitMutation("workspace:loaded", { path: state.workspacePath, title: state.workspace.title });
    } else {
      // Add to the existing auto-created workspace
      let maxRight = 0;
      for (const s of state.workspace.sketches) {
        const right = s.position.x + 1200;
        if (right > maxRight) maxRight = right;
      }
      state.workspace = {
        ...state.workspace,
        modified: now(),
        sketches: [...state.workspace.sketches, { file, position: { x: maxRight + 200, y: 0 } }],
      };
      // In local mode, persist the workspace update
      if (!state.remoteMode && state.workspacePath) {
        await writeFile(state.workspacePath, serializeWorkspace(state.workspace), "utf-8");
      }
      state.emitMutation("workspace:updated", { added: file });
    }
  }

  // Optionally add to a specific workspace (local mode / explicit path)
  let workspaceContent: string | undefined;
  if (input.addToWorkspace) {
    // If workspace is open and matches the requested path, add the sketch ref
    const wsPath = state.resolvePath(input.addToWorkspace);
    if (state.workspace && state.workspacePath === wsPath) {
      const file = basename(absPath);
      const ws = state.requireWorkspace();
      // Auto-position to the right of existing sketches
      let maxRight = 0;
      for (const s of ws.sketches) {
        const right = s.position.x + 1200;
        if (right > maxRight) maxRight = right;
      }
      const position =
        ws.sketches.length === 0
          ? { x: 0, y: 0 }
          : { x: maxRight + 200, y: 0 };

      state.workspace = {
        ...ws,
        modified: now(),
        sketches: [...ws.sketches, { file, position }],
      };

      workspaceContent = serializeWorkspace(state.workspace);
      if (!state.remoteMode) {
        await writeFile(wsPath, workspaceContent, "utf-8");
      }
      state.emitMutation("workspace:updated", { added: file });
    }
  }

  return {
    success: true,
    path: absPath,
    id: input.id,
    title: input.title,
    renderer: rendererType,
    canvas: canvasDims,
    seed,
    // Only include file content in remote mode (Claude Code needs it to write files locally)
    ...(state.remoteMode ? { fileContent: json } : {}),
    ...(workspaceContent ? { workspaceContent } : {}),
  };
}

// ---------------------------------------------------------------------------
// open_sketch
// ---------------------------------------------------------------------------

export interface OpenSketchInput {
  sketchId: string;
}

export async function openSketch(
  state: EditorState,
  input: OpenSketchInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  // Set selection to this sketch
  state.setSelection([input.sketchId]);
  state.emitMutation("selection:changed", { selected: [input.sketchId] });

  return {
    success: true,
    id: def.id,
    title: def.title,
    renderer: def.renderer.type,
    canvas: { width: def.canvas.width, height: def.canvas.height },
    parameterCount: def.parameters.length,
    colorCount: def.colors.length,
    seed: def.state.seed,
    philosophy: def.philosophy ?? null,
    algorithmLength: def.algorithm.length,
  };
}

// ---------------------------------------------------------------------------
// update_sketch
// ---------------------------------------------------------------------------

export interface UpdateSketchInput {
  sketchId: string;
  title?: string;
  philosophy?: string;
  canvas?: { preset?: string; width?: number; height?: number };
  parameters?: ParamDef[];
  colors?: ColorDef[];
  themes?: ThemeDef[];
  seed?: number;
  skills?: string[];
  data?: Record<string, SketchDataSource>;
  dataChannels?: AlgorithmDataChannel[];
  agent?: string;
  model?: string;
}

export async function updateSketch(
  state: EditorState,
  input: UpdateSketchInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  const updatableFields = [
    "title",
    "philosophy",
    "canvas",
    "parameters",
    "colors",
    "themes",
    "seed",
    "skills",
    "data",
    "dataChannels",
  ] as const;

  const updated: string[] = [];
  for (const field of updatableFields) {
    if (input[field] !== undefined) {
      updated.push(field);
    }
  }

  if (updated.length === 0) {
    throw new Error(
      "No fields to update. Provide at least one of: title, philosophy, canvas, parameters, colors, themes, seed, skills, data, dataChannels",
    );
  }

  // Validate new parameters if provided
  if (input.parameters) {
    validateParameters(input.parameters);
  }

  // Resolve canvas if provided
  let canvasDims = { width: def.canvas.width, height: def.canvas.height };
  if (input.canvas) {
    canvasDims = resolveCanvas(input.canvas);
  }

  // Build new state
  const newParams = input.parameters ?? def.parameters;
  const newColors = input.colors ?? def.colors;
  const newSeed = input.seed ?? def.state.seed;
  const newState = buildState(newParams, newColors, newSeed);

  const newDef: SketchDefinition = {
    ...def,
    modified: now(),
    canvas: canvasDims,
    parameters: newParams,
    colors: newColors,
    state: newState,
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.philosophy !== undefined
      ? { philosophy: input.philosophy }
      : {}),
    ...(input.themes !== undefined ? { themes: input.themes } : {}),
    ...(input.seed !== undefined
      ? { state: { ...newState, seed: input.seed } }
      : {}),
    ...(input.skills !== undefined ? { skills: input.skills } : {}),
    ...(input.data !== undefined ? { data: input.data } : {}),
    ...(input.dataChannels !== undefined ? { dataChannels: input.dataChannels } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
  };

  // Update in state and save
  state.sketches.set(input.sketchId, {
    definition: newDef,
    path: loaded.path,
  });

  const json = serializeGenart(newDef);
  if (!state.remoteMode) {
    await writeFile(loaded.path, json, "utf-8");
  }
  state.emitMutation("sketch:updated", { id: input.sketchId, updated });

  return {
    success: true,
    sketchId: input.sketchId,
    updated,
    canvas: canvasDims,
    parameterCount: newDef.parameters.length,
    colorCount: newDef.colors.length,
    seed: newDef.state.seed,
    ...(state.remoteMode ? { fileContent: json } : {}),
  };
}

// ---------------------------------------------------------------------------
// update_algorithm
// ---------------------------------------------------------------------------

export interface UpdateAlgorithmInput {
  sketchId: string;
  algorithm: string;
  validate?: boolean;
  components?: Record<string, string | { version?: string; code?: string; exports?: string[] }>;
  agent?: string;
  model?: string;
}

export async function updateAlgorithm(
  state: EditorState,
  input: UpdateAlgorithmInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  if (!input.algorithm || input.algorithm.trim() === "") {
    throw new Error("Algorithm cannot be empty");
  }

  const shouldValidate = input.validate !== false;
  let validationPassed = true;

  if (shouldValidate) {
    const registry = createDefaultRegistry();
    const adapter = registry.resolve(def.renderer.type);
    const result = adapter.validate(input.algorithm);
    if (!result.valid) {
      throw new Error(
        `Algorithm validation failed: ${result.errors.join("; ")}`,
      );
    }
  }

  // Resolve components if provided
  let resolvedComponents: Record<string, SketchComponentDef> | undefined;
  if (input.components && Object.keys(input.components).length > 0) {
    const renderer = def.renderer.type;
    const shorthand: Record<string, string> = {};
    for (const [name, value] of Object.entries(input.components)) {
      if (typeof value === "string") {
        shorthand[name] = value;
      } else if (value.version) {
        shorthand[name] = value.version;
      } else if (value.code) {
        if (!resolvedComponents) resolvedComponents = {};
        resolvedComponents[name] = {
          ...(value.version ? { version: value.version } : {}),
          code: value.code,
          ...(value.exports ? { exports: value.exports } : {}),
        };
      }
    }
    if (Object.keys(shorthand).length > 0) {
      const resolved = resolveComponents(shorthand, renderer);
      if (!resolvedComponents) resolvedComponents = {};
      for (const rc of resolved) {
        resolvedComponents[rc.name] = {
          version: rc.version,
          code: rc.code,
          exports: [...rc.exports],
        };
      }
    }
  }

  const updated: string[] = ["algorithm"];
  const hasNewComponents = resolvedComponents && Object.keys(resolvedComponents).length > 0;
  if (hasNewComponents) updated.push("components");

  const newDef: SketchDefinition = {
    ...def,
    modified: now(),
    algorithm: input.algorithm,
    ...(hasNewComponents
      ? { genart: "1.2" as const, components: resolvedComponents }
      : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
  };

  state.sketches.set(input.sketchId, {
    definition: newDef,
    path: loaded.path,
  });

  const json = serializeGenart(newDef);
  if (!state.remoteMode) {
    await writeFile(loaded.path, json, "utf-8");
  }
  state.emitMutation("sketch:updated", {
    id: input.sketchId,
    updated,
  });

  // Auto-detect: warn if algorithm uses p5.brush APIs but sketch lacks p5.brush library
  let libraryWarning: string | undefined;
  const P5_BRUSH_PATTERN = /\bbrush\.(set|fill|hatch|line|flowLine|beginStroke|endStroke)\b/;
  if (
    P5_BRUSH_PATTERN.test(input.algorithm) &&
    !def.libraries?.some((lib) => lib.name === "p5.brush")
  ) {
    libraryWarning =
      "Algorithm uses p5.brush APIs (brush.set/fill/hatch) but the sketch does not declare p5.brush as a library dependency. " +
      "Recreate the sketch with libraries:[\"p5.brush\"] in create_sketch, or the brush calls will fail at runtime.";
  }

  return {
    success: true,
    sketchId: input.sketchId,
    renderer: def.renderer.type,
    algorithmLength: input.algorithm.length,
    validationPassed,
    ...(hasNewComponents ? { componentsUpdated: true } : {}),
    ...(libraryWarning ? { libraryWarning } : {}),
    ...(state.remoteMode ? { fileContent: json } : {}),
  };
}

// ---------------------------------------------------------------------------
// save_sketch
// ---------------------------------------------------------------------------

export interface SaveSketchInput {
  sketchId: string;
}

export async function saveSketch(
  state: EditorState,
  input: SaveSketchInput,
): Promise<Record<string, unknown>> {
  const loaded = state.requireSketch(input.sketchId);

  // Update modified timestamp
  const newDef: SketchDefinition = {
    ...loaded.definition,
    modified: now(),
  };
  state.sketches.set(input.sketchId, {
    definition: newDef,
    path: loaded.path,
  });

  const json = serializeGenart(newDef);
  if (!state.remoteMode) {
    await writeFile(loaded.path, json, "utf-8");
  }
  state.emitMutation("sketch:saved", { id: input.sketchId, path: loaded.path });

  return {
    success: true,
    sketchId: input.sketchId,
    path: loaded.path,
    ...(state.remoteMode ? { fileContent: json } : {}),
  };
}

// ---------------------------------------------------------------------------
// fork_sketch
// ---------------------------------------------------------------------------

export interface ForkSketchInput {
  sourceId: string;
  newId: string;
  title?: string;
  position?: { x: number; y: number };
  modifications?: {
    renderer?: string;
    canvas?: { preset?: string; width?: number; height?: number };
    parameters?: ParamDef[];
    colors?: ColorDef[];
    algorithm?: string;
    philosophy?: string;
  };
  newSeed?: boolean;
  agent?: string;
  model?: string;
}

export async function forkSketch(
  state: EditorState,
  input: ForkSketchInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();
  const source = state.requireSketch(input.sourceId);
  const sourceDef = source.definition;

  validateKebabId(input.newId);

  // Check if newId already exists in workspace
  if (state.getSketch(input.newId)) {
    throw new Error(
      `Sketch with ID '${input.newId}' already exists in workspace`,
    );
  }

  // Determine file path: same directory as source
  const sourceDir = dirname(source.path);
  const newPath = resolve(sourceDir, `${input.newId}.genart`);

  if (await fileExists(newPath)) {
    throw new Error(`File already exists at ${newPath}`);
  }

  // Apply modifications
  const mods = input.modifications ?? {};

  let rendererType = sourceDef.renderer.type as string;
  if (mods.renderer) {
    validateRendererType(mods.renderer);
    rendererType = mods.renderer;
  }

  const canvasDims = mods.canvas
    ? resolveCanvas(mods.canvas)
    : { width: sourceDef.canvas.width, height: sourceDef.canvas.height };

  const parameters = mods.parameters ?? [...sourceDef.parameters];
  const colors = mods.colors ?? [...sourceDef.colors];
  const algorithm = mods.algorithm ?? sourceDef.algorithm;
  const philosophy = mods.philosophy ?? sourceDef.philosophy;

  const generateNewSeed = input.newSeed !== false;
  const seed = generateNewSeed
    ? Math.floor(Math.random() * 100000)
    : sourceDef.state.seed;

  const title = input.title ?? `${sourceDef.title} (fork)`;
  const ts = now();

  // Build lineage from parent
  const sourceGeneration = sourceDef.lineage?.generation ?? 1;
  const lineage = {
    parentId: input.sourceId,
    parentTitle: sourceDef.title,
    generation: sourceGeneration + 1,
  };

  const forkedDef: SketchDefinition = {
    genart: "1.1",
    id: input.newId,
    title,
    created: ts,
    modified: ts,
    renderer: { type: rendererType as RendererType, version: "1.x" },
    canvas: canvasDims,
    parameters,
    colors,
    state: buildState(parameters, colors, seed),
    algorithm,
    ...(sourceDef.compositionLevel ? { compositionLevel: sourceDef.compositionLevel } : {}),
    lineage,
    ...(philosophy ? { philosophy } : {}),
    ...(sourceDef.themes ? { themes: [...sourceDef.themes] } : {}),
    ...(sourceDef.skills ? { skills: [...sourceDef.skills] } : {}),
    ...(input.agent ? { agent: input.agent } : {}),
    ...(input.model ? { model: input.model } : {}),
  };

  // Serialize sketch JSON
  const json = serializeGenart(forkedDef);

  if (!state.remoteMode) {
    await writeFile(newPath, json, "utf-8");
  }

  // Load into state
  state.sketches.set(input.newId, { definition: forkedDef, path: newPath });

  // Auto-position: to the right of source sketch in workspace
  let position = input.position;
  if (!position) {
    const sourceRef = ws.sketches.find(
      (s) => s.file === basename(source.path),
    );
    if (sourceRef) {
      position = {
        x: sourceRef.position.x + sourceDef.canvas.width + 200,
        y: sourceRef.position.y,
      };
    } else {
      position = { x: 0, y: 0 };
    }
  }

  // Add to workspace
  const file = basename(newPath);
  state.workspace = {
    ...ws,
    modified: now(),
    sketches: [...ws.sketches, { file, position }],
  };

  const workspaceJson = serializeWorkspace(state.workspace);
  if (!state.remoteMode) {
    await writeFile(state.workspacePath!, workspaceJson, "utf-8");
  }

  state.emitMutation("sketch:created", { id: input.newId, path: newPath });
  state.emitMutation("workspace:updated", { added: file });

  return {
    success: true,
    sourceId: input.sourceId,
    forkedSketch: {
      id: input.newId,
      title,
      path: newPath,
      renderer: rendererType,
      canvas: canvasDims,
      seed,
      position,
    },
    ...(state.remoteMode ? { fileContent: json, workspaceContent: workspaceJson } : {}),
  };
}

// ---------------------------------------------------------------------------
// delete_sketch
// ---------------------------------------------------------------------------

export interface DeleteSketchInput {
  sketchId: string;
  keepFile?: boolean;
}

export async function deleteSketch(
  state: EditorState,
  input: DeleteSketchInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();
  const loaded = state.requireSketch(input.sketchId);
  const file = basename(loaded.path);

  // Remove from workspace sketches
  const newSketches = ws.sketches.filter((s) => s.file !== file);

  // Clean up groups
  const newGroups = ws.groups
    ?.map((g) => ({
      ...g,
      sketchFiles: g.sketchFiles.filter((f) => f !== file),
    }))
    .filter((g) => g.sketchFiles.length > 0);

  state.workspace = {
    ...ws,
    modified: now(),
    sketches: newSketches,
    ...(newGroups && newGroups.length > 0 ? { groups: newGroups } : {}),
  };

  // Remove from state cache and selection
  state.sketches.delete(input.sketchId);
  state.selection.delete(input.sketchId);

  // Delete file from disk unless keepFile is true
  const shouldDelete = !input.keepFile;
  if (shouldDelete) {
    try {
      await unlink(loaded.path);
    } catch {
      // File may already be deleted
    }
  }

  await state.saveWorkspace();
  state.emitMutation("sketch:deleted", { id: input.sketchId });
  state.emitMutation("workspace:updated", { removed: file });

  return {
    success: true,
    deletedId: input.sketchId,
    path: loaded.path,
    fileDeleted: shouldDelete,
    sketchCount: state.workspace.sketches.length,
  };
}
