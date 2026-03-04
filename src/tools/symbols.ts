/**
 * Symbol tools.
 * search_symbols, add_symbol, remove_symbol, create_symbol, list_symbol_categories
 */

import { writeFile } from "fs/promises";
import {
  serializeGenart,
  type SketchDefinition,
  type SketchSymbolDef,
  type SketchSymbolValue,
  type SymbolCategory,
  type SymbolStyle,
  type SymbolPath,
  type ThirdPartyNotice,
} from "@genart-dev/format";
import {
  SYMBOL_REGISTRY,
  listCategories,
  searchSymbols,
  resolveSymbol,
  validateSymbol,
  searchIconify,
  fetchAndParseIcon,
  SAFE_PREFIXES,
} from "@genart-dev/symbols";
import { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const VALID_STYLES: readonly SymbolStyle[] = ["geometric", "organic", "silhouette", "sketch"];
const JS_RENDERERS = new Set(["p5", "three", "canvas2d", "svg"]);

// ---------------------------------------------------------------------------
// search_symbols
// ---------------------------------------------------------------------------

export interface SearchSymbolsInput {
  query?: string;
  category?: string;
  style?: string;
  limit?: number;
}

export async function searchSymbolsTool(
  _state: EditorState,
  input: SearchSymbolsInput,
): Promise<Record<string, unknown>> {
  const results = searchSymbols({
    query: input.query,
    category: input.category as SymbolCategory | undefined,
    style: input.style as SymbolStyle | undefined,
    limit: input.limit ?? 20,
  });

  return {
    count: results.length,
    symbols: results,
  };
}

// ---------------------------------------------------------------------------
// list_symbol_categories
// ---------------------------------------------------------------------------

export async function listSymbolCategoriesTool(
  _state: EditorState,
): Promise<Record<string, unknown>> {
  const categories = listCategories();
  const total = Object.keys(SYMBOL_REGISTRY).length;
  const breakdown = categories.map((cat) => ({
    category: cat,
    count: Object.values(SYMBOL_REGISTRY).filter((s) => s.category === cat).length,
  }));
  return { categories: breakdown, total };
}

// ---------------------------------------------------------------------------
// add_symbol
// ---------------------------------------------------------------------------

export interface AddSymbolInput {
  sketchId: string;
  symbol: string;
  style?: string;
}

export async function addSymbol(
  state: EditorState,
  input: AddSymbolInput,
): Promise<Record<string, unknown>> {
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  // Validate renderer supports symbols
  if (!JS_RENDERERS.has(def.renderer.type)) {
    throw new Error(
      `Symbols require a JS-based renderer (p5, canvas2d, svg, three). ` +
      `Renderer "${def.renderer.type}" does not support symbols.`,
    );
  }

  const style = (input.style ?? "geometric") as SymbolStyle;
  if (!VALID_STYLES.includes(style)) {
    throw new Error(`Unknown style "${style}". Valid styles: ${VALID_STYLES.join(", ")}`);
  }

  // Resolve the symbol
  const resolved = resolveSymbol(input.symbol, style);

  // Check not already present
  const existing = def.symbols ?? {};
  if (existing[input.symbol]) {
    throw new Error(`Symbol "${input.symbol}" is already present in sketch "${input.sketchId}"`);
  }

  const newSymbols: Record<string, SketchSymbolValue> = { ...existing, [input.symbol]: resolved };

  // Also ensure symbol-draw component is present
  const existingComponents = def.components ?? {};
  let newComponents = existingComponents;
  if (!existingComponents["symbol-draw"]) {
    // Import here to avoid circular dep issues — resolveComponents handles it
    const { resolveComponents } = await import("@genart-dev/core");
    const compMap: Record<string, string> = {};
    for (const [name, value] of Object.entries(existingComponents)) {
      if (typeof value === "string") {
        compMap[name] = value;
      } else if (value.version) {
        compMap[name] = value.version;
      }
    }
    compMap["symbol-draw"] = "^1.0.0";
    const resolved2 = resolveComponents(compMap, def.renderer.type);
    const resolvedRecord: Record<string, unknown> = {};
    for (const rc of resolved2) {
      resolvedRecord[rc.name] = { version: rc.version, code: rc.code, exports: [...rc.exports] };
    }
    newComponents = resolvedRecord as typeof existingComponents;
  }

  const newDef: SketchDefinition = {
    ...def,
    genart: "1.3",
    modified: new Date().toISOString(),
    symbols: newSymbols,
    components: newComponents,
  };

  state.sketches.set(input.sketchId, { definition: newDef, path: loaded.path });
  const json = serializeGenart(newDef);
  if (!state.remoteMode) {
    await writeFile(loaded.path, json, "utf-8");
  }
  state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["symbols", "components"] });

  const added = Object.keys(newSymbols).filter((k) => !def.symbols?.[k]);

  return {
    success: true,
    added,
    symbolCount: Object.keys(newSymbols).length,
    fileContent: json,
  };
}

