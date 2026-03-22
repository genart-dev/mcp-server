/**
 * Library discovery tool.
 * list_libraries — returns all curated external library presets.
 */

import {
  LIBRARY_PRESETS,
  listLibraryPresets,
} from "@genart-dev/core";

// ---------------------------------------------------------------------------
// list_libraries
// ---------------------------------------------------------------------------

export interface ListLibrariesResult {
  libraries: Array<{
    name: string;
    version: string;
    description: string;
    renderers: readonly string[];
    license: string;
    url?: string;
  }>;
}

const LIBRARY_DESCRIPTIONS: Record<string, string> = {
  "p5.brush":
    "Natural media drawing library — watercolor fills with bleed/diffusion, 11 brushes, cross-hatching, 7 vector fields. Requires p5.js 2.x (WEBGL mode, auto-initialized). Pass libraries:[\"p5.brush\"] to create_sketch.",
};

export function listLibraries(): ListLibrariesResult {
  const names = listLibraryPresets();
  const libraries = names.map((name) => {
    const preset = LIBRARY_PRESETS[name]!;
    return {
      name: preset.name,
      version: preset.version,
      description: LIBRARY_DESCRIPTIONS[name] ?? `External library: ${name}`,
      renderers: preset.renderers,
      license: preset.license,
      ...(preset.url ? { url: preset.url } : {}),
    };
  });
  return { libraries };
}
