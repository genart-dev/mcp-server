import { defineConfig } from "tsup";

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
});