// ---------------------------------------------------------------------------
// remove_symbol
// ---------------------------------------------------------------------------

export interface RemoveSymbolInput {
  sketchId: string;
  symbol: string;
}

export async function removeSymbol(
  state: EditorState,
  input: RemoveSymbolInput,
): Promise<Record<string, unknown>> {
  const loaded = state.requireSketch(input.sketchId);
  const def = loaded.definition;

  const existing = def.symbols ?? {};
  if (!existing[input.symbol]) {
    throw new Error(`Symbol "${input.symbol}" is not present in sketch "${input.sketchId}"`);
  }

  // Warn if algorithm references the symbol
  let warning: string | undefined;
  if (def.algorithm.includes(input.symbol)) {
    warning = `The algorithm appears to reference "${input.symbol}". Removing it may cause runtime errors.`;
  }

  const newSymbols = { ...existing };
  delete newSymbols[input.symbol];

  const newDef: SketchDefinition = {
    ...def,
    modified: new Date().toISOString(),
    symbols: Object.keys(newSymbols).length > 0 ? newSymbols : undefined,
  };

  state.sketches.set(input.sketchId, { definition: newDef, path: loaded.path });
  const json = serializeGenart(newDef);
  if (!state.remoteMode) {
    await writeFile(loaded.path, json, "utf-8");
  }
  state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["symbols"] });

  return {
    success: true,
    removed: input.symbol,
    warning,
    symbolCount: Object.keys(newSymbols).length,
    fileContent: json,
  };
}

// ---------------------------------------------------------------------------
// create_symbol
// ---------------------------------------------------------------------------

export interface CreateSymbolInput {
  name: string;
  id?: string;
  category: string;
  tags: string[];
  description: string;
  paths: SymbolPath[];
  viewBox: string;
  style: string;
  sketchId?: string;
}

export async function createSymbol(
  state: EditorState,
  input: CreateSymbolInput,
): Promise<Record<string, unknown>> {
  // Validate
  const errors = validateSymbol(input.paths, input.viewBox);
  if (errors.length > 0) {
    throw new Error(`Symbol validation failed:\n${errors.join("\n")}`);
  }

  const style = (input.style ?? "geometric") as SymbolStyle;
  if (!VALID_STYLES.includes(style)) {
    throw new Error(`Unknown style "${style}". Valid styles: ${VALID_STYLES.join(", ")}`);
  }

  // Generate ID from name if not provided
  const id = input.id ?? input.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");

  const symbolDef: SketchSymbolDef = {
    id,
    name: input.name,
    style,
    paths: input.paths,
    viewBox: input.viewBox,
    custom: true,
  };

  let addedToSketch = false;
  let fileContent: string | undefined;

  if (input.sketchId) {
    const loaded = state.requireSketch(input.sketchId);
    const def = loaded.definition;

    if (!JS_RENDERERS.has(def.renderer.type)) {
      throw new Error(
        `Symbols require a JS-based renderer. Renderer "${def.renderer.type}" does not support symbols.`,
      );
    }

    const existing = def.symbols ?? {};
    const newSymbols: Record<string, SketchSymbolValue> = { ...existing, [id]: symbolDef };

    const newDef: SketchDefinition = {
      ...def,
      genart: "1.3",
      modified: new Date().toISOString(),
      symbols: newSymbols,
    };

    state.sketches.set(input.sketchId, { definition: newDef, path: loaded.path });
    fileContent = serializeGenart(newDef);
    if (!state.remoteMode) {
      await writeFile(loaded.path, fileContent, "utf-8");
    }
    state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["symbols"] });
    addedToSketch = true;
  }

  return {
    success: true,
    symbol: symbolDef,
    addedToSketch,
    fileContent,
    tip: `Use drawSymbol(ctx, "${id}", x, y, width, height) to render this symbol in your algorithm.`,
  };
}

// ---------------------------------------------------------------------------
// fetch_symbol
// ---------------------------------------------------------------------------

/**
 * Canonical third-party notices for each approved Iconify prefix.
 * Kept here so the mcp-server can inject them into .genart thirdParty arrays
 * without a network round-trip. Update when upstream license terms change.
 */
