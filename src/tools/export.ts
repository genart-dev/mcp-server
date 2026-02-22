/**
 * Export tool.
 * export_sketch — exports a sketch as html, png, algorithm, or zip.
 */

import { createWriteStream } from "fs";
import { stat, writeFile } from "fs/promises";
import { dirname, extname } from "path";
import archiver from "archiver";
import {
  createDefaultRegistry,
  serializeGenart,
  type SketchDefinition,
} from "@genart-dev/core";
import { EditorState } from "../state.js";
import { captureHtml } from "../capture/headless.js";

const registry = createDefaultRegistry();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Verify the parent directory exists and the output path doesn't already exist. */
async function validateOutputPath(outputPath: string): Promise<void> {
  const parentDir = dirname(outputPath);
  try {
    const s = await stat(parentDir);
    if (!s.isDirectory()) {
      throw new Error(`Parent directory does not exist: ${parentDir}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Parent directory")) throw e;
    throw new Error(`Parent directory does not exist: ${parentDir}`);
  }

  try {
    await stat(outputPath);
    // If stat succeeds, file exists
    throw new Error(
      `File already exists at ${outputPath}. Delete it first or use a different path.`,
    );
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("File already exists")) throw e;
    // ENOENT is expected — file doesn't exist yet
  }
}

/** Get the algorithm file extension based on renderer type. */
function algorithmExtension(rendererType: string): string {
  return rendererType === "glsl" ? ".glsl" : ".js";
}

/** Build a sketch copy with optional overrides (no mutation). */
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

// ---------------------------------------------------------------------------
// export_sketch
// ---------------------------------------------------------------------------

export interface ExportSketchInput {
  sketchId: string;
  format: "html" | "png" | "svg" | "algorithm" | "zip";
  outputPath: string;
  width?: number;
  height?: number;
  seed?: number;
  params?: Record<string, number>;
}

export async function exportSketch(
  state: EditorState,
  input: ExportSketchInput,
): Promise<Record<string, unknown>> {
  state.requireWorkspace();

  const loaded = state.requireSketch(input.sketchId);
  const sketch = applyOverrides(loaded.definition, {
    seed: input.seed,
    params: input.params,
  });

  await validateOutputPath(input.outputPath);

  const adapter = registry.resolve(sketch.renderer.type);
  if (!adapter) {
    throw new Error(
      `Unsupported renderer type: '${sketch.renderer.type}'`,
    );
  }

  switch (input.format) {
    case "html":
      return await exportHtml(sketch, input.outputPath);

    case "png":
      return await exportPng(sketch, input);

    case "svg":
      return await exportSvg(sketch, input);

    case "algorithm":
      return await exportAlgorithm(sketch, input.outputPath);

    case "zip":
      return await exportZip(sketch, input);

    default:
      throw new Error(`Unsupported export format: '${input.format}'`);
  }
}

// ---------------------------------------------------------------------------
// Format exporters
// ---------------------------------------------------------------------------

async function exportHtml(
  sketch: SketchDefinition,
  outputPath: string,
): Promise<Record<string, unknown>> {
  const adapter = registry.resolve(sketch.renderer.type)!;
  const html = adapter.generateStandaloneHTML(sketch);
  const content = Buffer.from(html, "utf-8");
  await writeFile(outputPath, content);

  return {
    success: true,
    sketchId: sketch.id,
    format: "html",
    outputPath,
    fileSize: content.byteLength,
    renderer: sketch.renderer.type,
  };
}

async function exportPng(
  sketch: SketchDefinition,
  input: ExportSketchInput,
): Promise<Record<string, unknown>> {
  const adapter = registry.resolve(sketch.renderer.type)!;
  const html = adapter.generateStandaloneHTML(sketch);
  const width = input.width ?? sketch.canvas.width;
  const height = input.height ?? sketch.canvas.height;

  const result = await captureHtml({ html, width, height });
  await writeFile(input.outputPath, result.bytes);

  return {
    success: true,
    sketchId: sketch.id,
    format: "png",
    outputPath: input.outputPath,
    fileSize: result.bytes.byteLength,
    renderer: sketch.renderer.type,
  };
}

async function exportSvg(
  sketch: SketchDefinition,
  input: ExportSketchInput,
): Promise<Record<string, unknown>> {
  const width = input.width ?? sketch.canvas.width;
  const height = input.height ?? sketch.canvas.height;

  if (sketch.renderer.type === "svg") {
    // For SVG renderer, use the algorithm as raw SVG output
    const content = Buffer.from(sketch.algorithm, "utf-8");
    await writeFile(input.outputPath, content);

    return {
      success: true,
      sketchId: sketch.id,
      format: "svg",
      outputPath: input.outputPath,
      fileSize: content.byteLength,
      renderer: sketch.renderer.type,
      notice: null,
    };
  }

  // For non-SVG renderers, rasterize to PNG and embed in SVG container
  const adapter = registry.resolve(sketch.renderer.type)!;
  const html = adapter.generateStandaloneHTML(sketch);
  const result = await captureHtml({ html, width, height });
  const b64 = Buffer.from(result.bytes).toString("base64");

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <image width="${width}" height="${height}"
         href="data:image/png;base64,${b64}"/>
</svg>`;

  const content = Buffer.from(svg, "utf-8");
  await writeFile(input.outputPath, content);

  return {
    success: true,
    sketchId: sketch.id,
    format: "svg",
    outputPath: input.outputPath,
    fileSize: content.byteLength,
    renderer: sketch.renderer.type,
    notice: "Non-SVG renderer — rasterized PNG embedded in SVG container",
  };
}

async function exportAlgorithm(
  sketch: SketchDefinition,
  outputPath: string,
): Promise<Record<string, unknown>> {
  const content = Buffer.from(sketch.algorithm, "utf-8");
  await writeFile(outputPath, content);

  return {
    success: true,
    sketchId: sketch.id,
    format: "algorithm",
    outputPath,
    fileSize: content.byteLength,
    renderer: sketch.renderer.type,
  };
}

async function exportZip(
  sketch: SketchDefinition,
  input: ExportSketchInput,
): Promise<Record<string, unknown>> {
  const adapter = registry.resolve(sketch.renderer.type)!;
  const width = input.width ?? sketch.canvas.width;
  const height = input.height ?? sketch.canvas.height;

  // Generate all artifacts
  const html = adapter.generateStandaloneHTML(sketch);
  const genartJson = serializeGenart(sketch);
  const algorithm = sketch.algorithm;
  const algExt = algorithmExtension(sketch.renderer.type);

  // Capture PNG
  const captureResult = await captureHtml({ html, width, height });

  // Write zip
  const output = createWriteStream(input.outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  const finished = new Promise<void>((resolve, reject) => {
    output.on("close", resolve);
    archive.on("error", reject);
  });

  archive.pipe(output);
  archive.append(html, { name: `${sketch.id}.html` });
  archive.append(Buffer.from(captureResult.bytes), { name: `${sketch.id}.png` });
  archive.append(algorithm, { name: `${sketch.id}${algExt}` });
  archive.append(genartJson, { name: `${sketch.id}.genart` });
  await archive.finalize();
  await finished;

  // Get final file size
  const s = await stat(input.outputPath);

  return {
    success: true,
    sketchId: sketch.id,
    format: "zip",
    outputPath: input.outputPath,
    fileSize: s.size,
    renderer: sketch.renderer.type,
    contents: [
      `${sketch.id}.html`,
      `${sketch.id}.png`,
      `${sketch.id}${algExt}`,
      `${sketch.id}.genart`,
    ],
  };
}
