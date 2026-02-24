import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
  createPluginRegistry,
  type PluginRegistry,
  type PrefixedMcpTool,
} from "@genart-dev/core";
import typographyPlugin from "@genart-dev/plugin-typography";
import filtersPlugin from "@genart-dev/plugin-filters";
import shapesPlugin from "@genart-dev/plugin-shapes";
import layoutGuidesPlugin from "@genart-dev/plugin-layout-guides";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";

/** Minimal valid .genart content. */
function makeSketch(id: string): string {
  return JSON.stringify({
    genart: "1.2",
    id,
    title: "Test Sketch",
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

describe("plugin registration", () => {
  let tmpDir: string;
  let state: EditorState;
  let registry: PluginRegistry;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-plugins-"));
    state = new EditorState();

    registry = createPluginRegistry({
      surface: "mcp",
      supportsInteractiveTools: false,
      supportsRendering: false,
    });

    await registry.register(typographyPlugin);
    await registry.register(filtersPlugin);
    await registry.register(shapesPlugin);
    await registry.register(layoutGuidesPlugin);
    state.pluginRegistry = registry;

    // Create workspace with sketch
    const sketchPath = join(tmpDir, "test-sketch.genart");
    await writeFile(sketchPath, makeSketch("test-sketch"));
    await createWorkspace(state, {
      title: "Test",
      path: join(tmpDir, "test.genart-workspace"),
      sketches: [sketchPath],
    });
    state.setSelection(["test-sketch"]);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // Plugin registration
  // -----------------------------------------------------------------------

  it("registers all 4 free plugins", () => {
    const plugins = registry.getAll();
    expect(plugins).toHaveLength(4);
    const ids = plugins.map((p) => p.id);
    expect(ids).toContain("typography");
    expect(ids).toContain("filters");
    expect(ids).toContain("shapes");
    expect(ids).toContain("layout-guides");
  });

  it("rejects duplicate plugin registration", async () => {
    await expect(registry.register(typographyPlugin)).rejects.toThrow(
      "already registered",
    );
  });

  // -----------------------------------------------------------------------
  // MCP tool prefixing
  // -----------------------------------------------------------------------

  describe("MCP tool prefixing", () => {
    it("all MCP tools are prefixed with design_", () => {
      const tools = registry.getMcpTools();
      for (const tool of tools) {
        expect(tool.name).toMatch(/^design_/);
      }
    });

    it("produces 19 MCP tools total", () => {
      const tools = registry.getMcpTools();
      expect(tools).toHaveLength(19);
    });

    it("includes all typography tools", () => {
      const tools = registry.getMcpTools();
      const typoTools = tools.filter((t) => t.pluginId === "typography");
      expect(typoTools).toHaveLength(4);
      const names = typoTools.map((t) => t.name);
      expect(names).toContain("design_set_text");
      expect(names).toContain("design_apply_text_style");
      expect(names).toContain("design_list_fonts");
      expect(names).toContain("design_set_text_shadow");
    });

    it("includes all filter tools", () => {
      const tools = registry.getMcpTools();
      const filterTools = tools.filter((t) => t.pluginId === "filters");
      expect(filterTools).toHaveLength(6);
      const names = filterTools.map((t) => t.name);
      expect(names).toContain("design_apply_grain");
      expect(names).toContain("design_apply_vignette");
      expect(names).toContain("design_apply_duotone");
      expect(names).toContain("design_apply_blur");
      expect(names).toContain("design_apply_chromatic_aberration");
      expect(names).toContain("design_list_filters");
    });

    it("includes all shape tools", () => {
      const tools = registry.getMcpTools();
      const shapeTools = tools.filter((t) => t.pluginId === "shapes");
      expect(shapeTools).toHaveLength(5);
      const names = shapeTools.map((t) => t.name);
      expect(names).toContain("design_add_shape");
      expect(names).toContain("design_set_shape_style");
      expect(names).toContain("design_set_polygon");
      expect(names).toContain("design_add_line");
      expect(names).toContain("design_list_shapes");
    });

    it("includes all guide tools", () => {
      const tools = registry.getMcpTools();
      const guideTools = tools.filter((t) => t.pluginId === "layout-guides");
      expect(guideTools).toHaveLength(4);
      const names = guideTools.map((t) => t.name);
      expect(names).toContain("design_add_guide");
      expect(names).toContain("design_add_custom_guide");
      expect(names).toContain("design_toggle_guides");
      expect(names).toContain("design_clear_guides");
    });
  });

  // -----------------------------------------------------------------------
  // Layer type resolution
  // -----------------------------------------------------------------------

  describe("layer type resolution", () => {
    it("resolves all 16 layer types", () => {
      const types = registry.getLayerTypes();
      expect(types).toHaveLength(16);
    });

    it("resolves typography:text", () => {
      const lt = registry.resolveLayerType("typography:text");
      expect(lt).not.toBeNull();
      expect(lt!.displayName).toBe("Text");
      expect(lt!.category).toBe("text");
    });

    it("resolves filter:grain", () => {
      const lt = registry.resolveLayerType("filter:grain");
      expect(lt).not.toBeNull();
      expect(lt!.category).toBe("filter");
    });

    it("resolves shapes:rect", () => {
      const lt = registry.resolveLayerType("shapes:rect");
      expect(lt).not.toBeNull();
      expect(lt!.category).toBe("shape");
    });

    it("resolves guides:thirds", () => {
      const lt = registry.resolveLayerType("guides:thirds");
      expect(lt).not.toBeNull();
      expect(lt!.category).toBe("guide");
    });

    it("returns null for unknown type", () => {
      expect(registry.resolveLayerType("unknown:foo")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Plugin tool execution via McpToolContext
  // -----------------------------------------------------------------------

  describe("plugin tool execution", () => {
    it("set_text tool creates a text layer via context", async () => {
      const tools = registry.getMcpTools();
      const setTextTool = tools.find((t) => t.name === "design_set_text");
      expect(setTextTool).toBeDefined();

      const context = state.createMcpToolContext("test-sketch");
      const result = await setTextTool!.definition.handler(
        { text: "Hello from test" },
        context,
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.type).toBe("text");
      expect((result.content[0] as { text: string }).text).toContain("Created text layer");

      // Verify layer was added to the stack
      const layers = context.layers.getAll();
      expect(layers).toHaveLength(1);
      expect(layers[0]!.type).toBe("typography:text");
      expect(layers[0]!.properties.text).toBe("Hello from test");
    });

    it("apply_grain tool creates a grain layer", async () => {
      const tools = registry.getMcpTools();
      const grainTool = tools.find((t) => t.name === "design_apply_grain");
      expect(grainTool).toBeDefined();

      const context = state.createMcpToolContext("test-sketch");
      const result = await grainTool!.definition.handler(
        { intensity: 0.6 },
        context,
      );

      expect(result.isError).toBeFalsy();
      const layers = context.layers.getAll();
      expect(layers).toHaveLength(1);
      expect(layers[0]!.type).toBe("filter:grain");
    });

    it("add_shape tool creates a shape layer", async () => {
      const tools = registry.getMcpTools();
      const shapeTool = tools.find((t) => t.name === "design_add_shape");
      expect(shapeTool).toBeDefined();

      const context = state.createMcpToolContext("test-sketch");
      const result = await shapeTool!.definition.handler(
        { shape: "ellipse", fillColor: "#ff0000" },
        context,
      );

      expect(result.isError).toBeFalsy();
      const layers = context.layers.getAll();
      expect(layers).toHaveLength(1);
      expect(layers[0]!.type).toBe("shapes:ellipse");
    });

    it("add_guide tool creates a guide layer", async () => {
      const tools = registry.getMcpTools();
      const guideTool = tools.find((t) => t.name === "design_add_guide");
      expect(guideTool).toBeDefined();

      const context = state.createMcpToolContext("test-sketch");
      const result = await guideTool!.definition.handler(
        { type: "thirds" },
        context,
      );

      expect(result.isError).toBeFalsy();
      const layers = context.layers.getAll();
      expect(layers).toHaveLength(1);
      expect(layers[0]!.type).toBe("guides:thirds");
    });
  });

  // -----------------------------------------------------------------------
  // McpToolContext properties
  // -----------------------------------------------------------------------

  describe("McpToolContext", () => {
    it("provides canvas dimensions from sketch", () => {
      const context = state.createMcpToolContext("test-sketch");
      expect(context.canvasWidth).toBe(800);
      expect(context.canvasHeight).toBe(600);
    });

    it("provides sketch state accessor", () => {
      const context = state.createMcpToolContext("test-sketch");
      expect(context.sketchState.seed).toBe(42);
      expect(context.sketchState.canvasWidth).toBe(800);
      expect(context.sketchState.canvasHeight).toBe(600);
      expect(context.sketchState.rendererId).toBe("p5");
    });

    it("resolveAsset returns null (no assets in headless)", async () => {
      const context = state.createMcpToolContext("test-sketch");
      const result = await context.resolveAsset("some-asset");
      expect(result).toBeNull();
    });

    it("captureComposite throws in headless mode", async () => {
      const context = state.createMcpToolContext("test-sketch");
      await expect(context.captureComposite()).rejects.toThrow(
        "not available in headless MCP mode",
      );
    });
  });
});
