/**
 * Component tools.
 * list_components, add_component, remove_component
 */

import { writeFile } from "fs/promises";
import {
  COMPONENT_REGISTRY,
  resolveComponents,
  serializeGenart,
  type ComponentCategory,
  type ComponentEntry,
  type RendererType,
  type SketchComponentDef,
  type SketchComponentValue,
  type SketchDefinition,
} from "@genart-dev/core";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const VALID_RENDERERS: readonly RendererType[] = [
  "p5",
  "three",
  "glsl",
  "canvas2d",
  "svg",
];

/** Maps renderer types to their target ("js" or "glsl"). */
const RENDERER_TARGET: Record<RendererType, "js" | "glsl"> = {
  p5: "js",
  three: "js",
  canvas2d: "js",
  svg: "js",
  glsl: "glsl",
  genart: "js",
};

// ---------------------------------------------------------------------------
// list_components
// ---------------------------------------------------------------------------

export interface ListComponentsInput {
  renderer?: string;
  category?: string;
}

export async function listComponents(
  _state: EditorState,
  input: ListComponentsInput,
): Promise<Record<string, unknown>> {
  let entries = Object.values(COMPONENT_REGISTRY);

  // Filter by renderer compatibility
  if (input.renderer) {
    const renderer = input.renderer as RendererType;
    const target = RENDERER_TARGET[renderer];
    if (!target) {
      throw new Error(
        `Unknown renderer type: '${input.renderer}'. Valid types: ${VALID_RENDERERS.join(", ")}`,
      );
    }
    entries = entries.filter(
      (e) =>
        e.target === target &&
        (e.renderers.length === 0 || e.renderers.includes(renderer)),
    );
  }

  // Filter by category
  if (input.category) {
    const cat = input.category as ComponentCategory;
    entries = entries.filter((e) => e.category === cat);
  }

  // Sort by category then name
  entries.sort((a, b) => {
    const catCmp = a.category.localeCompare(b.category);
    if (catCmp !== 0) return catCmp;
    return a.name.localeCompare(b.name);
  });

  const components = entries.map((e) => ({
    name: e.name,
    version: e.version,
    category: e.category,
    target: e.target,
    exports: [...e.exports],
    dependencies: [...e.dependencies],
    description: e.description,
  }));

  return {
    count: components.length,
    components,
  };
}

// ---------------------------------------------------------------------------
// add_component
// ---------------------------------------------------------------------------

export interface AddComponentInput {
  sketchId: string;
  component: string;
  version?: string;
}

export async function addComponent(
  state: EditorState,
  input: AddComponentInput,
): Promise<Record<string, unknown>> {
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;
  const renderer = def.renderer.type;

  // Validate component exists
  const entry = COMPONENT_REGISTRY[input.component];
  if (!entry) {
    throw new Error(`Unknown component: "${input.component}"`);
  }

  // Validate renderer compatibility
  const target = RENDERER_TARGET[renderer];
  if (entry.target !== target) {
    throw new Error(
      `Component "${input.component}" has target "${entry.target}" but renderer "${renderer}" requires target "${target}"`,
    );
  }
  if (entry.renderers.length > 0 && !entry.renderers.includes(renderer)) {
    throw new Error(
      `Component "${input.component}" is not compatible with renderer "${renderer}". Compatible: ${entry.renderers.join(", ")}`,
    );
  }

  // Build the component map for resolution: existing + new
  const existingComponents: Record<string, string> = {};
  if (def.components) {
    for (const [name, value] of Object.entries(def.components)) {
      if (typeof value === "string") {
        existingComponents[name] = value;
      } else if (value.version) {
        existingComponents[name] = value.version;
      }
    }
  }

  // Don't overwrite if already present
  if (existingComponents[input.component]) {
    throw new Error(
      `Component "${input.component}" is already present in sketch "${input.sketchId}"`,
    );
  }

  // Add the new component
  existingComponents[input.component] = input.version ?? "^1.0.0";

  // Resolve all components (validates and pulls transitive deps)
  const resolved = resolveComponents(existingComponents, renderer);

  // Build the resolved components record
  const resolvedRecord: Record<string, SketchComponentDef> = {};
  for (const rc of resolved) {
    resolvedRecord[rc.name] = {
      version: rc.version,
      code: rc.code,
      exports: [...rc.exports],
    };
  }

  // Determine which were newly added
  const previousNames = new Set(
    def.components ? Object.keys(def.components) : [],
  );
  const added = resolved
    .map((rc) => rc.name)
    .filter((name) => !previousNames.has(name));

  // Update sketch definition
  const newDef: SketchDefinition = {
    ...def,
    genart: "1.2",
    modified: new Date().toISOString(),
    components: resolvedRecord,
  };

  state.sketches.set(input.sketchId, {
    definition: newDef,
    path: loaded.path,
  });

  const json = serializeGenart(newDef);
  if (!state.remoteMode) {
    await writeFile(loaded.path, json, "utf-8");
  }
  state.emitMutation("sketch:updated", {
    id: input.sketchId,
    updated: ["components"],
  });

  return {
    success: true,
    sketchId: input.sketchId,
    components: resolvedRecord,
    added,
    fileContent: json,
  };
}

