/**
 * MCP server creation and tool registration.
 * Creates a McpServer instance with all tools, resources, and prompts.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createPluginRegistry, type PluginRegistry } from "@genart-dev/core";
import typographyPlugin from "@genart-dev/plugin-typography";
import filtersPlugin from "@genart-dev/plugin-filters";
import shapesPlugin from "@genart-dev/plugin-shapes";
import layoutGuidesPlugin from "@genart-dev/plugin-layout-guides";
import paintingPlugin from "@genart-dev/plugin-painting";
import texturesPlugin from "@genart-dev/plugin-textures";
import animationPlugin from "@genart-dev/plugin-animation";
import colorAdjustPlugin from "@genart-dev/plugin-color-adjust";
import compositingPlugin from "@genart-dev/plugin-compositing";
import constructionPlugin from "@genart-dev/plugin-construction";
import distributionPlugin from "@genart-dev/plugin-distribution";
import figurePlugin from "@genart-dev/plugin-figure";
import layoutCompositionPlugin from "@genart-dev/plugin-layout-composition";
import perspectivePlugin from "@genart-dev/plugin-perspective";
import posesPlugin from "@genart-dev/plugin-poses";
import stylesPlugin from "@genart-dev/plugin-styles";
import symbolsPlugin from "@genart-dev/plugin-symbols";
import { EditorState } from "./state.js";
import {
  createWorkspace,
  openWorkspace,
  addSketchToWorkspace,
  removeSketchFromWorkspace,
  listWorkspaceSketches,
} from "./tools/workspace.js";
import {
  createSketch,
  openSketch,
  updateSketch,
  updateAlgorithm,
  saveSketch,
  forkSketch,
  deleteSketch,
} from "./tools/sketch.js";
import {
  getSelection,
  selectSketch,
  getEditorState,
} from "./tools/selection.js";
import {
  setParameters,
  setColors,
  setSeed,
  setCanvasSize,
  randomizeParameters,
} from "./tools/parameters.js";
import {
  arrangeSketches,
  autoArrange,
  groupSketches,
} from "./tools/arrangement.js";
import { listSketches, searchSketches } from "./tools/gallery.js";
import { mergeSketches } from "./tools/merge.js";
import { snapshotLayout } from "./tools/snapshot-layout.js";
import { listSkills, loadSkill, getGuidelines, suggestSkills } from "./tools/knowledge.js";
import {
  listComponents,
  addComponent,
  removeComponent,
} from "./tools/components.js";
import { captureScreenshot, captureBatch } from "./tools/capture.js";
import { exportSketch } from "./tools/export.js";
import {
  designAddLayer,
  designRemoveLayer,
  designListLayers,
  designGetLayer,
  designUpdateLayer,
  designSetTransform,
  designSetBlend,
  designReorderLayers,
  designDuplicateLayer,
  designToggleVisibility,
  designLockLayer,
  designCaptureComposite,
} from "./tools/design.js";
import { registerPluginMcpTools } from "./tools/design-plugins.js";
import { registerResources } from "./resources/index.js";
import { registerPrompts } from "./prompts/index.js";

/** Wrap a tool handler to return MCP-formatted content (text JSON). */
function jsonResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** Wrap a tool handler to return an MCP error. */
function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
    isError: true as const,
  };
}

/**
 * Initialize the plugin registry with all free design plugins.
 * Called once at server startup. Returns the registry for tool registration.
 */
async function initializePluginRegistry(): Promise<PluginRegistry> {
  const registry = createPluginRegistry({
    surface: "mcp",
    supportsInteractiveTools: false,
    supportsRendering: false,
  });

  // Register all design plugins
  await registry.register(typographyPlugin);
  await registry.register(filtersPlugin);
  await registry.register(shapesPlugin);
  await registry.register(layoutGuidesPlugin);
  await registry.register(paintingPlugin);
  await registry.register(texturesPlugin);
  await registry.register(animationPlugin);
  await registry.register(colorAdjustPlugin);
  await registry.register(compositingPlugin);
  await registry.register(constructionPlugin);
  await registry.register(distributionPlugin);
  await registry.register(figurePlugin);
  await registry.register(layoutCompositionPlugin);
  await registry.register(perspectivePlugin);
  await registry.register(posesPlugin);
  await registry.register(stylesPlugin);
  await registry.register(symbolsPlugin);

  return registry;
}

