import { defineConfig } from "vitest/config";
import { readFileSync } from "fs";
import { Plugin } from "vite";

/** Vite plugin that resolves `virtual:mcp-app-bundle` for tests. */
function mcpAppBundleTestPlugin(): Plugin {
  const virtualId = "virtual:mcp-app-bundle";
  const resolvedId = "\0" + virtualId;
  return {
    name: "mcp-app-bundle-test",
    resolveId(id) {
      if (id === virtualId) return resolvedId;
    },
    load(id) {
      if (id === resolvedId) {
        return `export default "/* test stub */";`;
      }
    },
  };
}

/** Vite plugin to load .html imports as text (mirrors esbuild text loader). */
function htmlRawPlugin(): Plugin {
  return {
    name: "html-raw",
    transform(code, id) {
      if (id.endsWith(".html")) {
        const content = readFileSync(id, "utf-8");
        return `export default ${JSON.stringify(content)};`;
      }
    },
  };
}

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
  },
  plugins: [mcpAppBundleTestPlugin(), htmlRawPlugin()],
});
