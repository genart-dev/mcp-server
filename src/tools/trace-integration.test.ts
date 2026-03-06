import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { deflateSync } from "zlib";
import {
  createPluginRegistry,
  type PluginRegistry,
  type McpToolContext,
} from "@genart-dev/core";
import tracePlugin from "@genart-dev/plugin-trace";
import { EditorState } from "../state.js";
import { createWorkspace } from "./workspace.js";

/** Minimal valid .genart content. */
function makeSketch(id: string): string {
  return JSON.stringify({
    genart: "1.2",
    id,
    title: "Trace Test Sketch",
    created: "2026-02-24T00:00:00Z",
    modified: "2026-02-24T00:00:00Z",
    renderer: { type: "p5", version: "1.x" },
    canvas: { width: 4, height: 4 },
    parameters: [],
    colors: [],
    state: { seed: 42, params: {}, colorPalette: [] },
    algorithm:
      "function sketch(p, state) { p.setup = () => {}; p.draw = () => {}; return { initializeSystem() {} }; }",
  });
}

/**
 * Create a minimal valid 4×4 RGBA PNG buffer.
 * Uses filter type 0 (none) for each scanline.
 */
function createTestPng(width: number, height: number): Buffer {
  // Build raw pixel data with scanline filter bytes
  const bpp = 4; // RGBA
  const stride = width * bpp;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const offset = y * (stride + 1) + 1 + x * bpp;
      // Create a gradient pattern so edge detection has something to find
      const v = Math.floor(((x + y) / (width + height - 2)) * 255);
      raw[offset] = v;       // R
      raw[offset + 1] = v;   // G
      raw[offset + 2] = v;   // B
      raw[offset + 3] = 255; // A
    }
  }

  const compressed = deflateSync(raw);

  // Build PNG file
  const chunks: Buffer[] = [];

  // Signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  function writeChunk(type: string, data: Buffer): void {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuffer = Buffer.from(type, "ascii");
    const crcInput = Buffer.concat([typeBuffer, data]);
    const crc = crc32(crcInput);
    chunks.push(len, typeBuffer, data, crc);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  writeChunk("IHDR", ihdr);

  // IDAT
  writeChunk("IDAT", compressed);

  // IEND
  writeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat(chunks);
}

/** CRC-32 for PNG chunks. */
function crc32(buf: Buffer): Buffer {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  const result = Buffer.alloc(4);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0);
  return result;
}

/**
 * Patch an McpToolContext so captureComposite returns a test PNG
 * instead of throwing in headless mode.
 */
function patchContextWithTestImage(
  context: McpToolContext,
  pngBuffer: Buffer,
): McpToolContext {
  return {
    ...context,
    async captureComposite(_format?: "png" | "jpeg"): Promise<Buffer> {
      return pngBuffer;
    },
  };
}

describe("plugin-trace integration", () => {
  let tmpDir: string;
  let state: EditorState;
  let registry: PluginRegistry;
  let testPng: Buffer;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-trace-"));
    state = new EditorState();
    testPng = createTestPng(4, 4);

    registry = createPluginRegistry({
      surface: "mcp",
      supportsInteractiveTools: false,
      supportsRendering: false,
    });

    await registry.register(tracePlugin);
    state.pluginRegistry = registry;

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

  it("registers trace plugin with 7 MCP tools", () => {
    const tools = registry.getMcpTools();
    expect(tools).toHaveLength(7);
    const names = tools.map((t) => t.name);
    expect(names).toContain("design_trace_edges");
    expect(names).toContain("design_trace_lines");
    expect(names).toContain("design_trace_contours");
    expect(names).toContain("design_trace_regions");
    expect(names).toContain("design_trace_values");
    expect(names).toContain("design_trace_shapes");
    expect(names).toContain("design_trace_to_layers");
  });

  it("registers trace:reference layer type", () => {
    const lt = registry.resolveLayerType("trace:reference");
    expect(lt).not.toBeNull();
    expect(lt!.category).toBe("image");
  });

  // -----------------------------------------------------------------------
  // trace_edges — end-to-end
  // -----------------------------------------------------------------------

  it("trace_edges detects edges and creates a trace:reference layer", async () => {
    const tools = registry.getMcpTools();
    const edgeTool = tools.find((t) => t.name === "design_trace_edges");
    expect(edgeTool).toBeDefined();

    const baseContext = state.createMcpToolContext("test-sketch");
    const context = patchContextWithTestImage(baseContext, testPng);

    const result = await edgeTool!.definition.handler({}, context);

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Edge detection complete");
    expect(text).toContain("4×4");

    // Verify layer was created
    const layers = context.layers.getAll();
    expect(layers).toHaveLength(1);
    expect(layers[0]!.type).toBe("trace:reference");
    expect(layers[0]!.name).toBe("Edge Trace");
    expect(layers[0]!.properties.traceType).toBe("edges");
  });

  // -----------------------------------------------------------------------
  // trace_to_layers — end-to-end
  // -----------------------------------------------------------------------

  it("trace_to_layers creates multiple trace layers", async () => {
    const tools = registry.getMcpTools();
    const multiTool = tools.find((t) => t.name === "design_trace_to_layers");
    expect(multiTool).toBeDefined();

    const baseContext = state.createMcpToolContext("test-sketch");
    const context = patchContextWithTestImage(baseContext, testPng);

    const result = await multiTool!.definition.handler(
      { types: ["edges", "values"] },
      context,
    );

    expect(result.isError).toBeFalsy();
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("trace layers");

    // Verify multiple layers created
    const layers = context.layers.getAll();
    expect(layers.length).toBeGreaterThanOrEqual(2);
    const types = layers.map((l) => l.properties.traceType);
    expect(types).toContain("edges");
    expect(types).toContain("values");
  });

  // -----------------------------------------------------------------------
  // Headless mode (no image data)
  // -----------------------------------------------------------------------

  it("trace_edges returns error when captureComposite throws (headless)", async () => {
    const tools = registry.getMcpTools();
    const edgeTool = tools.find((t) => t.name === "design_trace_edges");
    expect(edgeTool).toBeDefined();

    // Use unpatched context — captureComposite throws
    const context = state.createMcpToolContext("test-sketch");
    await expect(edgeTool!.definition.handler({}, context)).rejects.toThrow(
      "not available in headless MCP mode",
    );
  });

  it("trace_edges with invalid sourceId returns error result", async () => {
    const tools = registry.getMcpTools();
    const edgeTool = tools.find((t) => t.name === "design_trace_edges");
    expect(edgeTool).toBeDefined();

    // resolveAsset returns null → getImageData returns null → error result
    const context = state.createMcpToolContext("test-sketch");
    const result = await edgeTool!.definition.handler(
      { sourceId: "nonexistent" },
      context,
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("No image data");
  });

  // -----------------------------------------------------------------------
  // trace_edges with createLayer: false
  // -----------------------------------------------------------------------

  it("trace_edges with createLayer=false skips layer creation", async () => {
    const tools = registry.getMcpTools();
    const edgeTool = tools.find((t) => t.name === "design_trace_edges");
    expect(edgeTool).toBeDefined();

    const baseContext = state.createMcpToolContext("test-sketch");
    const context = patchContextWithTestImage(baseContext, testPng);

    const result = await edgeTool!.definition.handler(
      { createLayer: false },
      context,
    );

    expect(result.isError).toBeFalsy();
    expect(context.layers.getAll()).toHaveLength(0);
  });
});
