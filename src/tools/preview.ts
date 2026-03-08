/**
 * Preview tool.
 * preview_sketch — generates an interactive HTML preview and opens it in the browser.
 */

import { exec } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { EditorState } from "../state.js";
// @ts-ignore — esbuild text loader
import viewerTemplate from "../assets/viewer.html";
import type { SketchDefinition } from "@genart-dev/format";

/** Open a file in the default browser. */
function openInBrowser(filePath: string): void {
  const cmd =
    process.platform === "darwin" ? "/usr/bin/open" :
    process.platform === "win32" ? "start" :
    "xdg-open";
  console.error(`[preview] opening: ${filePath}`);
  exec(`${cmd} "${filePath}"`, (err, _stdout, stderr) => {
    if (err) {
      console.error(`[preview] open failed: ${err.message}`);
    }
    if (stderr) {
      console.error(`[preview] open stderr: ${stderr}`);
    }
  });
}

// ---------------------------------------------------------------------------
// Viewer HTML generation
// ---------------------------------------------------------------------------

/** Inject sketch JSON into the viewer.html template. */
export function generateViewerHTML(sketch: SketchDefinition): string {
  return viewerTemplate.replace(
    "var __GENART_DATA__ = null;",
    `var __GENART_DATA__ = ${JSON.stringify(sketch)};`,
  );
}

// ---------------------------------------------------------------------------
// preview_sketch
// ---------------------------------------------------------------------------

export interface PreviewSketchInput {
  sketchId: string;
  seed?: number;
  params?: Record<string, number>;
}

export interface PreviewSketchResult {
  metadata: Record<string, unknown>;
}

export async function previewSketch(
  state: EditorState,
  input: PreviewSketchInput,
): Promise<PreviewSketchResult> {
  state.requireWorkspace();

  const loaded = state.requireSketch(input.sketchId);
  let sketch = loaded.definition;

  // Apply optional seed/param overrides without mutation
  if (input.seed !== undefined || input.params !== undefined) {
    const newState = {
      seed: input.seed ?? sketch.state.seed,
      params: input.params
        ? { ...sketch.state.params, ...input.params }
        : sketch.state.params,
      colorPalette: sketch.state.colorPalette,
    };
    sketch = { ...sketch, state: newState };
  }

  const html = generateViewerHTML(sketch);

  // Write to <workspace>/previews/<sketchId>.html
  const workspaceDir = dirname(state.workspacePath!);
  const previewDir = join(workspaceDir, "previews");
  await mkdir(previewDir, { recursive: true });

  const previewPath = join(previewDir, `${sketch.id}.html`);
  await writeFile(previewPath, html, "utf-8");

  // Auto-open in browser (local mode only)
  let opened = false;
  if (!state.remoteMode) {
    openInBrowser(previewPath);
    opened = true;
  }

  return {
    metadata: {
      success: true,
      sketchId: sketch.id,
      path: previewPath,
      opened,
      renderer: sketch.renderer.type,
      seed: sketch.state.seed,
    },
  };
}
