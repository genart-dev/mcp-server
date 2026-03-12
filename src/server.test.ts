/**
 * MCP protocol integration tests.
 * Exercises the full server surface via InMemoryTransport + Client:
 * - Tool/resource/prompt listing
 * - End-to-end workflow: create workspace → create sketch → add → set params → arrange → snapshot
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { createServer } from "./server.js";
import { EditorState } from "./state.js";

/** Helper to create a connected client/server pair. */
async function createTestPair(state?: EditorState) {
  const editorState = state ?? new EditorState();
  const server = createServer(editorState);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  // Wait for plugin registration to complete
  await (server as typeof server & { _pluginsReady?: Promise<void> })
    ._pluginsReady;
  return { client, server, state: editorState };
}

/** Parse JSON text from a tool call result. */
function parseToolResult(result: { content: Array<{ type: string; text?: string }> }): Record<string, unknown> {
  const textContent = result.content.find((c) => c.type === "text");
  if (!textContent || !textContent.text) {
    throw new Error("No text content in tool result");
  }
  return JSON.parse(textContent.text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Capability listing
// ---------------------------------------------------------------------------

describe("MCP server integration", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;

  beforeAll(async () => {
    const pair = await createTestPair();
    client = pair.client;
    server = pair.server;
  });

  afterAll(async () => {
    await server.close();
  });

  describe("capability listing", () => {
    it("lists all registered tools (original + design core + plugins)", async () => {
      const result = await client.listTools();
      expect(result.tools.length).toBe(228);
    });

    it("includes all workspace tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("create_workspace");
      expect(names).toContain("open_workspace");
      expect(names).toContain("add_sketch_to_workspace");
      expect(names).toContain("remove_sketch_from_workspace");
      expect(names).toContain("list_workspace_sketches");
    });

    it("includes all sketch lifecycle tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("create_sketch");
      expect(names).toContain("open_sketch");
      expect(names).toContain("update_sketch");
      expect(names).toContain("update_algorithm");
      expect(names).toContain("save_sketch");
      expect(names).toContain("fork_sketch");
      expect(names).toContain("delete_sketch");
    });

    it("includes all component tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("list_components");
      expect(names).toContain("add_component");
      expect(names).toContain("remove_component");
    });

    it("includes all selection tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("get_selection");
      expect(names).toContain("select_sketch");
      expect(names).toContain("get_editor_state");
    });

    it("includes all parameter tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("set_parameters");
      expect(names).toContain("set_colors");
      expect(names).toContain("set_seed");
      expect(names).toContain("set_canvas_size");
      expect(names).toContain("randomize_parameters");
    });

    it("includes arrangement, gallery, merge, snapshot, capture, export, and knowledge tools", async () => {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain("arrange_sketches");
      expect(names).toContain("auto_arrange");
      expect(names).toContain("group_sketches");
      expect(names).toContain("list_sketches");
      expect(names).toContain("search_sketches");
      expect(names).toContain("merge_sketches");
      expect(names).toContain("snapshot_layout");
      expect(names).toContain("capture_screenshot");
      expect(names).toContain("capture_batch");
      expect(names).toContain("export_sketch");
      expect(names).toContain("list_skills");
      expect(names).toContain("load_skill");
      expect(names).toContain("get_guidelines");
    });

    it("every tool has a description and inputSchema", async () => {
      const result = await client.listTools();
      for (const tool of result.tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeTruthy();
      }
    });

    it("lists all 4 resources", async () => {
      const result = await client.listResources();
      expect(result.resources.length).toBe(4);
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain("genart://skills");
      expect(uris).toContain("genart://presets/canvas");
      expect(uris).toContain("genart://gallery");
      expect(uris).toContain("genart://renderers");
    });

    it("lists all 6 prompts", async () => {
      const result = await client.listPrompts();
      expect(result.prompts.length).toBe(6);
      const names = result.prompts.map((p) => p.name);
      expect(names).toContain("create-generative-art");
      expect(names).toContain("explore-variations");
      expect(names).toContain("apply-design-theory");
      expect(names).toContain("critique-and-iterate");
      expect(names).toContain("develop-artistic-concept");
      expect(names).toContain("study-reference");
    });
  });
});

// ---------------------------------------------------------------------------
// End-to-end workflow
// ---------------------------------------------------------------------------

