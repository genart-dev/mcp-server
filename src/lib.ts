/**
 * @genart/mcp-server library API.
 * Used by @genart/mcp-host and @genart/agent-service to create per-session
 * MCP server instances and generate standalone HTML previews.
 */

export { createServer, type CreateServerOptions } from "./server.js";
export {
  EditorState,
  type LoadedSketch,
  type EditorMutationType,
  type EditorMutationEvent,
  type EditorStateSnapshot,
} from "./state.js";
export { generateViewerHTML } from "./tools/preview.js";
