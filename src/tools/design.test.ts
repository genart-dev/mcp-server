import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createPluginRegistry } from "@genart-dev/core";
import typographyPlugin from "@genart-dev/plugin-typography";
import filtersPlugin from "@genart-dev/plugin-filters";
import shapesPlugin from "@genart-dev/plugin-shapes";
import layoutGuidesPlugin from "@genart-dev/plugin-layout-guides";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";
import {
  designAddLayer,
  designRemoveLayer,
  designListLayers,
  designGetLayer,
  designUpdateLayer,
  designSetTransform,
  designSetBlend,
  designReorderLayers,
  designDuplicateLayer,
  designToggleVisibility,
  designLockLayer,
  designCaptureComposite,
} from "./design.js";

/** Minimal valid .genart content. */
function makeSketch(id: string, title: string): string {
  return JSON.stringify({
    genart: "1.2",
    id,
    title,
    created: "2026-02-24T00:00:00Z",
    modified: "2026-02-24T00:00:00Z",
    renderer: { type: "p5", version: "1.x" },
    canvas: { width: 800, height: 600 },
    parameters: [],
    colors: [],
    state: { seed: 42, params: {}, colorPalette: [] },
    algorithm: "function sketch(p, state) { p.setup = () => {}; p.draw = () => {}; return { initializeSystem() {} }; }",
  });
}

/** Set up a workspace with one sketch and return helpers. */
async function setup(): Promise<{
  tmpDir: string;
  state: EditorState;
  sketchId: string;
}> {
  const tmpDir = await mkdtemp(join(tmpdir(), "genart-design-"));
  const state = new EditorState();

  // Initialize plugin registry
  const registry = createPluginRegistry({
    surface: "mcp",
    supportsInteractiveTools: false,
    supportsRendering: false,
  });
  await registry.register(typographyPlugin);
  await registry.register(filtersPlugin);
  await registry.register(shapesPlugin);
  await registry.register(layoutGuidesPlugin);
  state.pluginRegistry = registry;

  // Create workspace with a sketch
  const sketchPath = join(tmpDir, "test-sketch.genart");
  await writeFile(sketchPath, makeSketch("test-sketch", "Test Sketch"));

  await createWorkspace(state, {
    title: "Test Workspace",
    path: join(tmpDir, "test.genart-workspace"),
    sketches: [sketchPath],
  });

  // Select the sketch
  state.setSelection(["test-sketch"]);

  return { tmpDir, state, sketchId: "test-sketch" };
}

