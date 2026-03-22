/**
 * MCP App HTML generation.
 *
 * Combines the sketch-preview-app.html template with the bundled
 * ext-apps client code to produce a self-contained HTML resource
 * for MCP Apps-capable hosts.
 */

// @ts-ignore — esbuild text loader
import sketchPreviewTemplate from "./sketch-preview-app.html";
// @ts-ignore — virtual module from tsup esbuild plugin
import mcpAppBundle from "virtual:mcp-app-bundle";

/** URI for the sketch preview MCP App resource. */
export const SKETCH_PREVIEW_APP_URI = "ui://sketch-preview";

/** MIME type for MCP App HTML resources. */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";

let _cachedHtml: string | null = null;

/** Get the self-contained MCP App HTML with ext-apps client code inlined. */
export function getSketchPreviewAppHtml(): string {
  if (!_cachedHtml) {
    _cachedHtml = sketchPreviewTemplate.replace(
      "/* __MCP_APP_BUNDLE__ */",
      mcpAppBundle,
    );
  }
  return _cachedHtml;
}
