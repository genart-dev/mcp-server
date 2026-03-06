/**
 * Reference & inspiration tools — Phase 4 (ADR 057).
 * add_reference, analyze_reference, extract_palette
 */

import { copyFile, mkdir, readFile } from "fs/promises";
import { basename, dirname, extname, resolve } from "path";
import {
  serializeGenart,
  serializeWorkspace,
  type Reference,
  type ReferenceAnalysis,
  type ReferenceType,
  type SketchDefinition,
  type WorkspaceSeries,
} from "@genart-dev/core";
import { writeFile } from "fs/promises";
import type { EditorState } from "../state.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function now(): string {
  return new Date().toISOString();
}

const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validateKebabId(id: string): void {
  if (!KEBAB_RE.test(id)) {
    throw new Error(
      "ID must be kebab-case: lowercase letters, numbers, hyphens",
    );
  }
}

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg",
]);

function isImageFile(path: string): boolean {
  return IMAGE_EXTENSIONS.has(extname(path).toLowerCase());
}

const VALID_REFERENCE_TYPES: readonly ReferenceType[] = [
  "image", "artwork", "photograph", "texture", "palette",
];

// ---------------------------------------------------------------------------
// add_reference
// ---------------------------------------------------------------------------

export interface AddReferenceInput {
  image: string;
  type?: ReferenceType;
  source?: string;
  seriesId?: string;
  sketchId?: string;
  id?: string;
}

export async function addReference(
  state: EditorState,
  input: AddReferenceInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  if (!isImageFile(input.image)) {
    throw new Error(
      `Not a recognized image file: ${input.image}. Supported: ${[...IMAGE_EXTENSIONS].join(", ")}`,
    );
  }

  // Generate ID from filename if not provided
  const id =
    input.id ??
    basename(input.image, extname(input.image))
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  if (!id) {
    throw new Error("Could not derive a valid ID from the image filename");
  }
  validateKebabId(id);

  const refType = input.type ?? "image";
  if (!VALID_REFERENCE_TYPES.includes(refType)) {
    throw new Error(
      `Invalid reference type: '${refType}'. Valid types: ${VALID_REFERENCE_TYPES.join(", ")}`,
    );
  }

  // Copy image to workspace references/ directory
  const workspaceDir = dirname(state.workspacePath!);
  const refsDir = resolve(workspaceDir, "references");
  await mkdir(refsDir, { recursive: true });

  const ext = extname(input.image);
  const destFilename = `${id}${ext}`;
  const destPath = resolve(refsDir, destFilename);
  const relativePath = `references/${destFilename}`;

  if (!state.remoteMode) {
    await copyFile(resolve(input.image), destPath);
  }

  const ref: Reference = {
    id,
    type: refType,
    path: relativePath,
    ...(input.source ? { source: input.source } : {}),
  };

  // Determine what to attach to
  let attachedTo: string;
  let workspaceJson: string | undefined;
  let sketchJson: string | undefined;

  if (input.sketchId) {
    // Attach to a specific sketch
    const loaded = state.requireSketch(input.sketchId);
    const existingRefs = loaded.definition.references ?? [];

    if (existingRefs.some((r) => r.id === id)) {
      throw new Error(
        `Reference with ID '${id}' already exists on sketch '${input.sketchId}'`,
      );
    }

    const updatedDef: SketchDefinition = {
      ...loaded.definition,
      modified: now(),
      references: [...existingRefs, ref],
    };

    state.sketches.set(input.sketchId, {
      definition: updatedDef,
      path: loaded.path,
    });

    sketchJson = serializeGenart(updatedDef);
    if (!state.remoteMode) {
      await writeFile(loaded.path, sketchJson, "utf-8");
    }

    attachedTo = `sketch:${input.sketchId}`;
    state.emitMutation("sketch:updated", { id: input.sketchId });
  } else if (input.seriesId) {
    // Attach to a series
    const seriesIndex = ws.series?.findIndex((s) => s.id === input.seriesId);
    if (seriesIndex === undefined || seriesIndex < 0 || !ws.series) {
      throw new Error(`Series '${input.seriesId}' not found in workspace`);
    }

    const series = ws.series[seriesIndex]!;
    const existingRefs = series.references ?? [];

    if (existingRefs.some((r) => r.id === id)) {
      throw new Error(
        `Reference with ID '${id}' already exists on series '${input.seriesId}'`,
      );
    }

    const updatedSeries: WorkspaceSeries = {
      ...series,
      references: [...existingRefs, ref],
    };

    state.workspace = {
      ...ws,
      modified: now(),
      series: ws.series.map((s, i) =>
        i === seriesIndex ? updatedSeries : s,
      ),
    };

    workspaceJson = serializeWorkspace(state.workspace);
    if (!state.remoteMode) {
      await writeFile(state.workspacePath!, workspaceJson, "utf-8");
    }

    attachedTo = `series:${input.seriesId}`;
    state.emitMutation("workspace:updated", { referenceAdded: id });
  } else {
    throw new Error("Either seriesId or sketchId must be specified");
  }

  return {
    success: true,
    reference: {
      id,
      type: refType,
      path: relativePath,
      source: input.source ?? null,
    },
    attachedTo,
    ...(sketchJson ? { fileContent: sketchJson } : {}),
    ...(workspaceJson ? { workspaceContent: workspaceJson } : {}),
  };
}

