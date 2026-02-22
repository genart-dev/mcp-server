#!/usr/bin/env node
/**
 * @genart/mcp-server — MCP server for genart.dev
 *
 * Modes:
 *   stdio (default) — standard MCP stdio transport for Claude Code / CLI
 *   sidecar         — stdio transport + IPC mutation bridge for Electron desktop app
 *
 * Usage:
 *   genart-mcp                  # stdio mode
 *   genart-mcp --mode sidecar   # sidecar mode (launched by Electron)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EditorState } from "./state.js";
import { createServer } from "./server.js";
import { isSidecarMode } from "./sidecar.js";

async function main(): Promise<void> {
  const sidecar = isSidecarMode();

  if (sidecar) {
    console.error("[genart-mcp] Starting in sidecar mode");
  } else {
    console.error("[genart-mcp] Starting in stdio mode");
  }

  const state = new EditorState();
  const server = createServer(state);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[genart-mcp] Server connected and ready");
}

main().catch((err) => {
  console.error("[genart-mcp] Fatal error:", err);
  process.exit(1);
});