// ---------------------------------------------------------------------------
// remove_component
// ---------------------------------------------------------------------------

export interface RemoveComponentInput {
  sketchId: string;
  component: string;
}

export async function removeComponent(
  state: EditorState,
  input: RemoveComponentInput,
): Promise<Record<string, unknown>> {
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  if (!def.components || !def.components[input.component]) {
    throw new Error(
      `Component "${input.component}" is not present in sketch "${input.sketchId}"`,
    );
  }

  // Check if any remaining components depend on the one being removed
  const remaining = { ...def.components };
  delete remaining[input.component];

  for (const [name, value] of Object.entries(remaining)) {
    // Look up the registry entry to check dependencies
    const entry = COMPONENT_REGISTRY[name];
    if (entry && entry.dependencies.includes(input.component)) {
      throw new Error(
        `Cannot remove "${input.component}": component "${name}" depends on it`,
      );
    }
  }

  // Check if algorithm references any of the component's exports
  let warning: string | undefined;
  const removedValue = def.components[input.component]!;
  const exports: readonly string[] =
    typeof removedValue === "string"
      ? COMPONENT_REGISTRY[input.component]?.exports ?? []
      : removedValue.exports ?? [];

  const usedExports = exports.filter((exp) => def.algorithm.includes(exp));
  if (usedExports.length > 0) {
    warning = `Algorithm may reference these exports from "${input.component}": ${usedExports.join(", ")}. Review your algorithm after removal.`;
  }

  // Also remove any transitive-only deps that were pulled in by this component
  // and are no longer needed by remaining components
  const removed = [input.component];
  const neededDeps = new Set<string>();

  // Collect all deps still needed by remaining components
  for (const name of Object.keys(remaining)) {
    const entry = COMPONENT_REGISTRY[name];
    if (entry) {
      collectTransitiveDeps(name, neededDeps);
    }
  }

  // Remove orphaned transitive deps
  for (const name of Object.keys(remaining)) {
    if (!neededDeps.has(name) && !isDirectComponent(name, remaining)) {
      // This was a transitive dep only needed by the removed component
      delete remaining[name];
      removed.push(name);
    }
  }

  // Update sketch definition
  const hasRemaining = Object.keys(remaining).length > 0;
  const newDef: SketchDefinition = {
    ...def,
    modified: new Date().toISOString(),
    ...(hasRemaining ? { components: remaining } : { components: undefined }),
  };

  state.sketches.set(input.sketchId, {
    definition: newDef,
    path: loaded.path,
  });

  const json = serializeGenart(newDef);
  if (!state.remoteMode) {
    await writeFile(loaded.path, json, "utf-8");
  }
  state.emitMutation("sketch:updated", {
    id: input.sketchId,
    updated: ["components"],
  });

  return {
    success: true,
    sketchId: input.sketchId,
    removed,
    ...(warning ? { warning } : {}),
    fileContent: json,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect transitive dependency names for a component. */
function collectTransitiveDeps(name: string, deps: Set<string>): void {
  const entry = COMPONENT_REGISTRY[name];
  if (!entry) return;
  deps.add(name);
  for (const dep of entry.dependencies) {
    if (!deps.has(dep)) {
      collectTransitiveDeps(dep, deps);
    }
  }
}

/** Check if a component name was directly added (vs. only a transitive dep). */
function isDirectComponent(
  name: string,
  components: Record<string, SketchComponentValue>,
): boolean {
  // A component is "direct" if it was in the original map.
  // Since we only have the current map, treat all remaining as direct
  // unless they only appear as deps of other remaining components.
  // For simplicity in v1, we keep all remaining components.
  return name in components;
}
