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

describe("MCP prompts", () => {
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

  describe("listPrompts", () => {
    it("lists all 4 registered prompts", async () => {
      const result = await client.listPrompts();
      const names = result.prompts.map((p) => p.name);
      expect(names).toContain("create-generative-art");
      expect(names).toContain("explore-variations");
      expect(names).toContain("apply-design-theory");
      expect(names).toContain("critique-and-iterate");
      expect(result.prompts.length).toBe(4);
    });

    it("includes descriptions for all prompts", async () => {
      const result = await client.listPrompts();
      for (const prompt of result.prompts) {
        expect(prompt.description).toBeTruthy();
      }
    });
  });

  describe("create-generative-art", () => {
    it("returns structured prompt with concept", async () => {
      const result = await client.getPrompt({
        name: "create-generative-art",
        arguments: { concept: "flowing particles in a magnetic field" },
      });
      expect(result.messages).toHaveLength(1);
      expect(result.messages[0].role).toBe("user");
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("flowing particles in a magnetic field");
      expect(text).toContain("create_sketch");
      expect(text).toContain("capture_screenshot");
    });

    it("uses default renderer and complexity", async () => {
      const result = await client.getPrompt({
        name: "create-generative-art",
        arguments: { concept: "test" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("**Renderer:** p5");
      expect(text).toContain("**Complexity:** moderate");
      expect(text).toContain("**Canvas:** square-1200");
    });

    it("respects renderer override", async () => {
      const result = await client.getPrompt({
        name: "create-generative-art",
        arguments: { concept: "3D terrain", renderer: "three" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("**Renderer:** three");
    });

    it("includes simple complexity instructions", async () => {
      const result = await client.getPrompt({
        name: "create-generative-art",
        arguments: { concept: "test", complexity: "simple" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("under 50 lines");
      expect(text).toContain("2–3 parameters");
    });

    it("includes complex complexity instructions", async () => {
      const result = await client.getPrompt({
        name: "create-generative-art",
        arguments: { concept: "test", complexity: "complex" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("5+ parameters");
    });

    it("respects canvas override", async () => {
      const result = await client.getPrompt({
        name: "create-generative-art",
        arguments: { concept: "test", canvas: "hd-1920x1080" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("**Canvas:** hd-1920x1080");
    });
  });

  describe("explore-variations", () => {
    it("returns prompt with sketch context when loaded", async () => {
      const mockSketch: SketchDefinition = {
        id: "var-test",
        title: "Variation Test",
        format: "genart/1.0",
        renderer: "p5",
        canvas: { width: 1200, height: 1200 },
        algorithm: "function setup() {}",
        seed: 42,
        parameters: [
          { key: "density", label: "Density", min: 1, max: 100, step: 1, default: 50 },
        ],
        colors: [{ key: "primary", label: "Primary", default: "#FF0000" }],
      };
      state.sketches.set("var-test", {
        definition: mockSketch,
        path: "/tmp/var-test.genart",
      });

      const result = await client.getPrompt({
        name: "explore-variations",
        arguments: { sketchId: "var-test" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Variation Test");
      expect(text).toContain("density");
      expect(text).toContain("primary");
      expect(text).toContain("1200×1200");

      state.sketches.delete("var-test");
    });

    it("handles missing sketch gracefully", async () => {
      const result = await client.getPrompt({
        name: "explore-variations",
        arguments: { sketchId: "nonexistent" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("nonexistent");
      expect(text).toContain("Not currently loaded");
    });

    it("uses combined strategy by default", async () => {
      const result = await client.getPrompt({
        name: "explore-variations",
        arguments: { sketchId: "x" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Combined Exploration");
    });

    it("supports seeds strategy", async () => {
      const result = await client.getPrompt({
        name: "explore-variations",
        arguments: { sketchId: "x", strategy: "seeds" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Seed Exploration");
      expect(text).toContain("fork_sketch");
    });

    it("supports params strategy", async () => {
      const result = await client.getPrompt({
        name: "explore-variations",
        arguments: { sketchId: "x", strategy: "params" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Parameter Exploration");
      expect(text).toContain("set_parameters");
    });

    it("supports extremes strategy", async () => {
      const result = await client.getPrompt({
        name: "explore-variations",
        arguments: { sketchId: "x", strategy: "extremes" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Extreme Parameter Exploration");
    });

    it("respects count argument", async () => {
      const result = await client.getPrompt({
        name: "explore-variations",
        arguments: { sketchId: "x", count: "12" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("12");
    });

    it("includes post-exploration instructions", async () => {
      const result = await client.getPrompt({
        name: "explore-variations",
        arguments: { sketchId: "x" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("auto_arrange");
      expect(text).toContain("snapshot_layout");
    });
  });

  describe("apply-design-theory", () => {
    it("returns prompt with sketch context when loaded", async () => {
      const mockSketch: SketchDefinition = {
        id: "theory-test",
        title: "Theory Test",
        format: "genart/1.0",
        renderer: "canvas2d",
        canvas: { width: 800, height: 600 },
        algorithm: "// test",
        seed: 99,
        philosophy: "Testing design theory application",
      };
      state.sketches.set("theory-test", {
        definition: mockSketch,
        path: "/tmp/theory-test.genart",
      });

      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "theory-test", theory: "gestalt" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Theory Test");
      expect(text).toContain("canvas2d");
      expect(text).toContain("Testing design theory application");

      state.sketches.delete("theory-test");
    });

    it("handles missing sketch gracefully", async () => {
      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "missing", theory: "composition" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("missing");
      expect(text).toContain("Not currently loaded");
    });

    it("includes gestalt principles", async () => {
      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "x", theory: "gestalt" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Gestalt Principles");
      expect(text).toContain("Proximity");
      expect(text).toContain("Similarity");
      expect(text).toContain("Closure");
    });

    it("includes color theory guidance", async () => {
      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "x", theory: "color-theory" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Color Theory");
      expect(text).toContain("Complementary");
      expect(text).toContain("Analogous");
    });

    it("includes composition guidance", async () => {
      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "x", theory: "composition" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Composition");
      expect(text).toContain("Rule of thirds");
      expect(text).toContain("Golden ratio");
    });

    it("includes rhythm-repetition guidance", async () => {
      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "x", theory: "rhythm-repetition" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Rhythm & Repetition");
      expect(text).toContain("Regular rhythm");
      expect(text).toContain("Fractal");
    });

    it("includes negative-space guidance", async () => {
      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "x", theory: "negative-space" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Negative Space");
      expect(text).toContain("Active negative space");
    });

    it("includes contrast guidance", async () => {
      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "x", theory: "contrast" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("Contrast");
      expect(text).toContain("Size contrast");
      expect(text).toContain("Shape contrast");
    });

    it("includes workflow steps", async () => {
      const result = await client.getPrompt({
        name: "apply-design-theory",
        arguments: { sketchId: "x", theory: "gestalt" },
      });
      const text = (result.messages[0].content as { type: string; text: string }).text;
      expect(text).toContain("fork_sketch");
      expect(text).toContain("capture_screenshot");
      expect(text).toContain("philosophy");
    });
  });
});
