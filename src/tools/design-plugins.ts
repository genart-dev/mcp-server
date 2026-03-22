/**
 * Dynamic MCP tool registration from the PluginRegistry.
 * Iterates all plugin-contributed MCP tools and registers each
 * as a standard MCP server tool with the "design_" prefix.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginRegistry } from "@genart-dev/core";
import { z, type ZodTypeAny } from "zod";
import type { EditorState } from "../state.js";

/** JSON Schema property descriptor (subset we support). */
interface JsonSchemaProp {
  type?: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProp;
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
  additionalProperties?: boolean | Record<string, unknown>;
}

/**
 * Convert a single JSON Schema property descriptor to a Zod schema.
 * Handles string, number, boolean, array, and object types.
 */
function jsonSchemaToZod(prop: JsonSchemaProp): ZodTypeAny {
  let schema: ZodTypeAny;

  if (prop.enum && prop.type === "string") {
    // String enum
    schema = z.enum(prop.enum as [string, ...string[]]);
  } else {
    switch (prop.type) {
      case "string":
        schema = z.string();
        break;
      case "number":
      case "integer":
        schema = z.number();
        break;
      case "boolean":
        schema = z.boolean();
        break;
      case "array":
        schema = z.array(
          prop.items ? jsonSchemaToZod(prop.items) : z.unknown(),
        );
        break;
      case "object":
        if (prop.properties) {
          schema = jsonSchemaObjectToZod(prop);
        } else {
          schema = z.record(z.unknown());
        }
        break;
      default:
        schema = z.unknown();
    }
  }

  if (prop.description) {
    schema = schema.describe(prop.description);
  }

  return schema;
}

/**
 * Convert a JSON Schema object with properties/required to a z.object().
 */
function jsonSchemaObjectToZod(
  schema: JsonSchemaProp,
): z.ZodObject<Record<string, ZodTypeAny>> {
  const props = schema.properties ?? {};
  const req = new Set(schema.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(props)) {
    let field = jsonSchemaToZod(prop);
    if (!req.has(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }

  return z.object(shape);
}

/**
 * Convert a plugin's JSON Schema inputSchema to a Zod raw shape
 * that the MCP SDK's server.tool() can recognize.
 *
 * Plugin inputSchemas are `{ type: "object", properties: {...}, required: [...] }`
 * but the MCP SDK expects either Zod schemas or a raw shape where each
 * value is a ZodTypeAny. Passing JSON Schema directly causes the SDK to
 * misinterpret it as ToolAnnotations (empty params).
 */
function pluginSchemaToZodShape(inputSchema: unknown): Record<string, ZodTypeAny> {
  const schema = inputSchema as JsonSchemaProp | undefined;
  if (!schema?.properties) {
    return {};
  }

  const req = new Set(schema.required ?? []);
  const shape: Record<string, ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(schema.properties)) {
    let field = jsonSchemaToZod(prop as JsonSchemaProp);
    if (!req.has(key)) {
      field = field.optional();
    }
    shape[key] = field;
  }

  return shape;
}

/**
 * Register all plugin-contributed MCP tools with the MCP server.
 * Each tool is prefixed with "design_" by the PluginRegistry.
 *
 * Each tool delegates to its plugin handler and saves after mutation.
 */
export function registerPluginMcpTools(
  server: McpServer,
  registry: PluginRegistry,
  state: EditorState,
): void {
  const registered = new Set<string>();
  for (const tool of registry.getMcpTools()) {
    // Skip duplicate tool names (e.g. multiple plugins defining add_clouds)
    if (registered.has(tool.name)) continue;
    registered.add(tool.name);

    // Convert the plugin's JSON Schema to a Zod raw shape so the
    // MCP SDK recognizes it as a parameter schema (not annotations).
    const zodShape = pluginSchemaToZodShape(tool.definition.inputSchema);

    server.tool(
      tool.name,
      tool.definition.description,
      zodShape,
      async (args: Record<string, unknown>) => {
        try {
          // Resolve the target sketch
          const sketchId =
            (args.sketchId as string | undefined) ??
            state.requireSelectedSketchId();

          // Create the plugin tool context
          const context = state.createMcpToolContext(sketchId);

          // Delegate to plugin handler
          const result = await tool.definition.handler(args, context);

          // Save after mutation
          await state.saveSketch(sketchId);

          return {
            content: result.content.map((c) => {
              if (c.type === "text") {
                return { type: "text" as const, text: c.text };
              }
              return {
                type: "image" as const,
                data: c.data,
                mimeType: c.mimeType as "image/jpeg",
              };
            }),
            isError: result.isError,
          };
        } catch (e) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: e instanceof Error ? e.message : String(e),
                }),
              },
            ],
            isError: true as const,
          };
        }
      },
    );
  }
}
