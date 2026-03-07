/**
 * Preview tool.
 * preview_sketch — generates an interactive HTML preview and opens it in the browser.
 */

import { exec } from "child_process";
import { mkdir, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { createDefaultRegistry } from "@genart-dev/core";
import { EditorState } from "../state.js";

const registry = createDefaultRegistry();

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
// preview_sketch
// ---------------------------------------------------------------------------

export interface PreviewSketchInput {
  sketchId: string;
  seed?: number;
  params?: Record<string, number>;
}

export interface PreviewSketchResult {
  metadata: Record<string, unknown>;
  html: string;
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

  const adapter = registry.resolve(sketch.renderer.type);
  if (!adapter) {
    throw new Error(`Unsupported renderer type: '${sketch.renderer.type}'`);
  }

  const html = adapter.generateInteractiveHTML(sketch);

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
    html,
  };
}