describe("core design layer tools", () => {
  let tmpDir: string;
  let state: EditorState;
  let sketchId: string;

  beforeEach(async () => {
    ({ tmpDir, state, sketchId } = await setup());
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // design_add_layer
  // -----------------------------------------------------------------------

  describe("design_add_layer", () => {
    it("adds a text layer with defaults", async () => {
      const result = await designAddLayer(state, {
        sketchId,
        type: "typography:text",
      });

      expect(result.layerId).toBeTruthy();
      expect(result.type).toBe("typography:text");
      expect(result.name).toBe("Text");
      expect(result.sketchId).toBe(sketchId);
    });

    it("adds a layer with custom properties", async () => {
      const result = await designAddLayer(state, {
        sketchId,
        type: "typography:text",
        name: "My Title",
        properties: { text: "Hello", fontSize: 72, color: "#ff0000" },
        opacity: 0.8,
        blendMode: "multiply",
      });

      expect(result.name).toBe("My Title");

      // Verify layer details
      const details = await designGetLayer(state, {
        sketchId,
        layerId: result.layerId as string,
      });
      const layer = details.layer as Record<string, unknown>;
      expect(layer.opacity).toBe(0.8);
      expect(layer.blendMode).toBe("multiply");
      const props = layer.properties as Record<string, unknown>;
      expect(props.text).toBe("Hello");
      expect(props.fontSize).toBe(72);
    });

    it("adds a filter layer", async () => {
      const result = await designAddLayer(state, {
        sketchId,
        type: "filter:grain",
        properties: { intensity: 0.3 },
      });

      expect(result.type).toBe("filter:grain");
    });

    it("adds a shape layer", async () => {
      const result = await designAddLayer(state, {
        sketchId,
        type: "shapes:rect",
        properties: { fillColor: "#0066cc" },
      });

      expect(result.type).toBe("shapes:rect");
    });

    it("adds a guide layer", async () => {
      const result = await designAddLayer(state, {
        sketchId,
        type: "guides:thirds",
      });

      expect(result.type).toBe("guides:thirds");
    });

    it("throws for unknown layer type", async () => {
      await expect(
        designAddLayer(state, { sketchId, type: "nonexistent:foo" }),
      ).rejects.toThrow("Unknown layer type");
    });

    it("uses selected sketch when sketchId is omitted", async () => {
      const result = await designAddLayer(state, {
        type: "typography:text",
      });

      expect(result.sketchId).toBe(sketchId);
    });

    it("persists to disk after adding", async () => {
      await designAddLayer(state, {
        sketchId,
        type: "filter:vignette",
      });

      // Read the file back
      const loaded = state.requireSketch(sketchId);
      const raw = await readFile(loaded.path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.layers).toBeDefined();
      expect(parsed.layers).toHaveLength(1);
      expect(parsed.layers[0].type).toBe("filter:vignette");
    });
  });

  // -----------------------------------------------------------------------
  // design_remove_layer
  // -----------------------------------------------------------------------

  describe("design_remove_layer", () => {
    it("removes an existing layer", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "typography:text",
      });

      const result = await designRemoveLayer(state, {
        sketchId,
        layerId: added.layerId as string,
      });

      expect(result.removed).toBe(true);

      const list = await designListLayers(state, { sketchId });
      expect(list.count).toBe(0);
    });

    it("throws for non-existent layer", async () => {
      await expect(
        designRemoveLayer(state, { sketchId, layerId: "nope" }),
      ).rejects.toThrow("not found");
    });
  });

  // -----------------------------------------------------------------------
  // design_list_layers
  // -----------------------------------------------------------------------

  describe("design_list_layers", () => {
    it("returns empty list for sketch with no layers", async () => {
      const result = await designListLayers(state, { sketchId });
      expect(result.count).toBe(0);
      expect(result.layers).toEqual([]);
    });

    it("lists multiple layers in order", async () => {
      await designAddLayer(state, { sketchId, type: "typography:text", name: "Title" });
      await designAddLayer(state, { sketchId, type: "filter:grain", name: "Grain" });
      await designAddLayer(state, { sketchId, type: "shapes:ellipse", name: "Circle" });

      const result = await designListLayers(state, { sketchId });
      expect(result.count).toBe(3);
      const layers = result.layers as Array<{ name: string; index: number }>;
      expect(layers[0]!.name).toBe("Title");
      expect(layers[0]!.index).toBe(0);
      expect(layers[1]!.name).toBe("Grain");
      expect(layers[2]!.name).toBe("Circle");
    });
  });

  // -----------------------------------------------------------------------
  // design_get_layer
  // -----------------------------------------------------------------------

  describe("design_get_layer", () => {
    it("returns full layer details", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "typography:text",
        properties: { text: "Hello World" },
      });

      const result = await designGetLayer(state, {
        sketchId,
        layerId: added.layerId as string,
      });

      const layer = result.layer as Record<string, unknown>;
      expect(layer.type).toBe("typography:text");
      expect(layer.transform).toBeDefined();
      expect(layer.properties).toBeDefined();
      expect((layer.properties as Record<string, unknown>).text).toBe("Hello World");
    });
  });

  // -----------------------------------------------------------------------
  // design_update_layer
  // -----------------------------------------------------------------------

  describe("design_update_layer", () => {
    it("updates layer properties", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "filter:grain",
      });

      await designUpdateLayer(state, {
        sketchId,
        layerId: added.layerId as string,
        properties: { intensity: 0.7, size: 3 },
      });

      const details = await designGetLayer(state, {
        sketchId,
        layerId: added.layerId as string,
      });
      const props = (details.layer as Record<string, unknown>)
        .properties as Record<string, unknown>;
      expect(props.intensity).toBe(0.7);
      expect(props.size).toBe(3);
    });

    it("updates layer name", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "typography:text",
        name: "Original",
      });

      await designUpdateLayer(state, {
        sketchId,
        layerId: added.layerId as string,
        name: "Renamed",
      });

      const details = await designGetLayer(state, {
        sketchId,
        layerId: added.layerId as string,
      });
      expect((details.layer as Record<string, unknown>).name).toBe("Renamed");
    });
  });

  // -----------------------------------------------------------------------
  // design_set_transform
  // -----------------------------------------------------------------------

  describe("design_set_transform", () => {
    it("updates position and size", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "shapes:rect",
      });

      const result = await designSetTransform(state, {
        sketchId,
        layerId: added.layerId as string,
        x: 100,
        y: 200,
        width: 300,
        height: 400,
        rotation: 45,
      });

      expect(result.updated).toBe(true);
      const transform = result.transform as Record<string, number>;
      expect(transform.x).toBe(100);
      expect(transform.y).toBe(200);
      expect(transform.width).toBe(300);
      expect(transform.height).toBe(400);
      expect(transform.rotation).toBe(45);
    });
  });

  // -----------------------------------------------------------------------
  // design_set_blend
  // -----------------------------------------------------------------------

  describe("design_set_blend", () => {
    it("sets blend mode and opacity", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "filter:grain",
      });

      const result = await designSetBlend(state, {
        sketchId,
        layerId: added.layerId as string,
        blendMode: "multiply",
        opacity: 0.5,
      });

      expect(result.blendMode).toBe("multiply");
      expect(result.opacity).toBe(0.5);
    });

    it("rejects invalid blend mode", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "filter:grain",
      });

      await expect(
        designSetBlend(state, {
          sketchId,
          layerId: added.layerId as string,
          blendMode: "invalid-mode",
        }),
      ).rejects.toThrow("Invalid blend mode");
    });
  });

  // -----------------------------------------------------------------------
  // design_reorder_layers
  // -----------------------------------------------------------------------

  describe("design_reorder_layers", () => {
    it("moves a layer to a new position", async () => {
      const first = await designAddLayer(state, { sketchId, type: "typography:text", name: "A" });
      await designAddLayer(state, { sketchId, type: "filter:grain", name: "B" });
      await designAddLayer(state, { sketchId, type: "shapes:rect", name: "C" });

      // Move first layer to end
      await designReorderLayers(state, {
        sketchId,
        layerId: first.layerId as string,
        newIndex: 2,
      });

      const list = await designListLayers(state, { sketchId });
      const layers = list.layers as Array<{ name: string }>;
      expect(layers[0]!.name).toBe("B");
      expect(layers[1]!.name).toBe("C");
      expect(layers[2]!.name).toBe("A");
    });
  });

  // -----------------------------------------------------------------------
  // design_duplicate_layer
  // -----------------------------------------------------------------------

  describe("design_duplicate_layer", () => {
    it("clones a layer with new ID", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "filter:grain",
        properties: { intensity: 0.5 },
      });

      const result = await designDuplicateLayer(state, {
        sketchId,
        layerId: added.layerId as string,
      });

      expect(result.duplicated).toBe(true);
      expect(result.newLayerId).not.toBe(added.layerId);
      expect(result.sourceLayerId).toBe(added.layerId);

      // Verify duplicate exists with same properties
      const list = await designListLayers(state, { sketchId });
      expect(list.count).toBe(2);

      const clone = await designGetLayer(state, {
        sketchId,
        layerId: result.newLayerId as string,
      });
      const props = (clone.layer as Record<string, unknown>)
        .properties as Record<string, unknown>;
      expect(props.intensity).toBe(0.5);
    });
  });

  // -----------------------------------------------------------------------
  // design_toggle_visibility
  // -----------------------------------------------------------------------

  describe("design_toggle_visibility", () => {
    it("toggles visibility", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "typography:text",
      });

      // Initially visible
      let details = await designGetLayer(state, { sketchId, layerId: added.layerId as string });
      expect((details.layer as Record<string, unknown>).visible).toBe(true);

      // Toggle off
      const result = await designToggleVisibility(state, {
        sketchId,
        layerId: added.layerId as string,
      });
      expect(result.visible).toBe(false);

      // Toggle back on
      const result2 = await designToggleVisibility(state, {
        sketchId,
        layerId: added.layerId as string,
      });
      expect(result2.visible).toBe(true);
    });

    it("sets explicit visibility", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "typography:text",
      });

      const result = await designToggleVisibility(state, {
        sketchId,
        layerId: added.layerId as string,
        visible: false,
      });
      expect(result.visible).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // design_lock_layer
  // -----------------------------------------------------------------------

  describe("design_lock_layer", () => {
    it("toggles lock state", async () => {
      const added = await designAddLayer(state, {
        sketchId,
        type: "shapes:rect",
      });

      // Initially unlocked
      let result = await designLockLayer(state, {
        sketchId,
        layerId: added.layerId as string,
      });
      expect(result.locked).toBe(true);

      // Toggle back
      result = await designLockLayer(state, {
        sketchId,
        layerId: added.layerId as string,
      });
      expect(result.locked).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // design_capture_composite
  // -----------------------------------------------------------------------

  describe("design_capture_composite", () => {
    it("returns layer count info", async () => {
      await designAddLayer(state, { sketchId, type: "typography:text" });
      await designAddLayer(state, { sketchId, type: "filter:grain" });

      const result = await designCaptureComposite(state, { sketchId });
      expect(result.layerCount).toBe(2);
      expect(result.visibleCount).toBe(2);
    });
  });

  // -----------------------------------------------------------------------
  // Round-trip persistence
  // -----------------------------------------------------------------------

  describe("round-trip persistence", () => {
    it("layers survive save → reload", async () => {
      await designAddLayer(state, {
        sketchId,
        type: "typography:text",
        name: "Title",
        properties: { text: "Hello" },
      });
      await designAddLayer(state, {
        sketchId,
        type: "filter:grain",
        properties: { intensity: 0.4 },
      });

      // Read from disk and verify
      const loaded = state.requireSketch(sketchId);
      const raw = await readFile(loaded.path, "utf-8");
      const parsed = JSON.parse(raw);
      expect(parsed.layers).toHaveLength(2);
      expect(parsed.layers[0].type).toBe("typography:text");
      expect(parsed.layers[0].name).toBe("Title");
      expect(parsed.layers[0].properties.text).toBe("Hello");
      expect(parsed.layers[1].type).toBe("filter:grain");
      expect(parsed.layers[1].properties.intensity).toBe(0.4);
    });
  });
});
