/**
 * Dynamic MCP tool registration from the PluginRegistry.
 * Iterates all plugin-contributed MCP tools and registers each
 * as a standard MCP server tool with the "design_" prefix.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PluginRegistry } from "@genart-dev/core";
import type { EditorState } from "../state.js";

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
  for (const tool of registry.getMcpTools()) {
    // Build the Zod-compatible shape from the plugin's JSON Schema.
    // The MCP SDK's server.tool() accepts raw JSON Schema as the shape
    // when passed as a plain object (not Zod). We pass the inputSchema
    // properties directly for compatibility.
    const inputSchema = tool.definition.inputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };

    server.tool(
      tool.name,
      tool.definition.description,
      // Pass raw JSON schema — MCP SDK accepts this alongside Zod
      inputSchema as Record<string, unknown>,
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
