/**
 * Library presets — curated external library configurations.
 *
 * Defined locally until @genart-dev/core exports these.
 */

import type { RendererType } from "@genart-dev/core";

export interface LibraryPreset {
  readonly name: string;
  readonly version: string;
  readonly cdnUrl: string;
  readonly globalName: string;
  readonly renderers: readonly RendererType[];
  readonly license: string;
  readonly copyright: string;
  readonly url: string;
  readonly rendererVersionRequirement?: string;
}

export interface LibraryDependency extends LibraryPreset {}

export const LIBRARY_PRESETS: Record<string, LibraryPreset> = {
  "p5.brush": {
    name: "p5.brush",
    version: "2.0.3-beta",
    cdnUrl: "https://cdn.jsdelivr.net/npm/p5.brush@2.0.3-beta/dist/p5.brush.js",
    globalName: "brush",
    renderers: ["p5"] as RendererType[],
    license: "MIT",
    copyright: "Copyright (c) 2024 Alejandro Campos",
    url: "https://github.com/acamposuribe/p5.brush",
    rendererVersionRequirement: "2.x",
  },
};

export function listLibraryPresets(): string[] {
  return Object.keys(LIBRARY_PRESETS);
}

export function resolveLibraries(names: string[]): LibraryDependency[] {
  return names.map((name) => {
    const preset = LIBRARY_PRESETS[name];
    if (!preset) {
      throw new Error(`Unknown library: "${name}". Available: ${listLibraryPresets().join(", ")}`);
    }
    return { ...preset };
  });
}