const ICONIFY_NOTICES: Readonly<Record<string, ThirdPartyNotice>> = {
  ph: {
    name: "Phosphor Icons",
    license: "MIT",
    copyright: "Copyright (c) 2023 Phosphor Icons",
    url: "https://github.com/phosphor-icons/core",
  },
  lucide: {
    name: "Lucide",
    license: "ISC",
    copyright: "Copyright (c) 2022 Lucide Contributors",
    url: "https://github.com/lucide-icons/lucide",
  },
  tabler: {
    name: "Tabler Icons",
    license: "MIT",
    copyright: "Copyright (c) 2020-2024 Paweł Kuna",
    url: "https://github.com/tabler/tabler-icons",
  },
  heroicons: {
    name: "Heroicons",
    license: "MIT",
    copyright: "Copyright (c) 2020 Tailwind Labs, Inc.",
    url: "https://github.com/tailwindlabs/heroicons",
  },
  bi: {
    name: "Bootstrap Icons",
    license: "MIT",
    copyright: "Copyright (c) 2019-2024 The Bootstrap Authors",
    url: "https://github.com/twbs/icons",
  },
  mdi: {
    name: "Material Design Icons",
    license: "Apache-2.0",
    copyright: "Copyright (c) Google LLC",
    url: "https://github.com/google/material-design-icons",
  },
  ri: {
    name: "Remix Icon",
    license: "Remix Icon License v1.0",
    copyright: "Copyright (c) 2017-2024 Remix Design",
    url: "https://github.com/Remix-Design/RemixIcon",
  },
  carbon: {
    name: "Carbon Icons",
    license: "Apache-2.0",
    copyright: "Copyright (c) 2015 IBM Corp.",
    url: "https://github.com/carbon-design-system/carbon",
  },
  fluent: {
    name: "Fluent UI System Icons",
    license: "MIT",
    copyright: "Copyright (c) 2020 Microsoft Corporation",
    url: "https://github.com/microsoft/fluentui-system-icons",
  },
};

export interface FetchSymbolInput {
  query?: string;
  iconifyId?: string;
  prefix?: string;
  sketchId?: string;
  limit?: number;
}

/**
 * Two-mode tool:
 *   - Search mode (query, no iconifyId): returns list of matching Iconify icons
 *   - Embed mode (iconifyId): fetches SVG, parses paths, embeds in sketch
 */
export async function fetchSymbol(
  state: EditorState,
  input: FetchSymbolInput,
): Promise<Record<string, unknown>> {
  // ---- Search mode ----
  if (input.query && !input.iconifyId) {
    const prefixes = input.prefix ? [input.prefix] : undefined;
    const results = await searchIconify(input.query, input.limit ?? 10, prefixes);
    return {
      mode: "search",
      results,
      tip: "Call fetch_symbol with iconifyId to embed one of these icons into a sketch",
    };
  }

  // ---- Embed mode ----
  if (!input.iconifyId) {
    return {
      error: "Provide either query (to search) or iconifyId (to embed). Approved prefixes: " +
        Object.keys(SAFE_PREFIXES).join(", "),
    };
  }

  let iconData: Awaited<ReturnType<typeof fetchAndParseIcon>>;
  try {
    iconData = await fetchAndParseIcon(input.iconifyId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("not in the approved list")) {
      return { warning: msg };
    }
    if (msg.includes("not found")) {
      return { error: msg };
    }
    if (msg.includes("unavailable")) {
      return { error: msg };
    }
    return { error: `SVG parse error: ${msg}` };
  }

  // Normalize ID: "ph:cat" → "ph-cat"
  const symbolId = iconData.iconifyId.replace(":", "-");

  const symbolDef: SketchSymbolDef = {
    id: symbolId,
    name: iconData.name,
    paths: iconData.paths,
    viewBox: iconData.viewBox,
    iconifyId: iconData.iconifyId,
    license: iconData.license,
  };

  // Embed into sketch if sketchId provided
  let addedToSketch = false;
  let fileContent: string | undefined;

  if (input.sketchId) {
    const loaded = state.requireSketch(input.sketchId);
    const def = loaded.definition;

    if (!JS_RENDERERS.has(def.renderer.type)) {
      return {
        error: `Symbols require a JS-based renderer. Renderer "${def.renderer.type}" does not support symbols.`,
      };
    }

    const existing = def.symbols ?? {};
    const newSymbols: Record<string, SketchSymbolValue> = { ...existing, [symbolId]: symbolDef };

    // Merge third-party notice — deduplicate by name
    const notice = ICONIFY_NOTICES[iconData.prefix];
    const existingNotices = def.thirdParty ?? [];
    const alreadyPresent = existingNotices.some((n) => n.name === notice?.name);
    const newThirdParty = notice && !alreadyPresent
      ? [...existingNotices, notice]
      : existingNotices.length > 0 ? existingNotices : undefined;

    const newDef: SketchDefinition = {
      ...def,
      genart: "1.3",
      modified: new Date().toISOString(),
      symbols: newSymbols,
      ...(newThirdParty ? { thirdParty: newThirdParty } : {}),
    };

    state.sketches.set(input.sketchId, { definition: newDef, path: loaded.path });
    fileContent = serializeGenart(newDef);
    if (!state.remoteMode) {
      await writeFile(loaded.path, fileContent, "utf-8");
    }
    state.emitMutation("sketch:updated", { id: input.sketchId, updated: ["symbols"] });
    addedToSketch = true;
  }

  return {
    mode: "embedded",
    symbolId,
    iconifyId: iconData.iconifyId,
    license: iconData.license,
    viewBox: iconData.viewBox,
    pathCount: iconData.paths.length,
    addedToSketch,
    fileContent,
    tip: `drawSymbol(ctx, "${symbolId}", x, y, width, height)`,
  };
}
