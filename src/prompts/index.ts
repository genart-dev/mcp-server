/**
 * MCP prompt registration.
 * Prompts are structured prompt templates exposed to AI clients.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { EditorState } from "../state.js";

/** Register all MCP prompts on the server. */
export function registerPrompts(
  server: McpServer,
  state: EditorState,
): void {
  registerCreateGenerativeArt(server);
  registerExploreVariations(server, state);
  registerApplyDesignTheory(server, state);
}

// ---------------------------------------------------------------------------
// create-generative-art — structured prompt for creating new generative art
// ---------------------------------------------------------------------------

function registerCreateGenerativeArt(server: McpServer): void {
  server.prompt(
    "create-generative-art",
    "Create a new piece of generative art with structured guidance",
    {
      concept: z
        .string()
        .describe("The artistic concept or visual idea to explore"),
      renderer: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Renderer to use (default: p5)"),
      complexity: z
        .enum(["simple", "moderate", "complex"])
        .optional()
        .describe("Desired complexity level (default: moderate)"),
      canvas: z
        .string()
        .optional()
        .describe("Canvas preset name or WxH dimensions (default: square-1200)"),
    },
    async (args) => {
      const renderer = args.renderer ?? "p5";
      const complexity = args.complexity ?? "moderate";
      const canvas = args.canvas ?? "square-1200";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Create a generative art sketch with the following specifications:`,
                ``,
                `## Concept`,
                `${args.concept}`,
                ``,
                `## Technical Specifications`,
                `- **Renderer:** ${renderer}`,
                `- **Complexity:** ${complexity}`,
                `- **Canvas:** ${canvas}`,
                ``,
                `## Steps`,
                `1. Use \`create_sketch\` to create a new .genart file with a relative path (e.g. \`my-sketch.genart\`)`,
                `2. Design 3–6 parameters that control visual variation (range sliders)`,
                `3. Define 2–4 color parameters for palette control`,
                `4. Write the algorithm that implements the concept`,
                `5. Use \`update_algorithm\` to set the algorithm with validation`,
                `6. Use \`capture_screenshot\` to verify the visual output`,
                `7. Iterate on parameters and algorithm until the result matches the concept`,
                ``,
                `## Guidelines`,
                `- Parameters should have meaningful ranges that produce visually distinct results`,
                `- The algorithm should be deterministic given the same seed and parameters`,
                `- Include a philosophy field describing the artistic intent`,
                `- Use design principles: balance, contrast, rhythm, harmony`,
                `- Always pass your \`agent\` name and \`model\` identifier when calling tools that create or modify sketches`,
                complexity === "simple"
                  ? `- Keep the algorithm under 50 lines with 2–3 parameters`
                  : complexity === "complex"
                    ? `- The algorithm can be extensive; use 5+ parameters and consider animation`
                    : `- Aim for 30–80 lines with 3–5 parameters`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// explore-variations — explore parameter/seed variations of an existing sketch
// ---------------------------------------------------------------------------

function registerExploreVariations(
  server: McpServer,
  state: EditorState,
): void {
  server.prompt(
    "explore-variations",
    "Explore parameter and seed variations of an existing sketch",
    {
      sketchId: z
        .string()
        .describe("ID of the sketch to explore variations of"),
      strategy: z
        .enum(["seeds", "params", "both", "extremes"])
        .optional()
        .describe("Variation strategy (default: both)"),
      count: z
        .string()
        .optional()
        .describe("Number of variations to explore (default: 6)"),
    },
    async (args) => {
      const strategy = args.strategy ?? "both";
      const count = args.count ?? "6";
      const sketch = state.getSketch(args.sketchId);

      let sketchContext = "";
      if (sketch) {
        const def = sketch.definition;
        const params = def.parameters
          ?.map(
            (p) =>
              `  - ${p.key} (${p.label}): ${p.min}–${p.max}, step ${p.step}, default ${p.default}`,
          )
          .join("\n");
        const colors = def.colors
          ?.map((c) => `  - ${c.key} (${c.label}): ${c.default}`)
          .join("\n");

        sketchContext = [
          `## Current Sketch: "${def.title}"`,
          `- **ID:** ${def.id}`,
          `- **Renderer:** ${def.renderer}`,
          `- **Canvas:** ${def.canvas.width}×${def.canvas.height}`,
          `- **Seed:** ${def.seed}`,
          params ? `- **Parameters:**\n${params}` : `- **Parameters:** none`,
          colors ? `- **Colors:**\n${colors}` : `- **Colors:** none`,
        ].join("\n");
      } else {
        sketchContext = `## Sketch: ${args.sketchId}\n*(Not currently loaded — use open_sketch or get_selection to load it first)*`;
      }

      const strategyInstructions: Record<string, string> = {
        seeds: [
          `## Strategy: Seed Exploration`,
          `Generate ${count} variations by changing only the seed value.`,
          `1. Use \`fork_sketch\` to create each variation with \`newSeed: true\``,
          `2. Use \`capture_batch\` to capture all variations`,
          `3. Compare the results and identify which seeds produce the most interesting outputs`,
        ].join("\n"),
        params: [
          `## Strategy: Parameter Exploration`,
          `Generate ${count} variations by systematically varying parameters.`,
          `1. Use \`fork_sketch\` for each variation`,
          `2. For each fork, use \`set_parameters\` to explore different regions of the parameter space`,
          `3. Try: minimum values, maximum values, center values, and random combinations`,
          `4. Use \`capture_batch\` to capture all variations`,
        ].join("\n"),
        both: [
          `## Strategy: Combined Exploration`,
          `Generate ${count} variations by varying both seeds and parameters.`,
          `1. Create ${count} forks with \`fork_sketch\` (newSeed: true)`,
          `2. For half the forks, also adjust parameters to explore different visual territories`,
          `3. Use \`capture_batch\` to capture all variations`,
          `4. Identify the most visually interesting combinations`,
        ].join("\n"),
        extremes: [
          `## Strategy: Extreme Parameter Exploration`,
          `Generate ${count} variations by pushing parameters to their limits.`,
          `1. Create forks with all parameters at minimum, all at maximum, and diagonal extremes`,
          `2. Also create forks with each parameter individually at its min and max`,
          `3. Use \`capture_batch\` to capture all variations`,
          `4. This reveals the full range of the parameter space`,
        ].join("\n"),
      };

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Explore variations of an existing generative art sketch.`,
                ``,
                sketchContext,
                ``,
                strategyInstructions[strategy],
                ``,
                `## After Exploration`,
                `- Use \`auto_arrange\` to lay out all variations in a grid`,
                `- Use \`snapshot_layout\` to capture the arrangement`,
                `- Summarize which variations are most interesting and why`,
                ``,
                `**Attribution:** Always pass your \`agent\` name and \`model\` identifier when calling \`fork_sketch\` and other tools that create or modify sketches.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// apply-design-theory — apply design theory concepts to a sketch
// ---------------------------------------------------------------------------

function registerApplyDesignTheory(
  server: McpServer,
  state: EditorState,
): void {
  server.prompt(
    "apply-design-theory",
    "Apply design theory concepts to improve or evolve a generative art sketch",
    {
      sketchId: z
        .string()
        .describe("ID of the sketch to apply design theory to"),
      theory: z
        .enum([
          "gestalt",
          "color-theory",
          "composition",
          "rhythm-repetition",
          "negative-space",
          "contrast",
        ])
        .describe("Design theory to apply"),
    },
    async (args) => {
      const sketch = state.getSketch(args.sketchId);

      let sketchContext = "";
      if (sketch) {
        const def = sketch.definition;
        sketchContext = [
          `## Current Sketch: "${def.title}"`,
          `- **Renderer:** ${def.renderer}`,
          `- **Canvas:** ${def.canvas.width}×${def.canvas.height}`,
          `- **Parameters:** ${def.parameters?.length ?? 0} defined`,
          `- **Colors:** ${def.colors?.length ?? 0} defined`,
          def.philosophy
            ? `- **Philosophy:** ${def.philosophy}`
            : `- **Philosophy:** not set`,
        ].join("\n");
      } else {
        sketchContext = `## Sketch: ${args.sketchId}\n*(Not currently loaded — use open_sketch first)*`;
      }

      const theoryGuides: Record<string, string> = {
        gestalt: [
          `## Theory: Gestalt Principles`,
          `Apply principles of visual perception to the sketch:`,
          `- **Proximity:** Group related elements closer together`,
          `- **Similarity:** Make related elements share visual properties (size, color, shape)`,
          `- **Continuity:** Align elements to create implied lines and flow`,
          `- **Closure:** Allow the viewer's mind to complete partial shapes`,
          `- **Figure-Ground:** Establish clear foreground/background relationships`,
          ``,
          `### Implementation`,
          `1. Analyze the current algorithm for element placement patterns`,
          `2. Add or modify parameters that control grouping, spacing, and alignment`,
          `3. Ensure the seed produces consistent perceptual grouping`,
        ].join("\n"),

        "color-theory": [
          `## Theory: Color Theory`,
          `Apply color harmony and contrast principles:`,
          `- **Complementary:** Use colors opposite on the color wheel for high contrast`,
          `- **Analogous:** Use adjacent colors for harmony`,
          `- **Triadic:** Use three evenly-spaced colors for vibrancy`,
          `- **Value contrast:** Ensure sufficient light/dark variation`,
          `- **Saturation:** Control intensity for emphasis and depth`,
          ``,
          `### Implementation`,
          `1. Review the current color definitions and themes`,
          `2. Add color parameters that follow a chosen harmony scheme`,
          `3. Create 2–3 theme presets demonstrating different harmonies`,
          `4. Update the algorithm to use colors intentionally for depth and emphasis`,
        ].join("\n"),

        composition: [
          `## Theory: Composition`,
          `Apply compositional rules for visual impact:`,
          `- **Rule of thirds:** Place key elements at intersection points`,
          `- **Golden ratio:** Use φ (1.618) for proportional divisions`,
          `- **Visual weight:** Balance heavy elements with negative space`,
          `- **Leading lines:** Direct the eye through the composition`,
          `- **Focal point:** Establish a clear center of interest`,
          ``,
          `### Implementation`,
          `1. Analyze element distribution in the current algorithm`,
          `2. Add parameters for compositional control (focal point position, density distribution)`,
          `3. Use mathematical ratios (thirds, golden) for element placement`,
          `4. Test with \`capture_screenshot\` and verify visual balance`,
        ].join("\n"),

        "rhythm-repetition": [
          `## Theory: Rhythm & Repetition`,
          `Apply rhythmic patterns and controlled repetition:`,
          `- **Regular rhythm:** Equal spacing between repeated elements`,
          `- **Alternating rhythm:** Two or more elements in sequence`,
          `- **Progressive rhythm:** Gradual size, color, or spacing changes`,
          `- **Random rhythm:** Organic, noise-driven variation within structure`,
          `- **Fractal repetition:** Self-similar patterns at different scales`,
          ``,
          `### Implementation`,
          `1. Identify repeating elements in the current algorithm`,
          `2. Add parameters for rhythm type, frequency, and amplitude`,
          `3. Layer multiple rhythmic patterns for visual complexity`,
          `4. Use the seed to introduce controlled randomness within the rhythm`,
        ].join("\n"),

        "negative-space": [
          `## Theory: Negative Space`,
          `Use emptiness as a compositional element:`,
          `- **Active negative space:** Intentional empty areas that form shapes`,
          `- **Breathing room:** Prevent visual overcrowding`,
          `- **Figure-ground reversal:** Make negative space as interesting as positive`,
          `- **Density gradients:** Transition from dense to sparse areas`,
          ``,
          `### Implementation`,
          `1. Add a density/coverage parameter to control fill percentage`,
          `2. Create regions of intentional emptiness in the algorithm`,
          `3. Use the canvas edges and margins as compositional anchors`,
          `4. Test at different density levels with \`capture_screenshot\``,
        ].join("\n"),

        contrast: [
          `## Theory: Contrast`,
          `Apply contrast principles for visual interest:`,
          `- **Size contrast:** Juxtapose large and small elements`,
          `- **Color contrast:** Use complementary or value differences`,
          `- **Shape contrast:** Mix geometric and organic forms`,
          `- **Texture contrast:** Smooth vs. rough, dense vs. sparse`,
          `- **Movement contrast:** Static vs. dynamic, fast vs. slow`,
          ``,
          `### Implementation`,
          `1. Identify the dominant visual quality in the current algorithm`,
          `2. Introduce its opposite as a secondary element`,
          `3. Add parameters that control the degree of contrast`,
          `4. Use \`fork_sketch\` to compare low-contrast and high-contrast versions`,
        ].join("\n"),
      };

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Apply design theory to improve a generative art sketch.`,
                ``,
                sketchContext,
                ``,
                theoryGuides[args.theory],
                ``,
                `## Workflow`,
                `1. Use \`get_selection\` or \`open_sketch\` to examine the current sketch`,
                `2. Analyze how the theory applies to the existing algorithm`,
                `3. Use \`fork_sketch\` to create a theory-applied variant`,
                `4. Modify the fork's algorithm and parameters using the theory principles above`,
                `5. Use \`capture_screenshot\` to compare before and after`,
                `6. Update the philosophy field to document the design rationale`,
                ``,
                `**Attribution:** Always pass your \`agent\` name and \`model\` identifier when calling tools that create or modify sketches.`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}
