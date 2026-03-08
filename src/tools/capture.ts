/**
 * Capture tools.
 * capture_screenshot, capture_batch
 *
 * Two-tier capture: each capture produces a full-res PNG for the preview file
 * and a small JPEG for inline AI viewing via MCP native image blocks.
 */

import { exec } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import {
  createDefaultRegistry,
  type SketchDefinition,
} from "@genart-dev/core";
import { EditorState } from "../state.js";
import { captureHtmlMulti, type MultiCaptureResult } from "../capture/headless.js";

const registry = createDefaultRegistry();

/** Open a file in the system viewer (macOS: Preview.app, Linux: xdg-open, Windows: start). */
function openPreview(filePath: string): void {
  const cmd =
    process.platform === "darwin" ? "/usr/bin/open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  console.error(`[openPreview] opening: ${filePath}`);
  exec(`${cmd} "${filePath}"`, (err, _stdout, stderr) => {
    if (err) {
      console.error(`[openPreview] exec error: ${err.message}`);
    }
    if (stderr) {
      console.error(`[openPreview] stderr: ${stderr}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a SketchDefinition copy with optional seed/param overrides (no mutation). */
function applyOverrides(
  sketch: SketchDefinition,
  overrides: { seed?: number; params?: Record<string, number> },
): SketchDefinition {
  if (overrides.seed === undefined && overrides.params === undefined) {
    return sketch;
  }

  const newState = {
    seed: overrides.seed ?? sketch.state.seed,
    params: overrides.params
      ? { ...sketch.state.params, ...overrides.params }
      : sketch.state.params,
    colorPalette: sketch.state.colorPalette,
  };

  return { ...sketch, state: newState };
}

/** Generate standalone HTML for a sketch with optional overrides. */
function generateSketchHtml(
  sketch: SketchDefinition,
  opts: { seed?: number; params?: Record<string, number> },
): string {
  const effective = applyOverrides(sketch, opts);
  const adapter = registry.resolve(effective.renderer.type);
  if (!adapter) {
    throw new Error(
      `Unsupported renderer type: '${effective.renderer.type}'`,
    );
  }
  return adapter.generateStandaloneHTML(effective);
}

/** Derive the snapshot PNG path: <workspace-dir>/snapshots/<sketchId>-<seed>-preview.png */
function deriveSnapshotPath(
  sketchPath: string,
  sketchId: string,
  seed: number,
): string {
  const wsDir = dirname(sketchPath);
  return join(wsDir, "snapshots", `${sketchId}-${seed}-preview.png`);
}

// ---------------------------------------------------------------------------
// capture_screenshot
// ---------------------------------------------------------------------------

export interface CaptureScreenshotInput {
  target?: "selected" | "sketch";
  sketchId?: string;
  width?: number;
  height?: number;
  seed?: number;
  params?: Record<string, number>;
  previewSize?: number;
}

/** Structured result from captureScreenshot. */
export interface CaptureScreenshotResult {
  /** JSON-safe metadata for the text content block. */
  metadata: Record<string, unknown>;
  /** Small JPEG as base64 string for the MCP image content block. */
  previewJpegBase64: string;
}

export async function captureScreenshot(
  state: EditorState,
  input: CaptureScreenshotInput,
): Promise<CaptureScreenshotResult> {
  state.requireWorkspace();

  const target = input.target ?? "selected";

  let sketchId: string;

  if (target === "selected") {
    if (state.selection.size === 0) {
      throw new Error("No sketch is currently selected");
    }
    sketchId = [...state.selection][0]!;
  } else {
    if (!input.sketchId) {
      throw new Error("sketchId is required when target is 'sketch'");
    }
    sketchId = input.sketchId;
  }

  const loaded = state.requireSketch(sketchId);
  const sketch = loaded.definition;

  try {
    const html = generateSketchHtml(sketch, {
      seed: input.seed,
      params: input.params,
    });
    const width = input.width ?? sketch.canvas.width;
    const height = input.height ?? sketch.canvas.height;
    const inlineSize = input.previewSize ?? 400;

    const multi = await captureHtmlMulti({
      html,
      width,
      height,
      inlineSize,
    });

    // Auto-save preview PNG and build metadata
    const effectiveSeed = input.seed ?? sketch.state.seed;
    const previewPath = deriveSnapshotPath(loaded.path, sketchId, effectiveSeed);
    const metadata = await buildScreenshotMetadata(state, multi, {
      target,
      sketchId,
      seed: effectiveSeed,
      previewPath,
    });

    const previewJpegBase64 = Buffer.from(multi.inlineJpeg).toString("base64");

    return { metadata, previewJpegBase64 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Renderer error for '${sketchId}': ${msg}`);
  }
}

/** Build metadata object and handle file writing / remoteMode content. */
async function buildScreenshotMetadata(
  state: EditorState,
  multi: MultiCaptureResult,
  info: {
    target: string;
    sketchId: string;
    seed: number;
    previewPath: string;
    /** Auto-open the preview in the system image viewer (default: true in local mode). */
    autoOpen?: boolean;
  },
): Promise<Record<string, unknown>> {
  const metadata: Record<string, unknown> = {
    success: true,
    target: info.target,
    sketchId: info.sketchId,
    width: multi.previewWidth,
    height: multi.previewHeight,
    seed: info.seed,
    previewPath: info.previewPath,
  };

  if (!state.remoteMode) {
    // Local mode: ensure snapshots/ directory exists, then write preview PNG
    await mkdir(dirname(info.previewPath), { recursive: true });
    await writeFile(info.previewPath, multi.previewPng);
    metadata.savedPreviewTo = info.previewPath;
    metadata.previewWritten = true;
    // Auto-open in system viewer so the user sees the render immediately
    if (info.autoOpen !== false) {
      openPreview(info.previewPath);
    }
  }
  // Remote mode: skip preview file — the inline JPEG image block is sufficient
  // for AI analysis, and shuttling a full PNG as base64 text wastes tokens.

  return metadata;
}

// ---------------------------------------------------------------------------
// capture_batch
// ---------------------------------------------------------------------------

export interface CaptureBatchInput {
  sketchIds?: string[];
  width?: number;
  height?: number;
  seed?: number;
  previewSize?: number;
}

/** Structured result for a single sketch in a batch capture. */
export interface BatchItemResult {
  metadata: Record<string, unknown>;
  inlineJpegBase64: string;
}

export interface CaptureBatchResult {
  /** JSON-safe batch metadata for the text content block. */
  metadata: Record<string, unknown>;
  /** Per-sketch inline JPEG base64 strings for MCP image content blocks. */
  items: BatchItemResult[];
}

export async function captureBatch(
  state: EditorState,
  input: CaptureBatchInput,
): Promise<CaptureBatchResult> {
  state.requireWorkspace();

  const ids = input.sketchIds ?? [...state.sketches.keys()];
  if (ids.length === 0) {
    throw new Error("No sketches to capture");
  }

  // Validate all sketch IDs exist before starting
  for (const id of ids) {
    state.requireSketch(id);
  }

  // Use smaller inline size for batches to keep total response manageable
  const inlineSize = input.previewSize ?? 200;

  const items: BatchItemResult[] = [];
  const errors: Record<string, unknown>[] = [];

  const promises = ids.map(async (id) => {
    const loaded = state.requireSketch(id);
    const sketch = loaded.definition;
    try {
      const html = generateSketchHtml(sketch, { seed: input.seed });
      const width = input.width ?? sketch.canvas.width;
      const height = input.height ?? sketch.canvas.height;

      const multi = await captureHtmlMulti({
        html,
        width,
        height,
        inlineSize,
      });

      const effectiveSeed = input.seed ?? sketch.state.seed;
      const previewPath = deriveSnapshotPath(loaded.path, id, effectiveSeed);
      const itemMetadata = await buildScreenshotMetadata(state, multi, {
        target: "sketch",
        sketchId: id,
        seed: effectiveSeed,
        previewPath,
        autoOpen: false, // Don't flood windows for batch captures
      });

      items.push({
        metadata: itemMetadata,
        inlineJpegBase64: Buffer.from(multi.inlineJpeg).toString("base64"),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ sketchId: id, error: msg });
    }
  });

  await Promise.all(promises);

  return {
    metadata: {
      success: errors.length === 0,
      total: ids.length,
      captured: items.length,
      failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    },
    items,
  };
}
