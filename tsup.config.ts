import { defineConfig } from "tsup";
import type { Plugin } from "esbuild";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { createRequire } from "module";

/**
 * esbuild plugin that provides the MCP Apps client code as a string constant.
 *
 * Resolving `virtual:mcp-app-bundle` reads the pre-bundled `app-with-deps.js`
 * from `@modelcontextprotocol/ext-apps` and wraps it as an IIFE that assigns
 * exports to `window.__McpApps`. The module exports the code as a default
 * string — ready to inline in `<script>` tags.
 */
const mcpAppBundlePlugin: Plugin = {
  name: "mcp-app-bundle",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^virtual:mcp-app-bundle$/ }, () => ({
      path: "virtual:mcp-app-bundle",
      namespace: "mcp-app-bundle",
    }));
    pluginBuild.onLoad(
      { filter: /.*/, namespace: "mcp-app-bundle" },
      async () => {
        // Resolve the pre-bundled app-with-deps.js from node_modules.
        // This file already includes all dependencies (MCP SDK, zod, etc.)
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve("@modelcontextprotocol/ext-apps/app-with-deps");
        const src = readFileSync(pkgPath, "utf-8");

        // Wrap the ESM source as an IIFE that exposes __McpApps global.
        // The source ends with `export{... CQ as App ...}` — we strip the
        // export statement and assign the named exports to the global.
        const exportMatch = src.match(/export\{([^}]+)\};\s*$/);
        if (!exportMatch) {
          throw new Error("Could not find export statement in app-with-deps.js");
        }

        // Parse export mappings: "CQ as App, K as PostMessageTransport, ..."
        const mappings = exportMatch[1].split(",").map((m) => {
          const parts = m.trim().split(/\s+as\s+/);
          return { local: parts[0], exported: parts[1] || parts[0] };
        });

        // Build the IIFE: run the module code, then pick out what we need
        const body = src.slice(0, exportMatch.index!);
        const assignments = mappings
          .map((m) => `__McpApps.${m.exported}=${m.local};`)
          .join("");

        const iife = `var __McpApps={};(function(){${body}${assignments}})();`;

        return {
          contents: `export default ${JSON.stringify(iife)};`,
          loader: "js" as const,
        };
      },
    );
  },
};

export default defineConfig({
  entry: ["src/index.ts", "src/lib.ts"],
  format: ["cjs", "esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  splitting: false,
  esbuildOptions(options) {
    options.loader = { ...options.loader, ".html": "text" };
  },
  esbuildPlugins: [mcpAppBundlePlugin],
});
