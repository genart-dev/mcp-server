import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../server.js";
import { EditorState } from "../state.js";
import type { SketchDefinition } from "@genart-dev/core";

/** Helper to create a connected client/server pair. */
async function createTestPair(state?: EditorState) {
  const editorState = state ?? new EditorState();
  const server = createServer(editorState);
  const client = new Client({ name: "test-client", version: "0.0.1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return { client, server, state: editorState };
}

describe("MCP resources", () => {
  let client: Client;
  let server: ReturnType<typeof createServer>;
  let state: EditorState;

  beforeAll(async () => {
    const pair = await createTestPair();
    client = pair.client;
    server = pair.server;
    state = pair.state;
  });

  afterAll(async () => {
    await server.close();
  });

  describe("listResources", () => {
    it("lists all 4 registered resources", async () => {
      const result = await client.listResources();
      const uris = result.resources.map((r) => r.uri);
      expect(uris).toContain("genart://skills");
      expect(uris).toContain("genart://presets/canvas");
      expect(uris).toContain("genart://gallery");
      expect(uris).toContain("genart://renderers");
      expect(result.resources.length).toBe(4);
    });

    it("includes descriptions for all resources", async () => {
      const result = await client.listResources();
      for (const resource of result.resources) {
        expect(resource.description).toBeTruthy();
      }
    });
  });

  describe("genart://skills", () => {
    it("returns all design knowledge skills", async () => {
      const result = await client.readResource({ uri: "genart://skills" });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].uri).toBe("genart://skills");
      expect(result.contents[0].mimeType).toBe("application/json");
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.skills).toBeInstanceOf(Array);
      expect(data.total).toBe(24);
      expect(data.categories).toEqual(["color", "composition", "illustration", "painting", "process"]);
      // Each skill has required summary fields
      for (const skill of data.skills) {
        expect(skill.id).toBeTruthy();
        expect(skill.name).toBeTruthy();
        expect(skill.category).toBeTruthy();
      }
    });
  });

  describe("genart://presets/canvas", () => {
    it("returns all canvas presets", async () => {
      const result = await client.readResource({ uri: "genart://presets/canvas" });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0].mimeType).toBe("application/json");
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.presets).toBeInstanceOf(Array);
      expect(data.presets.length).toBeGreaterThanOrEqual(17);
    });

    it("each preset has id, label, category, width, height", async () => {
      const result = await client.readResource({ uri: "genart://presets/canvas" });
      const data = JSON.parse(result.contents[0].text as string);
      for (const preset of data.presets) {
        expect(preset).toHaveProperty("id");
        expect(preset).toHaveProperty("label");
        expect(preset).toHaveProperty("category");
        expect(preset).toHaveProperty("width");
        expect(preset).toHaveProperty("height");
        expect(typeof preset.width).toBe("number");
        expect(typeof preset.height).toBe("number");
      }
    });

    it("includes known presets", async () => {
      const result = await client.readResource({ uri: "genart://presets/canvas" });
      const data = JSON.parse(result.contents[0].text as string);
      const ids = data.presets.map((p: { id: string }) => p.id);
      expect(ids).toContain("square-1200");
      expect(ids).toContain("hd-1920x1080");
      expect(ids).toContain("instagram-1080x1080");
    });

    it("presets have valid categories", async () => {
      const result = await client.readResource({ uri: "genart://presets/canvas" });
      const data = JSON.parse(result.contents[0].text as string);
      const validCategories = ["square", "landscape", "portrait", "print", "social"];
      for (const preset of data.presets) {
        expect(validCategories).toContain(preset.category);
      }
    });
  });

  describe("genart://gallery", () => {
    it("returns empty gallery when no workspace is open", async () => {
      const result = await client.readResource({ uri: "genart://gallery" });
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.workspacePath).toBeNull();
      expect(data.sketchCount).toBe(0);
      expect(data.sketches).toEqual([]);
    });

    it("returns loaded sketches with metadata", async () => {
      // Add a sketch to state
      const mockSketch: SketchDefinition = {
        genart: "1.0",
        id: "test-sketch",
        title: "Test Sketch",
        created: "2026-01-01T00:00:00Z",
        modified: "2026-01-01T00:00:00Z",
        renderer: { type: "p5" },
        canvas: { width: 1200, height: 1200 },
        algorithm: "function setup() {}",
        state: { seed: 42, params: {}, colorPalette: [] },
        parameters: [
          { key: "size", label: "Size", min: 1, max: 100, step: 1, default: 50 },
        ],
        colors: [{ key: "bg", label: "Background", default: "#000000" }],
      };
      state.sketches.set("test-sketch", {
        definition: mockSketch,
        path: "/tmp/test-sketch.genart",
      });

      const result = await client.readResource({ uri: "genart://gallery" });
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.sketchCount).toBe(1);
      expect(data.sketches).toHaveLength(1);
      expect(data.sketches[0].id).toBe("test-sketch");
      expect(data.sketches[0].title).toBe("Test Sketch");
      expect(data.sketches[0].renderer).toEqual({ type: "p5" });
      expect(data.sketches[0].parameterCount).toBe(1);
      expect(data.sketches[0].colorCount).toBe(1);
      expect(data.sketches[0].seed).toBe(42);
      expect(data.sketches[0].hasPhilosophy).toBe(false);

      // Clean up
      state.sketches.delete("test-sketch");
    });

    it("reflects workspace path when set", async () => {
      state.workspacePath = "/tmp/test.genart-workspace";
      const result = await client.readResource({ uri: "genart://gallery" });
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.workspacePath).toBe("/tmp/test.genart-workspace");
      state.workspacePath = null;
    });
  });

  describe("genart://renderers", () => {
    it("returns all 6 renderer types", async () => {
      const result = await client.readResource({ uri: "genart://renderers" });
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.renderers).toHaveLength(6);
      const types = data.renderers.map((r: { type: string }) => r.type);
      expect(types).toContain("p5");
      expect(types).toContain("canvas2d");
      expect(types).toContain("three");
      expect(types).toContain("glsl");
      expect(types).toContain("svg");
      expect(types).toContain("genart");
    });

    it("identifies p5 as default renderer", async () => {
      const result = await client.readResource({ uri: "genart://renderers" });
      const data = JSON.parse(result.contents[0].text as string);
      expect(data.defaultRenderer).toBe("p5");
    });

    it("each renderer has displayName, algorithmLanguage, dependencies", async () => {
      const result = await client.readResource({ uri: "genart://renderers" });
      const data = JSON.parse(result.contents[0].text as string);
      for (const renderer of data.renderers) {
        expect(renderer).toHaveProperty("type");
        expect(renderer).toHaveProperty("displayName");
        expect(renderer).toHaveProperty("algorithmLanguage");
        expect(renderer).toHaveProperty("dependencies");
        expect(renderer.dependencies).toBeInstanceOf(Array);
      }
    });

    it("p5 renderer has correct algorithm language", async () => {
      const result = await client.readResource({ uri: "genart://renderers" });
      const data = JSON.parse(result.contents[0].text as string);
      const p5 = data.renderers.find((r: { type: string }) => r.type === "p5");
      expect(p5.algorithmLanguage).toBe("javascript");
      expect(p5.dependencies.length).toBeGreaterThan(0);
    });

    it("renderer dependencies have name, version, cdnUrl", async () => {
      const result = await client.readResource({ uri: "genart://renderers" });
      const data = JSON.parse(result.contents[0].text as string);
      for (const renderer of data.renderers) {
        for (const dep of renderer.dependencies) {
          expect(dep).toHaveProperty("name");
          expect(dep).toHaveProperty("version");
          expect(dep).toHaveProperty("cdnUrl");
        }
      }
    });
  });
});
