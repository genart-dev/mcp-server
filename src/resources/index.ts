/**
 * MCP resource registration.
 * Resources are read-only data endpoints exposed to AI clients.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CANVAS_PRESETS,
  createDefaultRegistry,
  createDefaultSkillRegistry,
  type RendererType,
} from "@genart-dev/core";
import type { EditorState } from "../state.js";
import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import {
  SKETCH_PREVIEW_APP_URI,
  getSketchPreviewAppHtml,
} from "../ui/app-html.js";

/** Register all MCP resources on the server. */
export function registerResources(
  server: McpServer,
  state: EditorState,
): void {
  registerSkillsResource(server);
  registerCanvasPresetsResource(server);
  registerGalleryResource(server, state);
  registerRenderersResource(server);
  registerSketchPreviewResource(server);
}

// ---------------------------------------------------------------------------
// genart://skills — design knowledge skills listing
// ---------------------------------------------------------------------------

function registerSkillsResource(server: McpServer): void {
  const skillRegistry = createDefaultSkillRegistry();

  server.resource(
    "skills",
    "genart://skills",
    {
      description:
        "List available design knowledge skills with id, name, category, complexity, and description.",
      mimeType: "application/json",
    },
    async () => {
      const skills = skillRegistry.list().map((s) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        complexity: s.complexity,
        description: s.description,
      }));

      return {
        contents: [
          {
            uri: "genart://skills",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                skills,
                total: skills.length,
                categories: skillRegistry.categories(),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// genart://presets/canvas — canvas dimension presets
// ---------------------------------------------------------------------------

function registerCanvasPresetsResource(server: McpServer): void {
  server.resource(
    "canvas-presets",
    "genart://presets/canvas",
    {
      description:
        "List all built-in canvas dimension presets with id, label, category, width, and height.",
      mimeType: "application/json",
    },
    async () => ({
      contents: [
        {
          uri: "genart://presets/canvas",
          mimeType: "application/json",
          text: JSON.stringify(
            {
              presets: CANVAS_PRESETS.map((p) => ({
                id: p.id,
                label: p.label,
                category: p.category,
                width: p.width,
                height: p.height,
              })),
            },
            null,
            2,
          ),
        },
      ],
    }),
  );
}

// ---------------------------------------------------------------------------
// genart://gallery — loaded sketches with metadata summaries
// ---------------------------------------------------------------------------

function registerGalleryResource(
  server: McpServer,
  state: EditorState,
): void {
  server.resource(
    "gallery",
    "genart://gallery",
    {
      description:
        "List all loaded sketches in the active workspace with metadata summaries.",
      mimeType: "application/json",
    },
    async () => {
      const sketches = [...state.sketches.values()].map(({ definition, path }) => ({
        id: definition.id,
        title: definition.title,
        renderer: definition.renderer,
        canvas: definition.canvas,
        parameterCount: definition.parameters?.length ?? 0,
        colorCount: definition.colors?.length ?? 0,
        hasPhilosophy: !!definition.philosophy,
        seed: definition.state.seed,
        path,
      }));

      return {
        contents: [
          {
            uri: "genart://gallery",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                workspacePath: state.workspacePath,
                sketchCount: sketches.length,
                sketches,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// genart://renderers — available renderers with metadata
// ---------------------------------------------------------------------------

function registerRenderersResource(server: McpServer): void {
  const registry = createDefaultRegistry();

  server.resource(
    "renderers",
    "genart://renderers",
    {
      description:
        "List all available renderer types with display name, algorithm language, and runtime dependencies.",
      mimeType: "application/json",
    },
    async () => {
      const types = registry.list();
      const renderers = types.map((type: RendererType) => {
        const adapter = registry.resolve(type);
        return {
          type: adapter.type,
          displayName: adapter.displayName,
          algorithmLanguage: adapter.algorithmLanguage,
          dependencies: adapter.getRuntimeDependencies().map((dep) => ({
            name: dep.name,
            version: dep.version,
            cdnUrl: dep.cdnUrl,
          })),
        };
      });

      const defaultAdapter = registry.getDefault();

      return {
        contents: [
          {
            uri: "genart://renderers",
            mimeType: "application/json",
            text: JSON.stringify(
              {
                defaultRenderer: defaultAdapter.type,
                renderers,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// ui://sketch-preview — MCP App for interactive sketch preview
// ---------------------------------------------------------------------------

function registerSketchPreviewResource(server: McpServer): void {
  registerAppResource(
    server,
    "Sketch Preview",
    SKETCH_PREVIEW_APP_URI,
    {
      description:
        "Interactive sketch preview rendered inside the conversation. " +
        "Supports all 5 renderers (p5, Three.js, GLSL, Canvas 2D, SVG) with " +
        "parameter sliders, color pickers, seed controls, and theme switching.",
    },
    async () => ({
      contents: [
        {
          uri: SKETCH_PREVIEW_APP_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: getSketchPreviewAppHtml(),
        },
      ],
      _meta: {
        ui: {
          csp: {
            // CDN access for renderer scripts (p5.js, Three.js)
            resourceDomains: [
              "https://cdnjs.cloudflare.com",
              "https://cdn.jsdelivr.net",
            ],
          },
        },
      },
    }),
  );
}
