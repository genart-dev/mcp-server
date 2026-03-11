#!/usr/bin/env node
/**
 * @genart/mcp-server — MCP server for genart.dev
 *
 * Modes:
 *   stdio (default)  — standard MCP stdio transport for Claude Code / CLI
 *   sidecar          — stdio transport + IPC mutation bridge for Electron desktop app
 *   --capture-only   — local capture companion (only capture tools, for Claude Desktop plugin)
 *
 * Usage:
 *   genart-mcp                   # stdio mode (all tools)
 *   genart-mcp --mode sidecar    # sidecar mode (launched by Electron)
 *   genart-mcp --capture-only    # capture-only mode (local rendering)
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { EditorState } from "./state.js";
import { createServer } from "./server.js";
import { isSidecarMode } from "./sidecar.js";

async function main(): Promise<void> {
  const captureOnly = process.argv.includes("--capture-only");
  const sidecar = !captureOnly && isSidecarMode();

  if (captureOnly) {
    console.error("[genart-mcp] Starting in capture-only mode");
  } else if (sidecar) {
    console.error("[genart-mcp] Starting in sidecar mode");
  } else {
    console.error("[genart-mcp] Starting in stdio mode");
  }

  const state = new EditorState();
  const server = createServer(state, { captureOnly });

  // Wait for plugin registry initialization so all design_* tools
  // are registered before the client connects and lists tools.
  const pluginsReady = (
    server as typeof server & { _pluginsReady?: Promise<void> }
  )._pluginsReady;
  if (pluginsReady) {
    await pluginsReady;
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("[genart-mcp] Server connected and ready");
}

main().catch((err) => {
  console.error("[genart-mcp] Fatal error:", err);
  process.exit(1);
});
