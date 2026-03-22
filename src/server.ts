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
import tracePlugin from "@genart-dev/plugin-trace";
import identityPlugin from "@genart-dev/plugin-identity";
import plantsPlugin from "@genart-dev/plugin-plants";
import patternsPlugin from "@genart-dev/plugin-patterns";
import terrainPlugin from "@genart-dev/plugin-terrain";
import particlesPlugin from "@genart-dev/plugin-particles";
import atmospherePlugin from "@genart-dev/plugin-atmosphere";
import waterPlugin from "@genart-dev/plugin-water";
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
import { critiqueSketch, compareSketches } from "./tools/critique.js";
import {
  createSeries,
  developConcept,
  seriesSummary,
  promoteSketch,
} from "./tools/series.js";
import {
  addReference,
  analyzeReference,
  updateReferenceAnalysis,
  extractPalette,
} from "./tools/reference.js";
import { exportSketch } from "./tools/export.js";
import { listLibraries } from "./tools/library.js";
import { previewSketch } from "./tools/preview.js";
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
  await registry.register(tracePlugin);
  await registry.register(identityPlugin);
  await registry.register(plantsPlugin);
  await registry.register(patternsPlugin);
  await registry.register(terrainPlugin);
  await registry.register(particlesPlugin);
  await registry.register(atmospherePlugin);
  await registry.register(waterPlugin);

  return registry;
}

export interface CreateServerOptions {
  /** Only register capture tools (for local-only capture companion server). */
  captureOnly?: boolean;
}