// ---------------------------------------------------------------------------
// analyze_reference
// ---------------------------------------------------------------------------

export interface AnalyzeReferenceInput {
  referenceId: string;
  seriesId?: string;
  sketchId?: string;
  previewSize?: number;
}

export interface AnalyzeReferenceResult {
  metadata: Record<string, unknown>;
  previewJpegBase64?: string;
}

export async function analyzeReference(
  state: EditorState,
  input: AnalyzeReferenceInput,
): Promise<AnalyzeReferenceResult> {
  state.requireWorkspace();

  // Find the reference
  const { ref, location } = findReference(state, input.referenceId, input.seriesId, input.sketchId);

  // Read the image file and produce a base64 preview
  const workspaceDir = dirname(state.workspacePath!);
  const imagePath = resolve(workspaceDir, ref.path);

  let previewJpegBase64: string | undefined;
  try {
    const imageBuffer = await readFile(imagePath);
    // Return the raw image data as base64 for the agent to analyze visually
    const ext = extname(ref.path).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    // For MCP image content blocks we need base64
    previewJpegBase64 = imageBuffer.toString("base64");
  } catch {
    // Image file not accessible — provide framework without preview
  }

  const metadata: Record<string, unknown> = {
    success: true,
    referenceId: ref.id,
    type: ref.type,
    path: ref.path,
    source: ref.source ?? null,
    location,
    existingAnalysis: ref.analysis ?? null,
    analysisFramework: {
      composition: {
        instruction: "Analyze the compositional structure of this reference.",
        prompts: [
          "What is the primary compositional structure (centered, asymmetric, diagonal, radial)?",
          "Where does the eye land first? What creates the focal point?",
          "How is negative space used — actively or passively?",
          "What is the relationship between foreground, middle ground, and background?",
          "How do the edges and corners of the frame interact with the subject?",
        ],
      },
      palette: {
        instruction: "Identify the color strategy.",
        prompts: [
          "What are the dominant colors (3-5 hex values)?",
          "What color temperature dominates — warm, cool, or neutral?",
          "What is the value range — high contrast or compressed?",
          "Is the palette analogous, complementary, triadic, or something else?",
          "How does saturation vary across the composition?",
        ],
      },
      rhythm: {
        instruction: "Identify rhythmic and pattern qualities.",
        prompts: [
          "Is there a repeating motif or interval?",
          "Is the rhythm regular, progressive, alternating, or irregular?",
          "At how many scales does pattern appear (fractal quality)?",
          "How do density variations create movement?",
          "Where are the moments of rest vs. activity?",
        ],
      },
      mood: {
        instruction: "Identify the emotional and atmospheric qualities.",
        prompts: [
          "What is the overall mood — contemplative, energetic, serene, unsettling?",
          "How do color, light, and space contribute to that mood?",
          "Is there a sense of time — moment, duration, timelessness?",
          "What emotional response does the work invite?",
        ],
      },
      technique: {
        instruction: "Identify technical and material qualities worth studying.",
        prompts: [
          "What medium or technique is used?",
          "How is mark-making contributing to expression?",
          "Are there layering or transparency effects?",
          "What level of control vs. chance is visible?",
          "What technical approach could be translated to generative art?",
        ],
      },
    },
    instructions: [
      "Study the reference image carefully using the framework above.",
      "For each category, answer the prompts and synthesize your observations.",
      "After analysis, use update_reference_analysis to save the structured analysis.",
      "The analysis should inform how you create study sketches inspired by this reference.",
      "Focus on qualities that can be translated to generative art — don't try to replicate literally.",
    ],
  };

  return { metadata, previewJpegBase64 };
}

// ---------------------------------------------------------------------------
// update_reference_analysis (save analysis back to reference)
// ---------------------------------------------------------------------------

export interface UpdateReferenceAnalysisInput {
  referenceId: string;
  seriesId?: string;
  sketchId?: string;
  analysis: ReferenceAnalysis;
}