/** Create and configure the MCP server with all tools. */
export function createServer(state: EditorState): McpServer {
  const server = new McpServer(
    {
      name: "@genart/mcp-server",
      version: "0.3.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  // Initialize plugin registry (async, but we register tools synchronously
  // after awaiting inside this wrapper — the tools are registered before
  // the server starts accepting requests because connect() is called after)
  const registryReady = initializePluginRegistry().then((registry) => {
    state.pluginRegistry = registry;
    registerPluginMcpTools(server, registry, state);
  });

  // Store the promise so callers can await if needed
  (server as McpServer & { _pluginsReady?: Promise<void> })._pluginsReady =
    registryReady;

  registerWorkspaceTools(server, state);
  registerSketchTools(server, state);
  registerComponentTools(server, state);
  registerSelectionTools(server, state);
  registerParameterTools(server, state);
  registerArrangementTools(server, state);
  registerGalleryTools(server, state);
  registerMergeTools(server, state);
  registerSnapshotTools(server, state);
  registerKnowledgeTools(server, state);
  registerDesignTools(server, state);

  registerCaptureTools(server, state);
  registerExportTools(server, state);

  registerResources(server, state);
  registerPrompts(server, state);

  return server;
}

// ---------------------------------------------------------------------------
// Workspace Tools
// ---------------------------------------------------------------------------

function registerWorkspaceTools(server: McpServer, state: EditorState): void {
  server.tool(
    "create_workspace",
    "Create a new .genart-workspace file with optional initial sketches",
    {
      title: z.string().describe("Workspace title"),
      path: z.string().describe("File path (must end in .genart-workspace)"),
      sketches: z
        .array(z.string())
        .optional()
        .describe("Initial sketch file paths to include"),
      arrangement: z
        .enum(["grid", "row", "column"])
        .optional()
        .describe("Auto-arrange initial sketches (default: grid)"),
      spacing: z
        .number()
        .optional()
        .describe("Spacing between arranged sketches in pixels (default: 200)"),
    },
    async (args) => {
      try {
        const result = await createWorkspace(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "open_workspace",
    "Open an existing .genart-workspace file and load all referenced sketches",
    {
      path: z.string().describe("File path to .genart-workspace file"),
    },
    async (args) => {
      try {
        const result = await openWorkspace(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "add_sketch_to_workspace",
    "Add an existing .genart sketch file to the active workspace",
    {
      sketchPath: z.string().describe("Path to the .genart file to add"),
      position: z
        .object({
          x: z.number().describe("X position on canvas"),
          y: z.number().describe("Y position on canvas"),
        })
        .optional()
        .describe("Canvas position (default: auto-placed to the right)"),
      label: z.string().optional().describe("Display label override"),
    },
    async (args) => {
      try {
        const result = await addSketchToWorkspace(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "remove_sketch_from_workspace",
    "Remove a sketch from the active workspace (optionally delete the file)",
    {
      sketchId: z.string().describe("ID of the sketch to remove"),
      deleteFile: z
        .boolean()
        .optional()
        .describe("Also delete the .genart file from disk (default: false)"),
    },
    async (args) => {
      try {
        const result = await removeSketchFromWorkspace(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "list_workspace_sketches",
    "List all sketches in the active workspace with metadata",
    {
      includeState: z
        .boolean()
        .optional()
        .describe("Include current seed and param values (default: false)"),
    },
    async (args) => {
      try {
        const result = await listWorkspaceSketches(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Sketch Lifecycle Tools
// ---------------------------------------------------------------------------

function registerSketchTools(server: McpServer, state: EditorState): void {
  server.tool(
    "create_sketch",
    "Create a new .genart sketch file from metadata, parameters, and algorithm. IMPORTANT: Do not embed common utilities (PRNG, noise, easing, color math, vector ops) inline in the algorithm. Instead, declare them as components: { \"prng\": \"^1.0.0\", \"noise-2d\": \"^1.0.0\" }. Then use the exported functions directly in your algorithm (e.g., mulberry32, fbm2D). Use list_components to see all available components for the current renderer.",
    {
      id: z.string().describe("URL-safe kebab-case identifier"),
      title: z.string().describe("Human-readable title"),
      path: z.string().describe("Relative file path (must end in .genart, e.g. 'my-sketch.genart')"),
      renderer: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Renderer type (default: p5)"),
      canvas: z
        .object({
          preset: z.string().optional().describe("Canvas preset name"),
          width: z.number().optional().describe("Width in pixels"),
          height: z.number().optional().describe("Height in pixels"),
        })
        .optional()
        .describe("Canvas dimensions (default: square-1200)"),
      philosophy: z.string().optional().describe("Markdown design philosophy"),
      parameters: z
        .array(
          z.object({
            key: z.string(),
            label: z.string(),
            min: z.number(),
            max: z.number(),
            step: z.number(),
            default: z.number(),
          }),
        )
        .optional()
        .describe("Parameter definitions"),
      colors: z
        .array(
          z.object({
            key: z.string(),
            label: z.string(),
            default: z.string(),
          }),
        )
        .optional()
        .describe("Color definitions"),
      themes: z
        .array(
          z.object({
            name: z.string(),
            colors: z.array(z.string()),
          }),
        )
        .optional()
        .describe("Theme presets"),
      algorithm: z
        .string()
        .optional()
        .describe("Algorithm source code (default: renderer template). For p5: must be `function sketch(p, state) { ... }` in instance mode. State provides: state.WIDTH, state.HEIGHT, state.SEED (number), state.PARAMS (keyed by param key), state.COLORS (keyed by color key, hex strings). Use p5 instance methods (p.createCanvas, p.background, etc)."),
      seed: z.number().optional().describe("Initial random seed (default: random)"),
      skills: z.array(z.string()).optional().describe("Design skill references"),
      components: z
        .record(
          z.union([
            z.string(),
            z.object({
              version: z.string().optional(),
              code: z.string().optional(),
              exports: z.array(z.string()).optional(),
            }),
          ]),
        )
        .optional()
        .describe("Component dependencies. Use list_components to see available. Keys are component names, values are semver ranges (e.g. \"^1.0.0\") or objects with version/code/exports."),
      addToWorkspace: z
        .string()
        .optional()
        .describe("Path to workspace to add sketch to after creation"),
      agent: z.string().optional().describe("Your CLI agent name (e.g. 'claude-code', 'codex-cli', 'gemini-cli', 'opencode', 'kiro')"),
      model: z.string().optional().describe("Your AI model identifier (e.g. 'claude-opus-4-6', 'gpt-4o', 'gemini-2.5-pro')"),
    },
    async (args) => {
      try {
        const result = await createSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "open_sketch",
    "Open a sketch by ID to view and edit it (sets selection)",
    {
      sketchId: z.string().describe("ID of the sketch to open"),
    },
    async (args) => {
      try {
        const result = await openSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "update_sketch",
    "Update metadata, parameters, colors, or canvas of an existing sketch",
    {
      sketchId: z.string().describe("ID of the sketch to update"),
      title: z.string().optional().describe("New title"),
      philosophy: z.string().optional().describe("New philosophy text (markdown)"),
      canvas: z
        .object({
          preset: z.string().optional().describe("Canvas preset name"),
          width: z.number().optional().describe("Width in pixels"),
          height: z.number().optional().describe("Height in pixels"),
        })
        .optional()
        .describe("New canvas dimensions"),
      parameters: z
        .array(
          z.object({
            key: z.string(),
            label: z.string(),
            min: z.number(),
            max: z.number(),
            step: z.number(),
            default: z.number(),
          }),
        )
        .optional()
        .describe("Replace parameter definitions"),
      colors: z
        .array(
          z.object({
            key: z.string(),
            label: z.string(),
            default: z.string(),
          }),
        )
        .optional()
        .describe("Replace color definitions"),
      themes: z
        .array(
          z.object({
            name: z.string(),
            colors: z.array(z.string()),
          }),
        )
        .optional()
        .describe("Replace theme presets"),
      seed: z.number().optional().describe("New random seed"),
      skills: z.array(z.string()).optional().describe("Replace design skill references"),
      agent: z.string().optional().describe("Your CLI agent name (e.g. 'claude-code', 'codex-cli', 'gemini-cli', 'opencode', 'kiro')"),
      model: z.string().optional().describe("Your AI model identifier (e.g. 'claude-opus-4-6', 'gpt-4o', 'gemini-2.5-pro')"),
    },
    async (args) => {
      try {
        const result = await updateSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "update_algorithm",
    "Replace the algorithm source code of a sketch. If adding/changing components, pass them in the components field alongside the algorithm.",
    {
      sketchId: z.string().describe("ID of the sketch to update"),
      algorithm: z.string().describe("New algorithm source code. For p5: must be `function sketch(p, state) { ... }` in instance mode. State provides: state.WIDTH, state.HEIGHT, state.SEED, state.PARAMS (keyed by param key), state.COLORS (keyed by color key)."),
      validate: z
        .boolean()
        .optional()
        .describe("Run renderer-specific validation before saving (default: true)"),
      components: z
        .record(
          z.union([
            z.string(),
            z.object({
              version: z.string().optional(),
              code: z.string().optional(),
              exports: z.array(z.string()).optional(),
            }),
          ]),
        )
        .optional()
        .describe("Component dependencies to resolve alongside the algorithm update. Use list_components to see available."),
      agent: z.string().optional().describe("Your CLI agent name (e.g. 'claude-code', 'codex-cli', 'gemini-cli', 'opencode', 'kiro')"),
      model: z.string().optional().describe("Your AI model identifier (e.g. 'claude-opus-4-6', 'gpt-4o', 'gemini-2.5-pro')"),
    },
    async (args) => {
      try {
        const result = await updateAlgorithm(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "save_sketch",
    "Persist the current in-memory state of a sketch to disk",
    {
      sketchId: z.string().describe("ID of the sketch to save"),
    },
    async (args) => {
      try {
        const result = await saveSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "fork_sketch",
    "Create a variant of an existing sketch with a new ID and optional modifications",
    {
      sourceId: z.string().describe("ID of the sketch to fork"),
      newId: z.string().describe("URL-safe kebab-case ID for the forked sketch"),
      title: z.string().optional().describe("Title for the fork (default: '[source title] (fork)')"),
      position: z
        .object({
          x: z.number().describe("X position on canvas"),
          y: z.number().describe("Y position on canvas"),
        })
        .optional()
        .describe("Canvas position (default: auto-placed to the right of source)"),
      modifications: z
        .object({
          renderer: z.enum(["p5", "three", "glsl", "canvas2d", "svg"]).optional(),
          canvas: z
            .object({
              preset: z.string().optional(),
              width: z.number().optional(),
              height: z.number().optional(),
            })
            .optional(),
          parameters: z
            .array(
              z.object({
                key: z.string(),
                label: z.string(),
                min: z.number(),
                max: z.number(),
                step: z.number(),
                default: z.number(),
              }),
            )
            .optional(),
          colors: z
            .array(
              z.object({
                key: z.string(),
                label: z.string(),
                default: z.string(),
              }),
            )
            .optional(),
          algorithm: z.string().optional(),
          philosophy: z.string().optional(),
        })
        .optional()
        .describe("Fields to override in the fork"),
      newSeed: z
        .boolean()
        .optional()
        .describe("Generate a new random seed for the fork (default: true)"),
      agent: z.string().optional().describe("Your CLI agent name (e.g. 'claude-code', 'codex-cli', 'gemini-cli', 'opencode', 'kiro')"),
      model: z.string().optional().describe("Your AI model identifier (e.g. 'claude-opus-4-6', 'gpt-4o', 'gemini-2.5-pro')"),
    },
    async (args) => {
      try {
        const result = await forkSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "delete_sketch",
    "Delete a sketch file from disk and remove it from the workspace",
    {
      sketchId: z.string().describe("ID of the sketch to delete"),
      keepFile: z
        .boolean()
        .optional()
        .describe("Keep the .genart file on disk (default: false)"),
    },
    async (args) => {
      try {
        const result = await deleteSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Component Tools
// ---------------------------------------------------------------------------

function registerComponentTools(server: McpServer, state: EditorState): void {
  server.tool(
    "list_components",
    "List available reusable components from the registry, filtered by renderer and/or category. Components provide common utilities (PRNG, noise, easing, color math, etc.) that can be declared as dependencies instead of inlining code in the algorithm.",
    {
      renderer: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Filter by renderer compatibility"),
      category: z
        .enum([
          "randomness", "noise", "math", "easing", "color", "vector",
          "geometry", "grid", "particle", "physics", "distribution",
          "pattern", "sdf", "transform", "animation", "string",
          "data-structure", "imaging",
        ])
        .optional()
        .describe("Filter by component category"),
    },
    async (args) => {
      try {
        const result = await listComponents(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "add_component",
    "Add a component dependency to an existing sketch. Resolves the component and any transitive dependencies from the registry, validates renderer compatibility, and writes the resolved form to the sketch file.",
    {
      sketchId: z.string().describe("ID of the sketch to add the component to"),
      component: z.string().describe("Component name (e.g. 'prng', 'noise-2d', 'glsl-noise')"),
      version: z
        .string()
        .optional()
        .describe("Version range (default: '^1.0.0')"),
    },
    async (args) => {
      try {
        const result = await addComponent(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "remove_component",
    "Remove a component dependency from a sketch. Checks for dependent components and warns if the algorithm references the component's exports.",
    {
      sketchId: z.string().describe("ID of the sketch to remove the component from"),
      component: z.string().describe("Component name to remove"),
    },
    async (args) => {
      try {
        const result = await removeComponent(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Selection & Context Tools
// ---------------------------------------------------------------------------

function registerSelectionTools(server: McpServer, state: EditorState): void {
  server.tool(
    "get_selection",
    "Return full context for the currently selected sketch(es) on the canvas",
    {
      includeAlgorithm: z
        .boolean()
        .optional()
        .describe("Include full algorithm source (default: true)"),
      includePhilosophy: z
        .boolean()
        .optional()
        .describe("Include philosophy markdown (default: true)"),
      includeNeighbors: z
        .boolean()
        .optional()
        .describe("Include summaries of adjacent sketches (default: false)"),
    },
    async (args) => {
      try {
        const result = await getSelection(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "select_sketch",
    "Set the canvas selection to one or more sketches by ID",
    {
      sketchIds: z
        .array(z.string())
        .describe("IDs of sketches to select"),
      addToSelection: z
        .boolean()
        .optional()
        .describe("Add to existing selection instead of replacing (default: false)"),
    },
    async (args) => {
      try {
        const result = await selectSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "get_editor_state",
    "Return a full snapshot of the MCP server's current state",
    {},
    async () => {
      try {
        const result = await getEditorState(state);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "set_working_directory",
    "Set the working directory for file operations. All paths are resolved relative to this directory.",
    {
      path: z.string().describe("Absolute path to use as the working directory"),
    },
    async (args) => {
      try {
        const dir = args.path;
        if (!dir.startsWith("/")) {
          return toolError("Path must be absolute");
        }
        state.setBasePath(dir);
        return jsonResult({ success: true, workingDirectory: dir });
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Parameter Tools
// ---------------------------------------------------------------------------

function registerParameterTools(server: McpServer, state: EditorState): void {
  server.tool(
    "set_parameters",
    "Update the runtime parameter values of a sketch's current state",
    {
      sketchId: z.string().describe("ID of the sketch to update"),
      params: z
        .record(z.number())
        .describe("Parameter key-value pairs to set"),
    },
    async (args) => {
      try {
        const result = await setParameters(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "set_colors",
    "Update the runtime color palette values of a sketch's current state",
    {
      sketchId: z.string().describe("ID of the sketch to update"),
      colors: z
        .record(z.string())
        .describe("Color key-value pairs to set (hex strings)"),
    },
    async (args) => {
      try {
        const result = await setColors(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "set_seed",
    "Set the random seed of a sketch, optionally generating a random value",
    {
      sketchId: z.string().describe("ID of the sketch to update"),
      seed: z
        .number()
        .optional()
        .describe("Explicit seed value (default: generate random 0–99999)"),
    },
    async (args) => {
      try {
        const result = await setSeed(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "set_canvas_size",
    "Change the canvas dimensions of a sketch using a preset or explicit width/height",
    {
      sketchId: z.string().describe("ID of the sketch to update"),
      preset: z.string().optional().describe("Canvas preset name"),
      width: z.number().optional().describe("Explicit width in pixels"),
      height: z.number().optional().describe("Explicit height in pixels"),
    },
    async (args) => {
      try {
        const result = await setCanvasSize(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "randomize_parameters",
    "Generate random values for all or specific parameters within their defined ranges",
    {
      sketchId: z.string().describe("ID of the sketch to randomize"),
      paramKeys: z
        .array(z.string())
        .optional()
        .describe("Specific parameter keys to randomize (default: all)"),
      newSeed: z
        .boolean()
        .optional()
        .describe("Also randomize the seed (default: false)"),
    },
    async (args) => {
      try {
        const result = await randomizeParameters(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Arrangement Tools
// ---------------------------------------------------------------------------

function registerArrangementTools(
  server: McpServer,
  state: EditorState,
): void {
  server.tool(
    "arrange_sketches",
    "Move specific sketches to explicit positions on the canvas",
    {
      positions: z
        .array(
          z.object({
            sketchId: z.string().describe("ID of the sketch to move"),
            x: z.number().describe("X position on canvas"),
            y: z.number().describe("Y position on canvas"),
          }),
        )
        .describe("Explicit position assignments"),
    },
    async (args) => {
      try {
        const result = await arrangeSketches(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "auto_arrange",
    "Automatically lay out all or selected sketches using a configurable layout algorithm",
    {
      layout: z
        .enum(["grid", "row", "column", "masonry"])
        .optional()
        .describe("Layout algorithm (default: grid)"),
      sketchIds: z
        .array(z.string())
        .optional()
        .describe("Specific sketches to arrange (default: all)"),
      spacing: z
        .number()
        .optional()
        .describe("Gap between sketches in pixels (default: 200)"),
      sortBy: z
        .enum(["title", "created", "modified", "renderer"])
        .optional()
        .describe("Sort order before arranging (default: created)"),
      origin: z
        .object({
          x: z.number().describe("X origin"),
          y: z.number().describe("Y origin"),
        })
        .optional()
        .describe("Top-left origin for the arrangement (default: {x:0, y:0})"),
    },
    async (args) => {
      try {
        const result = await autoArrange(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "group_sketches",
    "Create or update a named group of sketches in the workspace",
    {
      groupId: z.string().describe("Unique group identifier"),
      label: z.string().describe("Display label for the group"),
      sketchIds: z
        .array(z.string())
        .describe("IDs of sketches to include in the group"),
      color: z
        .string()
        .optional()
        .describe("Optional group color (hex string)"),
    },
    async (args) => {
      try {
        const result = await groupSketches(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Gallery Tools
// ---------------------------------------------------------------------------

function registerGalleryTools(server: McpServer, state: EditorState): void {
  server.tool(
    "list_sketches",
    "Scan the workspace directory for all .genart files with metadata summaries",
    {
      directory: z
        .string()
        .optional()
        .describe("Directory to scan (default: workspace directory)"),
      recursive: z
        .boolean()
        .optional()
        .describe("Scan subdirectories (default: false)"),
      includeUnreferenced: z
        .boolean()
        .optional()
        .describe(
          "Include files not in the active workspace (default: true)",
        ),
    },
    async (args) => {
      try {
        const result = await listSketches(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "search_sketches",
    "Search loaded sketches by title, renderer, parameters, canvas size, or skills",
    {
      query: z
        .string()
        .optional()
        .describe("Substring match against sketch title (case-insensitive)"),
      renderer: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Filter by renderer type"),
      minParameters: z
        .number()
        .optional()
        .describe("Minimum number of parameters"),
      maxParameters: z
        .number()
        .optional()
        .describe("Maximum number of parameters"),
      canvasWidth: z
        .number()
        .optional()
        .describe("Exact canvas width match"),
      canvasHeight: z
        .number()
        .optional()
        .describe("Exact canvas height match"),
      hasPhilosophy: z
        .boolean()
        .optional()
        .describe("Filter by presence of philosophy text"),
      skills: z
        .array(z.string())
        .optional()
        .describe("Filter by sketches that use any of these skills"),
    },
    async (args) => {
      try {
        const result = await searchSketches(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Merge Tools
// ---------------------------------------------------------------------------

function registerMergeTools(server: McpServer, state: EditorState): void {
  server.tool(
    "merge_sketches",
    "Combine parameters, colors, and algorithm from 2+ source sketches into a new sketch",
    {
      sourceIds: z
        .array(z.string())
        .describe("IDs of 2+ source sketches to merge"),
      newId: z
        .string()
        .describe("URL-safe kebab-case ID for the merged sketch"),
      title: z.string().describe("Title for the merged sketch"),
      strategy: z
        .enum(["blend", "layer", "alternate"])
        .optional()
        .describe("Merge strategy (default: blend)"),
      renderer: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Renderer for merged sketch (default: first source's renderer)"),
      canvas: z
        .object({
          width: z.number().optional().describe("Canvas width"),
          height: z.number().optional().describe("Canvas height"),
        })
        .optional()
        .describe("Canvas size (default: largest source dimensions)"),
    },
    async (args) => {
      try {
        const result = await mergeSketches(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Snapshot Layout Tools
// ---------------------------------------------------------------------------

function registerSnapshotTools(server: McpServer, state: EditorState): void {
  server.tool(
    "snapshot_layout",
    "Return a structural summary of the workspace layout for AI spatial reasoning",
    {
      includeGroups: z
        .boolean()
        .optional()
        .describe("Include group information (default: true)"),
      includeState: z
        .boolean()
        .optional()
        .describe("Include current seed and param values (default: false)"),
    },
    async (args) => {
      try {
        const result = await snapshotLayout(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Capture Tools
// ---------------------------------------------------------------------------

function registerCaptureTools(server: McpServer, state: EditorState): void {
  server.tool(
    "capture_screenshot",
    "Capture a screenshot of a sketch. Returns metadata as text + a small inline JPEG image for visual review. In remote mode, metadata includes previewFileContent (base64 PNG) to Write locally.",
    {
      target: z
        .enum(["selected", "sketch"])
        .optional()
        .describe("What to capture (default: selected)"),
      sketchId: z
        .string()
        .optional()
        .describe("Required when target is 'sketch'"),
      width: z
        .number()
        .optional()
        .describe("Output width in pixels (default: sketch canvas width)"),
      height: z
        .number()
        .optional()
        .describe("Output height in pixels (default: sketch canvas height)"),
      seed: z
        .number()
        .optional()
        .describe("Override seed for this capture only"),
      params: z
        .record(z.number())
        .optional()
        .describe("Override params for this capture only"),
      previewSize: z
        .number()
        .optional()
        .describe("Max dimension for inline preview JPEG (default: 400)"),
    },
    async (args) => {
      try {
        const result = await captureScreenshot(state, args);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result.metadata, null, 2) },
            { type: "image" as const, data: result.previewJpegBase64, mimeType: "image/jpeg" as const },
          ],
        };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "capture_batch",
    "Capture screenshots of multiple sketches in parallel. Returns metadata as text + inline JPEG images for visual review.",
    {
      sketchIds: z
        .array(z.string())
        .optional()
        .describe("IDs of sketches to capture (default: all)"),
      width: z
        .number()
        .optional()
        .describe("Override width for all captures"),
      height: z
        .number()
        .optional()
        .describe("Override height for all captures"),
      seed: z
        .number()
        .optional()
        .describe("Override seed for all captures"),
      previewSize: z
        .number()
        .optional()
        .describe("Max dimension for inline preview JPEGs (default: 200 for batch)"),
    },
    async (args) => {
      try {
        const result = await captureBatch(state, args);
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: "image/jpeg" }
        > = [
          { type: "text", text: JSON.stringify(result.metadata, null, 2) },
        ];
        // Add per-sketch metadata + inline JPEG image blocks
        for (const item of result.items) {
          content.push({
            type: "text",
            text: JSON.stringify(item.metadata, null, 2),
          });
          content.push({
            type: "image",
            data: item.inlineJpegBase64,
            mimeType: "image/jpeg",
          });
        }
        return { content };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Export Tools
// ---------------------------------------------------------------------------

function registerExportTools(server: McpServer, state: EditorState): void {
  server.tool(
    "export_sketch",
    "Export a sketch as standalone HTML, PNG, SVG, raw algorithm, or bundled ZIP",
    {
      sketchId: z.string().describe("ID of the sketch to export"),
      format: z
        .enum(["html", "png", "svg", "algorithm", "zip"])
        .describe("Export format"),
      outputPath: z.string().describe("File path to write the export"),
      width: z
        .number()
        .optional()
        .describe("Override width for PNG/SVG export"),
      height: z
        .number()
        .optional()
        .describe("Override height for PNG/SVG export"),
      seed: z
        .number()
        .optional()
        .describe("Override seed for this export"),
      params: z
        .record(z.number())
        .optional()
        .describe("Override params for this export"),
    },
    async (args) => {
      try {
        const result = await exportSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Design Layer Tools (12 core tools)
// ---------------------------------------------------------------------------

function registerDesignTools(server: McpServer, state: EditorState): void {
  server.tool(
    "design_add_layer",
    "Add a new design layer of a given type to the active sketch. Layer types come from registered plugins (e.g. 'typography:text', 'filter:grain', 'shapes:rect', 'guides:thirds').",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      type: z.string().describe("Layer type ID (e.g. 'typography:text', 'filter:grain', 'shapes:rect')"),
      name: z.string().optional().describe("Layer display name (default: type's display name)"),
      properties: z
        .record(z.unknown())
        .optional()
        .describe("Initial layer properties (merged with type defaults)"),
      transform: z
        .object({
          x: z.number().optional(),
          y: z.number().optional(),
          width: z.number().optional(),
          height: z.number().optional(),
          rotation: z.number().optional(),
          scaleX: z.number().optional(),
          scaleY: z.number().optional(),
          anchorX: z.number().optional(),
          anchorY: z.number().optional(),
        })
        .optional()
        .describe("Layer transform (default: full canvas)"),
      opacity: z.number().optional().describe("Layer opacity 0–1 (default: 1)"),
      blendMode: z.string().optional().describe("Blend mode (default: 'normal')"),
      index: z.number().optional().describe("Insert position in layer stack (default: top)"),
    },
    async (args) => {
      try {
        const result = await designAddLayer(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_remove_layer",
    "Remove a design layer from the active sketch",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer to remove"),
    },
    async (args) => {
      try {
        const result = await designRemoveLayer(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_list_layers",
    "List all design layers in the active sketch with their types, visibility, and key properties",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
    },
    async (args) => {
      try {
        const result = await designListLayers(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_get_layer",
    "Get full details of a single design layer including all properties and transform",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer to inspect"),
    },
    async (args) => {
      try {
        const result = await designGetLayer(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_update_layer",
    "Update properties on a design layer (e.g. text content, filter intensity, shape fill color)",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer to update"),
      name: z.string().optional().describe("New display name"),
      properties: z
        .record(z.unknown())
        .optional()
        .describe("Property key-value pairs to set"),
    },
    async (args) => {
      try {
        const result = await designUpdateLayer(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_set_transform",
    "Set the position, size, rotation, and scale of a design layer",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer to transform"),
      x: z.number().optional().describe("X position"),
      y: z.number().optional().describe("Y position"),
      width: z.number().optional().describe("Width"),
      height: z.number().optional().describe("Height"),
      rotation: z.number().optional().describe("Rotation in degrees"),
      scaleX: z.number().optional().describe("Horizontal scale"),
      scaleY: z.number().optional().describe("Vertical scale"),
      anchorX: z.number().optional().describe("Anchor X (0–1)"),
      anchorY: z.number().optional().describe("Anchor Y (0–1)"),
    },
    async (args) => {
      try {
        const result = await designSetTransform(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_set_blend",
    "Set blend mode and/or opacity on a design layer",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer"),
      blendMode: z
        .enum([
          "normal", "multiply", "screen", "overlay",
          "darken", "lighten", "color-dodge", "color-burn",
          "hard-light", "soft-light", "difference", "exclusion",
          "hue", "saturation", "color", "luminosity",
        ])
        .optional()
        .describe("CSS blend mode"),
      opacity: z.number().optional().describe("Layer opacity 0–1"),
    },
    async (args) => {
      try {
        const result = await designSetBlend(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_reorder_layers",
    "Move a design layer to a new position in the z-order stack",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer to move"),
      newIndex: z.number().describe("New position (0 = bottom, n-1 = top)"),
    },
    async (args) => {
      try {
        const result = await designReorderLayers(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_duplicate_layer",
    "Clone a design layer with a new ID, inserted directly above the source",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer to duplicate"),
    },
    async (args) => {
      try {
        const result = await designDuplicateLayer(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_toggle_visibility",
    "Show or hide a design layer",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer"),
      visible: z.boolean().optional().describe("Set visibility (default: toggle)"),
    },
    async (args) => {
      try {
        const result = await designToggleVisibility(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_lock_layer",
    "Lock or unlock a design layer to prevent accidental edits",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
      layerId: z.string().describe("ID of the layer"),
      locked: z.boolean().optional().describe("Set lock state (default: toggle)"),
    },
    async (args) => {
      try {
        const result = await designLockLayer(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "design_capture_composite",
    "Get info about the design layer composite for a sketch. For full visual capture use capture_screenshot.",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Target sketch ID (default: selected sketch)"),
    },
    async (args) => {
      try {
        const result = await designCaptureComposite(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Knowledge Tools (Phase 5 stubs)
// ---------------------------------------------------------------------------

function registerKnowledgeTools(server: McpServer, state: EditorState): void {
  server.tool(
    "list_skills",
    "List all available design knowledge skills (Phase 5)",
    {
      category: z
        .string()
        .optional()
        .describe("Filter by skill category"),
    },
    async (args) => {
      try {
        const result = await listSkills(args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "load_skill",
    "Load a specific design knowledge skill with full content (Phase 5)",
    {
      skillId: z.string().describe("ID of the skill to load"),
      renderer: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Renderer-specific examples (default: p5)"),
    },
    async (args) => {
      try {
        const result = await loadSkill(args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "get_guidelines",
    "Return design guidelines and best practices for a topic (Phase 5)",
    {
      topic: z
        .enum(["composition", "color", "process", "painting", "illustration", "parameters", "animation", "performance"])
        .describe("Guideline topic"),
      renderer: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Renderer-specific guidance"),
    },
    async (args) => {
      try {
        const result = await getGuidelines(args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "suggest_skills",
    "Recommend relevant design skills based on sketch context and/or free-text description",
    {
      sketchId: z
        .string()
        .optional()
        .describe("ID of a loaded sketch to analyze for skill recommendations"),
      context: z
        .string()
        .optional()
        .describe("Free-text description of what you're working on (e.g., 'atmospheric landscape with watercolor')"),
    },
    async (args) => {
      try {
        const result = await suggestSkills(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

