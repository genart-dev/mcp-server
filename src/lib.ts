/**
 * @genart/mcp-server library API.
 * Used by @genart/mcp-host to create per-session MCP server instances.
 */

export { createServer, type CreateServerOptions } from "./server.js";
export {
  EditorState,
  type LoadedSketch,
  type EditorMutationType,
  type EditorMutationEvent,
  type EditorStateSnapshot,
} from "./state.js";