/** Create and configure the MCP server with all tools. */
export function createServer(
  state: EditorState,
  options?: CreateServerOptions,
): McpServer {
  const captureOnly = options?.captureOnly ?? false;

  const server = new McpServer(
    {
      name: captureOnly ? "@genart/mcp-capture" : "@genart/mcp-server",
      version: "0.4.0",
    },
    {
      capabilities: {
        tools: {},
        ...(!captureOnly && { resources: {}, prompts: {} }),
      },
    },
  );

  if (captureOnly) {
    // Local capture-only mode: just capture + export tools, no remote deps
    registerCaptureTools(server, state);
    return server;
  }

  // Full server mode — register all tools
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

  // Capture tools: use local Puppeteer when available, or delegate to the
  // render service via RENDER_SERVICE_URL when running in remote mode (ADR 096).
  registerCaptureTools(server, state);
  registerCritiqueTools(server, state);
  registerSeriesTools(server, state);
  registerReferenceTools(server, state);
  registerExportTools(server, state);
  registerPreviewTools(server, state);
  registerLibraryTools(server);

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
    "Create a new .genart sketch file from metadata, parameters, and algorithm. Saves to disk, auto-creates an in-memory workspace, and opens an interactive browser preview with sliders/pickers/seed controls. Save sketches to ~/.genart/sketches/<id>.genart (directory auto-created). Do NOT present the .genart file to the user — it has no OS file association. IMPORTANT: Do not embed common utilities (PRNG, noise, easing, color math, vector ops) inline in the algorithm. Instead, declare them as components: { \"prng\": \"^1.0.0\", \"noise-2d\": \"^1.0.0\" }. Then use the exported functions directly in your algorithm (e.g., mulberry32, fbm2D). Use list_components to see all available components for the current renderer.",
    {
      id: z.string().describe("URL-safe kebab-case identifier"),
      title: z.string().describe("Human-readable title"),
      path: z.string().describe("File path ending in .genart. Use ~/.genart/sketches/<id>.genart as the default location (directory is auto-created). Example: '~/.genart/sketches/ocean-currents.genart'"),
      renderer: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg", "genart"])
        .optional()
        .describe("Renderer type (default: p5). Use 'genart' for GenArt Script (.gs) — a minimal scripting language with built-in drawing primitives, PRNG, noise, vec, easing, post-processing effects, and image/font loading."),
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
        .describe("Algorithm source code (default: renderer template). State API by renderer:\n  p5 (DEFAULT): `function sketch(p, state) { ... }` — state.canvas.width/height, state.seed, state.params.key, state.colorPalette[i]. Prefix p5 calls with `p.`\n  canvas2d: `function sketch(ctx, state) { ... }` — same state API as p5.\n  three: `function sketch(THREE, state, container) { ... }`\n  svg: `function sketch(state) { ... }` — return SVG string.\n  glsl: uniforms auto-injected (u_resolution, u_seed, u_param_<key>, u_color_<index>), no state object.\n  genart: GenArt Script source — globals: w, h, t, frame, fps, rnd(n), noise(x,y), vec(x,y), PI, lerp, clamp, map, dist, mouseX/Y, pmouseX/Y, mouseDown, touchX/Y, touches, prev (previous frame ImageData); drawing: circle/rect/line/arc/dot/poly/path x y ...; color: #hex, named, white.50, linear(#a,#b angle:90), radial(#a,#b); params: `param count 100 range:10..500`; colors: `color bg #000`; layers: `layer \"terrain:sky\" \"noon\" opacity:0.8 blend:\"multiply\"`; animation: `frame:` block; once: async (await loadFont ok); post: vignette/grain/blur/bloom/grade/scanlines/pixelate/chromatic_aberration/distort/dither/halftone — effects accept optional quality:\"auto\"|\"high\"|\"fast\" last arg. No state object — params/colors are globals.\n  Data bridge: set window.__genart_data = { strokePaths: [...] }.\n  Use `mulberry32(state.seed)` from \"prng\" component for p5/canvas2d/three/svg — NEVER `Math.random()`. For genart renderer use built-in rnd() which is seeded automatically."),
      seed: z.number().optional().describe("Initial random seed (default: random)"),
      skills: z.array(z.string()).optional().describe("Design skill references"),
      libraries: z
        .array(z.string())
        .optional()
        .describe("External library dependencies by preset name (e.g. [\"p5.brush\"]). Use list_libraries to see available presets. Libraries are loaded as CDN script tags before the algorithm. p5.brush automatically switches the renderer to p5.js 2.x and WEBGL mode."),
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
      data: z
        .record(
          z.object({
            type: z.enum(["flow-field", "value-map", "palette-map", "custom"]).describe("Data type hint"),
            source: z.enum(["component", "file", "inline"]).describe("Where the data comes from"),
            component: z.string().optional().describe("Component name (for source='component')"),
            config: z.record(z.unknown()).optional().describe("Config passed to component factory (for source='component')"),
            path: z.string().optional().describe("Relative path to .genart-data file (for source='file')"),
            value: z.unknown().optional().describe("Inline JSON data (for source='inline')"),
          }),
        )
        .optional()
        .describe("Data sources resolved before algorithm execution and injected as state.data.<key>. Use source='component' with a component factory, source='inline' for small JSON values, or source='file' for shared .genart-data files."),
      dataChannels: z
        .array(
          z.object({
            name: z.string().describe("Channel name (e.g. 'strokePaths', 'leafPaths', 'flowField', 'valueMap')"),
            type: z.enum(["vector", "scalar", "path"]).describe("Data type: 'vector' = [dx,dy,mag] grid, 'scalar' = float grid, 'path' = stroke path array"),
            cols: z.number().optional().describe("Grid columns (required for vector/scalar, ignored for path)"),
            rows: z.number().optional().describe("Grid rows (required for vector/scalar, ignored for path)"),
          }),
        )
        .optional()
        .describe("Algorithm data channels published on window.__genart_data for design layer consumption. Declare channels here so painting layers can bind to them via pathSource: 'algorithm:<channelName>'. Type 'path' channels publish StrokePath arrays (polyline points + depth/pressure/width metadata). Multiple channels supported (e.g. strokePaths for all paths, leafPaths for depth-filtered subset)."),
      addToWorkspace: z
        .string()
        .optional()
        .describe("Path to workspace to add sketch to after creation"),
      agent: z.string().optional().describe("Your CLI agent name (e.g. 'claude-code', 'codex-cli', 'gemini-cli', 'opencode', 'kiro')"),
      model: z.string().optional().describe("Your AI model identifier (e.g. 'claude-opus-4-6', 'gpt-4o', 'gemini-2.5-pro')"),
      capture: z.boolean().optional().describe("When true, automatically capture a screenshot after creation and return it inline (avoids a separate capture_screenshot call)."),
      preview: z.boolean().optional().describe("Generate an interactive HTML preview with sliders/pickers/seed controls and open it in the browser (default: true). Set to false to skip."),
    },
    async (args) => {
      try {
        const result = await createSketch(state, args);
        const shouldPreview = args.preview !== false; // default true

        // If capture requested, run headless capture and return image inline.
        // Works in both local mode (Puppeteer) and remote mode (render service delegation).
        if (args.capture) {
          try {
            const captureResult = await captureScreenshot(state, {
              target: "sketch",
              sketchId: args.id,
            });
            const content: any[] = [
              { type: "text" as const, text: JSON.stringify({
                ...result,
                capture: captureResult.metadata,
              }, null, 2) },
              {
                type: "image" as const,
                data: captureResult.previewJpegBase64,
                mimeType: "image/jpeg" as const,
              },
            ];
            if (captureResult.previewUrl) {
              content.push({
                type: "text" as const,
                text: `![sketch preview](${captureResult.previewUrl})`,
              });
            }
            return { content };
          } catch (captureErr) {
            // Capture failed but sketch was created successfully — return sketch result with capture error
            return jsonResult({
              ...result,
              captureError: captureErr instanceof Error ? captureErr.message : String(captureErr),
            });
          }
        }

        // Preview is on by default — generate interactive HTML and open in browser.
        if (shouldPreview) {
          try {
            const previewResult = await previewSketch(state, { sketchId: args.id });
            return jsonResult({ ...result, preview: previewResult.metadata });
          } catch (previewErr) {
            return jsonResult({
              ...result,
              previewError: previewErr instanceof Error ? previewErr.message : String(previewErr),
            });
          }
        }

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
      data: z
        .record(
          z.object({
            type: z.enum(["flow-field", "value-map", "palette-map", "custom"]).describe("Data type hint"),
            source: z.enum(["component", "file", "inline"]).describe("Where the data comes from"),
            component: z.string().optional().describe("Component name (for source='component')"),
            config: z.record(z.unknown()).optional().describe("Config passed to component factory"),
            path: z.string().optional().describe("Relative path to .genart-data file"),
            value: z.unknown().optional().describe("Inline JSON data"),
          }),
        )
        .optional()
        .describe("Replace data sources (injected as state.data.<key> before algorithm execution)"),
      dataChannels: z
        .array(
          z.object({
            name: z.string().describe("Channel name (e.g. 'strokePaths', 'leafPaths')"),
            type: z.enum(["vector", "scalar", "path"]).describe("Data type"),
            cols: z.number().optional().describe("Grid columns (required for vector/scalar)"),
            rows: z.number().optional().describe("Grid rows (required for vector/scalar)"),
          }),
        )
        .optional()
        .describe("Replace algorithm data channels (published on window.__genart_data for design layers)"),
      agent: z.string().optional().describe("Your CLI agent name (e.g. 'claude-code', 'codex-cli', 'gemini-cli', 'opencode', 'kiro')"),
      model: z.string().optional().describe("Your AI model identifier (e.g. 'claude-opus-4-6', 'gpt-4o', 'gemini-2.5-pro')"),
      preview: z.boolean().optional().describe("When true, generate an interactive HTML preview with sliders/pickers/seed controls and open it in the browser"),
    },
    async (args) => {
      try {
        const result = await updateSketch(state, args);

        // If preview requested, generate interactive HTML and open in browser.
        if (args.preview) {
          try {
            const previewResult = await previewSketch(state, { sketchId: args.sketchId });
            return jsonResult({ ...result, preview: previewResult.metadata });
          } catch (previewErr) {
            return jsonResult({
              ...result,
              previewError: previewErr instanceof Error ? previewErr.message : String(previewErr),
            });
          }
        }

        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "update_algorithm",
    "Replace the algorithm source code of a sketch. If adding/changing components, pass them in the components field alongside the algorithm. After updating, use preview_sketch to open an interactive preview in the browser.\n\nAlgorithm data bridge: Algorithms can publish data for design layers by setting window.__genart_data properties:\n  - Stroke paths: Set window.__genart_data.strokePaths = [{points:[{x,y},...], depth, width, pressure:[...], group}, ...]\n  - Multiple channels: Publish separate arrays (e.g. strokePaths for all paths, leafPaths for depth-filtered subset)\n  - Grid data: Set window.__genart_data.flowField/valueMap/mask as Float32Arrays for spatial algorithms\n  Painting layers bind to these channels via pathSource: 'algorithm:<channelName>'.\n  Declare channels in the sketch's dataChannels field via update_sketch.",
    {
      sketchId: z.string().describe("ID of the sketch to update"),
      algorithm: z.string().describe("New algorithm source code. State API by renderer:\n  p5: `function sketch(p, state) { ... }` — state.canvas.width/height, state.seed, state.params.key, state.colorPalette[index]. Prefix all p5 calls with `p.`\n  canvas2d: `function sketch(ctx, state) { ... }` — same state API as p5.\n  three: `function sketch(THREE, state, container) { ... }`\n  svg: `function sketch(state) { ... }` — return SVG string.\n  glsl: uniforms auto-injected (u_resolution, u_seed, u_param_<key>, u_color_<index>), no state object.\n  genart: GenArt Script source — globals: w, h, t, frame, fps, rnd(n), noise(x,y), vec(x,y), PI, lerp, clamp, map, dist, mouseX/Y, pmouseX/Y, mouseDown, touchX/Y, touches, prev (previous frame ImageData); drawing: circle/rect/line/arc/dot/poly/path x y ...; color: #hex, named, white.50, linear(#a,#b angle:90), radial(#a,#b); params: `param count 100 range:10..500`; colors: `color bg #000`; layers: `layer \"terrain:sky\" \"noon\" opacity:0.8 blend:\"multiply\"`; animation: `frame:` block; once: async (await loadFont ok); post: vignette/grain/blur/bloom/grade/scanlines/pixelate/chromatic_aberration/distort/dither/halftone — effects accept optional quality:\"auto\"|\"high\"|\"fast\" last arg. No state object — params/colors are globals.\n  Data bridge: set window.__genart_data = { strokePaths: [{points:[{x,y},...], depth, width}, ...] }.\n  Use `mulberry32(state.seed)` from \"prng\" component for p5/canvas2d/three/svg — NEVER `Math.random()`. For genart renderer use built-in rnd() which is seeded automatically."),
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
    "Set the working directory for file operations. All paths are resolved relative to this directory. Supports ~ for home directory. Creates the directory if it doesn't exist.",
    {
      path: z.string().describe("Path to use as the working directory (supports ~ for home dir)"),
    },
    async (args) => {
      try {
        const { homedir } = await import("node:os");
        const { mkdirSync, existsSync } = await import("node:fs");
        let dir = args.path;
        if (dir.startsWith("~/") || dir === "~") {
          dir = dir.replace("~", homedir());
        }
        if (!dir.startsWith("/")) {
          return toolError("Path must be absolute (or start with ~)");
        }
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
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
    "Capture a screenshot of a sketch. Returns an inline JPEG image + metadata as text. In local mode, also writes a full-res PNG to snapshots/<sketchId>-<seed>-preview.png (path in savedPreviewTo). When a previewUrl is present in the metadata, the full-res image is available at that URL for sharing (30-min TTL).\n\nIMPORTANT TIMING: The capture waits only 500ms after page load. For animated p5 sketches that accumulate particles/lines over many frames, the screenshot may appear mostly empty. This is NORMAL — it does NOT mean the algorithm is broken. To verify animated sketches, use `preview_sketch` to open in the browser instead. Only use capture_screenshot for single-frame renderers (canvas2d) or after confirming the sketch works in the browser preview.",
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
        console.error(`[capture_screenshot] jpeg base64 length: ${result.previewJpegBase64.length}`);
        const content: any[] = [
          { type: "text" as const, text: JSON.stringify(result.metadata, null, 2) },
          {
            type: "image" as const,
            data: result.previewJpegBase64,
            mimeType: "image/jpeg" as const,
          },
        ];
        // Add markdown image link for inline rendering in Claude Desktop
        if (result.previewUrl) {
          content.push({
            type: "text" as const,
            text: `![sketch preview](${result.previewUrl})`,
          });
        }
        return { content };
      } catch (e) {
        console.error(`[capture_screenshot] error: ${e instanceof Error ? e.message : String(e)}`);
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "capture_batch",
    "Capture screenshots of multiple sketches in parallel. Returns inline JPEG images + per-sketch metadata. In local mode, writes full-res PNGs to snapshots/.",
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
        const content: any[] = [
          { type: "text", text: JSON.stringify(result.metadata, null, 2) },
        ];
        // Add per-sketch image + metadata (image first for inline rendering)
        for (const item of result.items) {
          content.push({
            type: "image",
            data: item.inlineJpegBase64,
            mimeType: "image/jpeg",
          });
          content.push({
            type: "text",
            text: JSON.stringify(item.metadata, null, 2),
          });
          if (item.previewUrl) {
            content.push({
              type: "text",
              text: `![sketch preview](${item.previewUrl})`,
            });
          }
        }
        return { content };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Critique Tools (Phase 2: Perception & Self-Critique — ADR 053)
// ---------------------------------------------------------------------------

function registerCritiqueTools(server: McpServer, state: EditorState): void {
  server.tool(
    "critique_sketch",
    "Capture a sketch screenshot and return a structured self-critique framework (questions, principles, pitfalls) per aspect. Severity calibrates to compositionLevel.",
    {
      sketchId: z
        .string()
        .optional()
        .describe("Sketch to critique (default: selected sketch)"),
      aspects: z
        .array(z.enum(["composition", "color", "rhythm", "unity", "expression"]))
        .optional()
        .describe("Aspects to critique (default: all five)"),
      previewSize: z
        .number()
        .optional()
        .describe("Max dimension for inline preview JPEG (default: 400)"),
    },
    async (args) => {
      try {
        const result = await critiqueSketch(state, args);
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
    "compare_sketches",
    "Side-by-side capture of 2-4 sketches with a structured comparison framework across specified aspects.",
    {
      sketchIds: z
        .array(z.string())
        .describe("IDs of 2-4 sketches to compare"),
      aspects: z
        .array(z.enum(["composition", "color", "rhythm", "unity", "expression"]))
        .optional()
        .describe("Aspects to compare (default: all five)"),
      previewSize: z
        .number()
        .optional()
        .describe("Max dimension for inline preview JPEGs (default: 300)"),
    },
    async (args) => {
      try {
        const result = await compareSketches(state, args);
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: "image/jpeg" }
        > = [
          { type: "text", text: JSON.stringify(result.metadata, null, 2) },
        ];
        // Add per-sketch images interleaved for easy visual comparison
        for (const preview of result.previews) {
          content.push({
            type: "text",
            text: `--- Sketch: ${preview.sketchId} ---`,
          });
          content.push({
            type: "image",
            data: preview.inlineJpegBase64,
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
// Series & Conceptual Development Tools (Phase 3)
// ---------------------------------------------------------------------------

function registerSeriesTools(server: McpServer, state: EditorState): void {
  server.tool(
    "create_series",
    "Create a new curated series of sketches with narrative, intent, and studio workflow stages",
    {
      label: z.string().describe("Display label for the series"),
      narrative: z
        .string()
        .describe("Prose narrative describing the artistic exploration"),
      intent: z.string().describe("Short statement of artistic intent"),
      progression: z
        .string()
        .optional()
        .describe(
          "Series progression type (e.g. 'linear', 'branching', 'iterative')",
        ),
      stages: z
        .array(z.enum(["studies", "drafts", "refinements", "finals"]))
        .optional()
        .describe(
          "Ordered stages in the studio workflow (default: all four)",
        ),
      sketchFiles: z
        .array(z.string())
        .optional()
        .describe("File names of existing sketches to include"),
    },
    async (args) => {
      try {
        const result = await createSeries(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "develop_concept",
    "Generate a structured concept development plan with mood, palette, composition, skills, and series structure recommendations",
    {
      concept: z
        .string()
        .describe("The artistic concept or theme to develop"),
      medium: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Preferred renderer/medium (default: p5)"),
    },
    async (args) => {
      try {
        const result = await developConcept(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "series_summary",
    "Capture all sketches in a series with narrative context for holistic evaluation",
    {
      seriesId: z.string().describe("ID of the series to summarize"),
      captureScreenshots: z
        .boolean()
        .optional()
        .describe("Capture screenshots of each sketch (default: true)"),
      previewSize: z
        .number()
        .optional()
        .describe("Preview image size in pixels (default: 300)"),
    },
    async (args) => {
      try {
        const result = await seriesSummary(state, args);
        // Return text metadata + inline image previews
        const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [
          { type: "text" as const, text: JSON.stringify(result.metadata, null, 2) },
        ];
        if (result.previews) {
          for (const preview of result.previews) {
            content.push({
              type: "image" as const,
              data: preview.inlineJpegBase64,
              mimeType: "image/jpeg",
            });
          }
        }
        return { content };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "promote_sketch",
    "Promote a sketch to the next studio workflow stage — fork, upscale canvas, update compositionLevel, and add to series",
    {
      sketchId: z.string().describe("ID of the sketch to promote"),
      toStage: z
        .enum(["studies", "drafts", "refinements", "finals"])
        .describe("Target stage to promote to"),
      seriesId: z
        .string()
        .optional()
        .describe("Series to add the promoted sketch to"),
      newId: z
        .string()
        .optional()
        .describe(
          "URL-safe kebab-case ID for the promoted sketch (default: auto-generated)",
        ),
      title: z
        .string()
        .optional()
        .describe("Title for the promoted sketch (default: auto-generated)"),
      agent: z
        .string()
        .optional()
        .describe("CLI agent name"),
      model: z
        .string()
        .optional()
        .describe("AI model identifier"),
    },
    async (args) => {
      try {
        const result = await promoteSketch(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Reference Tools
// ---------------------------------------------------------------------------

function registerReferenceTools(server: McpServer, state: EditorState): void {
  server.tool(
    "add_reference",
    "Import an image as a reference for inspiration. Copies the image to the workspace references/ directory and attaches it to a series or sketch.",
    {
      image: z.string().describe("Path to the reference image file"),
      type: z
        .enum(["image", "artwork", "photograph", "texture", "palette"])
        .optional()
        .describe("Reference type (default: image)"),
      source: z
        .string()
        .optional()
        .describe("Source attribution (artist, URL, collection)"),
      seriesId: z
        .string()
        .optional()
        .describe("Series to attach the reference to"),
      sketchId: z
        .string()
        .optional()
        .describe("Sketch to attach the reference to"),
      id: z
        .string()
        .optional()
        .describe("Custom reference ID (default: derived from filename)"),
    },
    async (args) => {
      try {
        const result = await addReference(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "analyze_reference",
    "Return a structured analysis framework for a reference image, with the image for visual inspection. The agent fills in the analysis using the framework prompts.",
    {
      referenceId: z.string().describe("ID of the reference to analyze"),
      seriesId: z
        .string()
        .optional()
        .describe("Series the reference belongs to (speeds up lookup)"),
      sketchId: z
        .string()
        .optional()
        .describe("Sketch the reference belongs to (speeds up lookup)"),
      previewSize: z
        .number()
        .optional()
        .describe("Max dimension for preview image (default: native)"),
    },
    async (args) => {
      try {
        const result = await analyzeReference(state, args);
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [
          { type: "text", text: JSON.stringify(result.metadata, null, 2) },
        ];
        if (result.previewJpegBase64) {
          const ext = (result.metadata["path"] as string ?? ".png").split(".").pop() ?? "png";
          const mimeMap: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
          };
          content.push({
            type: "image",
            data: result.previewJpegBase64,
            mimeType: mimeMap[ext] ?? "image/png",
          });
        }
        return { content };
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "update_reference_analysis",
    "Save a structured analysis (composition, palette, rhythm, mood, technique) back to a reference after studying it with analyze_reference.",
    {
      referenceId: z.string().describe("ID of the reference to update"),
      seriesId: z
        .string()
        .optional()
        .describe("Series the reference belongs to"),
      sketchId: z
        .string()
        .optional()
        .describe("Sketch the reference belongs to"),
      analysis: z.object({
        composition: z.string().optional().describe("Compositional structure observations"),
        palette: z.array(z.string()).optional().describe("Dominant colors as hex values"),
        rhythm: z.string().optional().describe("Visual rhythm and pattern observations"),
        mood: z.string().optional().describe("Mood and emotional qualities"),
        technique: z.string().optional().describe("Technique and medium observations"),
        keyQualities: z.array(z.string()).optional().describe("Key qualities worth studying"),
      }).describe("Structured analysis to save"),
    },
    async (args) => {
      try {
        const result = await updateReferenceAnalysis(state, args);
        return jsonResult(result);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "extract_palette",
    "Return a reference image for color palette extraction, with guidelines for identifying dominant colors. The agent extracts hex colors visually.",
    {
      referenceId: z.string().describe("ID of the reference to extract palette from"),
      seriesId: z
        .string()
        .optional()
        .describe("Series the reference belongs to"),
      sketchId: z
        .string()
        .optional()
        .describe("Sketch the reference belongs to"),
      count: z
        .number()
        .optional()
        .describe("Number of colors to extract (default: 6)"),
    },
    async (args) => {
      try {
        const result = await extractPalette(state, args);
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [
          { type: "text", text: JSON.stringify(result.metadata, null, 2) },
        ];
        if (result.previewJpegBase64) {
          const ext = (result.metadata["path"] as string ?? ".png").split(".").pop() ?? "png";
          const mimeMap: Record<string, string> = {
            png: "image/png",
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            gif: "image/gif",
            webp: "image/webp",
            svg: "image/svg+xml",
          };
          content.push({
            type: "image",
            data: result.previewJpegBase64,
            mimeType: mimeMap[ext] ?? "image/png",
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
// Preview Tools
// ---------------------------------------------------------------------------

function registerPreviewTools(server: McpServer, state: EditorState): void {
  server.tool(
    "preview_sketch",
    "Open an interactive HTML preview of a sketch in the browser with parameter sliders, color pickers, and seed controls. Call this after update_algorithm to let the user explore changes interactively. Preview already opens automatically on create_sketch — only call this for re-previewing after updates.",
    {
      sketchId: z.string().describe("ID of the sketch to preview"),
      seed: z
        .number()
        .optional()
        .describe("Override seed for the preview"),
      params: z
        .record(z.number())
        .optional()
        .describe("Override params for the preview"),
    },
    async (args) => {
      try {
        const result = await previewSketch(state, args);
        return jsonResult(result.metadata);
      } catch (e) {
        return toolError(e instanceof Error ? e.message : String(e));
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Library Tools
// ---------------------------------------------------------------------------

function registerLibraryTools(server: McpServer): void {
  server.tool(
    "list_libraries",
    "List all curated external library presets available for use with create_sketch. Each entry shows the library name, version, compatible renderers, license, and description. Pass a library name in the `libraries` array of create_sketch to include it.",
    {},
    async () => {
      try {
        const result = listLibraries();
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
    "Add a new design layer of a given type to the active sketch. Layer types come from registered plugins (e.g. 'typography:text', 'filter:grain', 'shapes:rect', 'guides:thirds').\n\nPainting layers with algorithm stroke paths:\n  Type 'painting:stroke' can render algorithm-published paths when properties include:\n  - pathSource: 'algorithm:<channelName>' — binds to a path channel (e.g. 'algorithm:strokePaths')\n  - pathBrushId: brush preset ('flat', 'round-hard', 'round-soft', 'pencil', 'ink-pen', 'splatter')\n  - pathColor: hex color for strokes (e.g. '#5a4a2a')\n  - depthMapping: JSON string mapping path depth to brush params, e.g. '{\"maxDepth\":5,\"width\":[60,4],\"pressure\":[1.0,0.15],\"paintLoad\":[0.9,0.3],\"opacity\":[1.0,0.6]}'\n  Values interpolate linearly from depth=0 to maxDepth. Paths beyond maxDepth clamp.\n  Multiple layers can read the same or different channels for multi-pass rendering (shadow, base, highlight, leaves).",
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
    "Update properties on a design layer (e.g. text content, filter intensity, shape fill color). For painting:stroke layers, updatable properties include: pathSource, pathBrushId, pathColor, depthMapping (JSON string).",
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
        .enum(["composition", "color", "process", "painting", "illustration", "parameters", "animation", "performance", "p5-brush"])
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