export async function updateReferenceAnalysis(
  state: EditorState,
  input: UpdateReferenceAnalysisInput,
): Promise<Record<string, unknown>> {
  const ws = state.requireWorkspace();

  const { ref, location } = findReference(
    state, input.referenceId, input.seriesId, input.sketchId,
  );

  const updatedRef: Reference = {
    ...ref,
    analysis: input.analysis,
  };

  let workspaceJson: string | undefined;
  let sketchJson: string | undefined;

  if (location.startsWith("sketch:")) {
    const sketchId = location.replace("sketch:", "");
    const loaded = state.requireSketch(sketchId);
    const updatedDef: SketchDefinition = {
      ...loaded.definition,
      modified: now(),
      references: (loaded.definition.references ?? []).map((r) =>
        r.id === input.referenceId ? updatedRef : r,
      ),
    };
    state.sketches.set(sketchId, {
      definition: updatedDef,
      path: loaded.path,
    });
    sketchJson = serializeGenart(updatedDef);
    if (!state.remoteMode) {
      await writeFile(loaded.path, sketchJson, "utf-8");
    }
    state.emitMutation("sketch:updated", { id: sketchId });
  } else {
    const seriesId = location.replace("series:", "");
    const seriesIndex = ws.series!.findIndex((s) => s.id === seriesId);
    const series = ws.series![seriesIndex]!;
    const updatedSeries: WorkspaceSeries = {
      ...series,
      references: (series.references ?? []).map((r) =>
        r.id === input.referenceId ? updatedRef : r,
      ),
    };
    state.workspace = {
      ...ws,
      modified: now(),
      series: ws.series!.map((s, i) =>
        i === seriesIndex ? updatedSeries : s,
      ),
    };
    workspaceJson = serializeWorkspace(state.workspace);
    if (!state.remoteMode) {
      await writeFile(state.workspacePath!, workspaceJson, "utf-8");
    }
    state.emitMutation("workspace:updated", { referenceAnalyzed: input.referenceId });
  }

  return {
    success: true,
    referenceId: input.referenceId,
    location,
    analysis: input.analysis,
    ...(sketchJson ? { fileContent: sketchJson } : {}),
    ...(workspaceJson ? { workspaceContent: workspaceJson } : {}),
  };
}

// ---------------------------------------------------------------------------
// extract_palette
// ---------------------------------------------------------------------------

export interface ExtractPaletteInput {
  referenceId: string;
  seriesId?: string;
  sketchId?: string;
  count?: number;
}

export interface ExtractPaletteResult {
  metadata: Record<string, unknown>;
  previewJpegBase64?: string;
}

export async function extractPalette(
  state: EditorState,
  input: ExtractPaletteInput,
): Promise<ExtractPaletteResult> {
  state.requireWorkspace();

  const { ref, location } = findReference(
    state, input.referenceId, input.seriesId, input.sketchId,
  );

  const count = input.count ?? 6;

  // Read the image file
  const workspaceDir = dirname(state.workspacePath!);
  const imagePath = resolve(workspaceDir, ref.path);

  let previewJpegBase64: string | undefined;
  try {
    const imageBuffer = await readFile(imagePath);
    previewJpegBase64 = imageBuffer.toString("base64");
  } catch {
    // Image not accessible
  }

  const metadata: Record<string, unknown> = {
    success: true,
    referenceId: ref.id,
    type: ref.type,
    path: ref.path,
    location,
    requestedColors: count,
    existingPalette: ref.analysis?.palette ?? null,
    instructions: [
      `Extract ${count} dominant colors from the reference image as hex values.`,
      "Order them from most dominant to least dominant.",
      "Include both saturated and neutral colors if present in the image.",
      "Consider the role of each color — is it a background, accent, or primary element?",
      "After extraction, use update_reference_analysis to save the palette.",
      "You can also apply the extracted palette to a sketch using set_colors or create a new theme.",
    ],
    extractionGuidelines: {
      dominance: "Prioritize colors by the area they occupy, not just their saturation.",
      variety: "Include the full value range (lights, midtones, darks) if present.",
      harmony: `Look for ${count <= 4 ? "core harmony" : "extended palette including transitional colors"}.`,
      neutrals: "Don't ignore grays, blacks, and whites — they often define the character of a palette.",
    },
  };

  return { metadata, previewJpegBase64 };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Find a reference by ID across series and sketches. */
function findReference(
  state: EditorState,
  referenceId: string,
  seriesId?: string,
  sketchId?: string,
): { ref: Reference; location: string } {
  // Check specific sketch first
  if (sketchId) {
    const loaded = state.requireSketch(sketchId);
    const ref = (loaded.definition.references ?? []).find(
      (r) => r.id === referenceId,
    );
    if (ref) return { ref, location: `sketch:${sketchId}` };
    throw new Error(
      `Reference '${referenceId}' not found on sketch '${sketchId}'`,
    );
  }

  // Check specific series
  if (seriesId) {
    const ws = state.requireWorkspace();
    const series = ws.series?.find((s) => s.id === seriesId);
    if (!series) {
      throw new Error(`Series '${seriesId}' not found in workspace`);
    }
    const ref = (series.references ?? []).find((r) => r.id === referenceId);
    if (ref) return { ref, location: `series:${seriesId}` };
    throw new Error(
      `Reference '${referenceId}' not found on series '${seriesId}'`,
    );
  }

  // Search all series, then all sketches
  const ws = state.requireWorkspace();
  if (ws.series) {
    for (const series of ws.series) {
      const ref = (series.references ?? []).find((r) => r.id === referenceId);
      if (ref) return { ref, location: `series:${series.id}` };
    }
  }

  for (const [id, loaded] of state.sketches) {
    const ref = (loaded.definition.references ?? []).find(
      (r) => r.id === referenceId,
    );
    if (ref) return { ref, location: `sketch:${id}` };
  }

  throw new Error(
    `Reference '${referenceId}' not found in any series or sketch`,
  );
}