describe("end-to-end workflow", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let state: EditorState;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "genart-e2e-"));
    const pair = await createTestPair();
    client = pair.client;
    server = pair.server;
    state = pair.state;
  });

  afterEach(async () => {
    await server.close();
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("create workspace → create sketch → add to workspace → set params → arrange → snapshot", async () => {
    // 1. Create a workspace
    const wsPath = join(tmpDir, "test.genart-workspace");
    const wsResult = parseToolResult(
      await client.callTool({
        name: "create_workspace",
        arguments: { title: "Integration Test", path: wsPath },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(wsResult.success).toBe(true);
    expect(wsResult.title).toBe("Integration Test");
    expect(wsResult.sketchCount).toBe(0);

    // 2. Create a sketch
    const sketchPath = join(tmpDir, "my-sketch.genart");
    const sketchResult = parseToolResult(
      await client.callTool({
        name: "create_sketch",
        arguments: {
          id: "my-sketch",
          title: "My Sketch",
          path: sketchPath,
          renderer: "p5",
          canvas: { width: 800, height: 600 },
          parameters: [
            { key: "density", label: "Density", min: 1, max: 100, step: 1, default: 50 },
            { key: "speed", label: "Speed", min: 0.1, max: 5.0, step: 0.1, default: 1.0 },
          ],
          colors: [
            { key: "bg", label: "Background", default: "#000000" },
            { key: "fg", label: "Foreground", default: "#ffffff" },
          ],
        },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(sketchResult.success).toBe(true);
    expect(sketchResult.id).toBe("my-sketch");

    // 3. Add sketch to workspace
    const addResult = parseToolResult(
      await client.callTool({
        name: "add_sketch_to_workspace",
        arguments: {
          sketchPath,
          position: { x: 100, y: 200 },
        },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(addResult.success).toBe(true);

    // 4. Create a second sketch and add to workspace
    const sketch2Path = join(tmpDir, "second-sketch.genart");
    await client.callTool({
      name: "create_sketch",
      arguments: {
        id: "second-sketch",
        title: "Second Sketch",
        path: sketch2Path,
        renderer: "canvas2d",
        canvas: { width: 1200, height: 1200 },
        parameters: [
          { key: "count", label: "Count", min: 1, max: 50, step: 1, default: 10 },
        ],
        colors: [{ key: "primary", label: "Primary", default: "#ff0000" }],
      },
    });
    await client.callTool({
      name: "add_sketch_to_workspace",
      arguments: { sketchPath: sketch2Path },
    });

    // 5. Create a third sketch and add to workspace
    const sketch3Path = join(tmpDir, "third-sketch.genart");
    await client.callTool({
      name: "create_sketch",
      arguments: {
        id: "third-sketch",
        title: "Third Sketch",
        path: sketch3Path,
        renderer: "p5",
      },
    });
    await client.callTool({
      name: "add_sketch_to_workspace",
      arguments: { sketchPath: sketch3Path },
    });

    // Verify workspace has 3 sketches
    const listResult = parseToolResult(
      await client.callTool({
        name: "list_workspace_sketches",
        arguments: {},
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(listResult.sketchCount).toBe(3);

    // 6. Set parameters on first sketch
    const paramResult = parseToolResult(
      await client.callTool({
        name: "set_parameters",
        arguments: {
          sketchId: "my-sketch",
          params: { density: 75, speed: 2.5 },
        },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(paramResult.success).toBe(true);

    // 7. Set colors on first sketch
    const colorResult = parseToolResult(
      await client.callTool({
        name: "set_colors",
        arguments: {
          sketchId: "my-sketch",
          colors: { bg: "#1a1a2e", fg: "#e94560" },
        },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(colorResult.success).toBe(true);

    // 8. Set seed on first sketch
    const seedResult = parseToolResult(
      await client.callTool({
        name: "set_seed",
        arguments: { sketchId: "my-sketch", seed: 12345 },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(seedResult.success).toBe(true);

    // 9. Auto-arrange all sketches in a grid
    const arrangeResult = parseToolResult(
      await client.callTool({
        name: "auto_arrange",
        arguments: {
          layout: "grid",
          spacing: 100,
          origin: { x: 0, y: 0 },
        },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(arrangeResult.success).toBe(true);
    expect(arrangeResult.arranged).toBe(3);

    // 10. Snapshot layout
    const snapshotResult = parseToolResult(
      await client.callTool({
        name: "snapshot_layout",
        arguments: { includeGroups: true, includeState: true },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    const wsInfo = snapshotResult.workspace as Record<string, unknown>;
    expect(wsInfo.title).toBe("Integration Test");
    expect((snapshotResult.sketches as unknown[]).length).toBe(3);
    expect(snapshotResult.totalSketches).toBe(3);

    // Verify the snapshot includes the first sketch with updated params
    const sketches = snapshotResult.sketches as Array<Record<string, unknown>>;
    const mySketch = sketches.find((s) => s.id === "my-sketch");
    expect(mySketch).toBeDefined();
    expect(mySketch!.renderer).toBe("p5");
  });

  it("select sketch → get selection returns full context", async () => {
    // Create and load a sketch directly into state
    const sketchPath = join(tmpDir, "sel-test.genart");
    const wsPath = join(tmpDir, "sel.genart-workspace");

    await client.callTool({
      name: "create_workspace",
      arguments: { title: "Selection Test", path: wsPath },
    });

    await client.callTool({
      name: "create_sketch",
      arguments: {
        id: "sel-test",
        title: "Selection Test Sketch",
        path: sketchPath,
        philosophy: "A test of selection context",
        parameters: [
          { key: "x", label: "X", min: 0, max: 100, step: 1, default: 50 },
        ],
      },
    });

    await client.callTool({
      name: "add_sketch_to_workspace",
      arguments: { sketchPath },
    });

    // Select the sketch
    const selectResult = parseToolResult(
      await client.callTool({
        name: "select_sketch",
        arguments: { sketchIds: ["sel-test"] },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(selectResult.success).toBe(true);
    expect(selectResult.selectionCount).toBe(1);

    // Get selection context
    const selectionResult = parseToolResult(
      await client.callTool({
        name: "get_selection",
        arguments: { includeAlgorithm: true, includePhilosophy: true },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    const selected = (selectionResult.selected as Array<Record<string, unknown>>)[0];
    expect(selected.id).toBe("sel-test");
    expect(selected.title).toBe("Selection Test Sketch");
    expect(selected.philosophy).toContain("selection context");
    expect(selected.algorithm).toBeTruthy();
  });

  it("get_editor_state reflects current server state", async () => {
    const wsPath = join(tmpDir, "state.genart-workspace");
    await client.callTool({
      name: "create_workspace",
      arguments: { title: "State Test", path: wsPath },
    });

    const result = parseToolResult(
      await client.callTool({
        name: "get_editor_state",
        arguments: {},
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(result.hasWorkspace).toBe(true);
    const ws = result.workspace as Record<string, unknown>;
    expect(ws.title).toBe("State Test");
    expect(ws.sketchCount).toBe(0);
    expect((result.selection as unknown[]).length).toBe(0);
  });

  it("search_sketches filters by renderer", async () => {
    const wsPath = join(tmpDir, "search.genart-workspace");
    await client.callTool({
      name: "create_workspace",
      arguments: { title: "Search Test", path: wsPath },
    });

    // Create p5 sketch
    const p5Path = join(tmpDir, "p5-sketch.genart");
    await client.callTool({
      name: "create_sketch",
      arguments: {
        id: "p5-sketch",
        title: "P5 Sketch",
        path: p5Path,
        renderer: "p5",
      },
    });
    await client.callTool({
      name: "add_sketch_to_workspace",
      arguments: { sketchPath: p5Path },
    });

    // Create canvas2d sketch
    const c2dPath = join(tmpDir, "c2d-sketch.genart");
    await client.callTool({
      name: "create_sketch",
      arguments: {
        id: "c2d-sketch",
        title: "Canvas2D Sketch",
        path: c2dPath,
        renderer: "canvas2d",
      },
    });
    await client.callTool({
      name: "add_sketch_to_workspace",
      arguments: { sketchPath: c2dPath },
    });

    // Search for p5 only
    const searchResult = parseToolResult(
      await client.callTool({
        name: "search_sketches",
        arguments: { renderer: "p5" },
      }) as { content: Array<{ type: string; text?: string }> },
    );
    expect(searchResult.total).toBe(1);
    const matches = searchResult.matches as Array<Record<string, unknown>>;
    expect(matches[0].id).toBe("p5-sketch");
  });
});
