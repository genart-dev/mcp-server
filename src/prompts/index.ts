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
  registerCritiqueAndIterate(server, state);
  registerDevelopArtisticConcept(server, state);
  registerStudyReference(server, state);
}

// ---------------------------------------------------------------------------
// create-generative-art — structured prompt for creating new generative art
// ---------------------------------------------------------------------------

function registerCreateGenerativeArt(server: McpServer): void {
  server.prompt(
    "create-generative-art",
    "Create a new piece of generative art with algorithmic philosophy, structured parameters, and interactive preview",
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

      const complexityGuide =
        complexity === "simple"
          ? `Keep the algorithm under 50 lines with 2-3 parameters.`
          : complexity === "complex"
            ? `The algorithm can be extensive; use 5+ parameters and consider animation.`
            : `Aim for 30-80 lines with 3-5 parameters.`;

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Create a generative art sketch. Follow this two-phase process:`,
                ``,
                `## Input`,
                `- **Concept:** ${args.concept}`,
                `- **Renderer:** ${renderer}`,
                `- **Complexity:** ${complexity} (${complexityGuide})`,
                `- **Canvas:** ${canvas}`,
                ``,
                `## Phase 1: Algorithmic Philosophy`,
                ``,
                `Before writing any code, create an ALGORITHMIC PHILOSOPHY — a computational aesthetic manifesto for this piece.`,
                ``,
                `**Name the movement** (1-2 words): e.g. "Organic Turbulence", "Quantum Harmonics", "Emergent Stillness"`,
                ``,
                `**Write 4-6 paragraphs** describing how this philosophy manifests through:`,
                `- Computational processes and mathematical relationships`,
                `- Noise functions and randomness patterns`,
                `- Particle behaviors and field dynamics`,
                `- Parametric variation and emergent complexity`,
                ``,
                `**Guidelines:**`,
                `- Avoid redundancy — each concept mentioned once`,
                `- Emphasize craftsmanship REPEATEDLY — "meticulously crafted," "product of deep expertise," "painstaking optimization"`,
                `- Leave creative space for implementation choices`,
                `- Beauty lives in the PROCESS, not the final frame`,
                ``,
                `**Deduce the conceptual seed:** Identify a subtle, niche reference embedded within the algorithm — not literal, always sophisticated. Someone familiar should feel it intuitively; others simply experience masterful generative composition. Like a jazz musician quoting a song through harmonic structure.`,
                ``,
                `## Phase 2: Implementation via \`create_sketch\``,
                ``,
                `Call \`create_sketch\` with ALL of these fields in a single call:`,
                `- \`id\`: kebab-case slug`,
                `- \`title\`: human-readable title`,
                `- \`path\`: "\${id}.genart"`,
                `- \`renderer\`: "${renderer}"`,
                `- \`canvas\`: { width/height from "${canvas}" }`,
                `- \`philosophy\`: the 4-6 paragraph manifesto from Phase 1`,
                `- \`seed\`: a starting seed`,
                `- \`parameters\`: 3-8 params with meaningful ranges`,
                `- \`colors\`: 2-4 colors with semantic labels and thoughtful defaults`,
                `- \`themes\`: 2-4 named palette presets`,
                `- \`components\`: declare shared utilities (e.g. \`"prng": "^1.0.0"\`, \`"noise-2d": "^1.0.0"\`) — do NOT embed PRNG/noise/easing inline`,
                `- \`algorithm\`: the code expressing the philosophy`,
                ``,
                `**The preview auto-opens in the browser** with parameter sliders, color pickers, and seed controls.`,
                ``,
                renderer === "p5"
                  ? [
                      `### p5 Algorithm Contract`,
                      `\`\`\`javascript`,
                      `function sketch(p, state) {`,
                      `  const W = state.canvas.width, H = state.canvas.height;`,
                      `  const rng = mulberry32(state.seed); // from "prng" component`,
                      `  // Read params: state.params.noiseScale, state.params.count`,
                      `  // Read colors: state.colorPalette[0], state.colorPalette[1]`,
                      `  let system; // declare state vars here`,
                      `  function initializeSystem() {`,
                      `    system = {}; // rebuild from params + seed`,
                      `  }`,
                      `  p.setup = function() { p.createCanvas(W, H); p.pixelDensity(1); initializeSystem(); };`,
                      `  p.draw = function() { /* express the philosophy */ };`,
                      `  return { initializeSystem };`,
                      `}`,
                      `\`\`\``,
                      `- ALWAYS prefix p5 calls with \`p.\` (instance mode)`,
                      `- NEVER use bare \`createCanvas()\`, \`background()\`, etc.`,
                      `- MUST return \`{ initializeSystem }\` — the viewer calls it on param/seed changes`,
                      `- Use \`mulberry32(state.seed)\` from the "prng" component — NEVER \`Math.random()\``,
                    ].join("\n")
                  : renderer === "canvas2d"
                    ? [
                        `### canvas2d Algorithm Contract`,
                        `\`\`\`javascript`,
                        `function sketch(ctx, state) {`,
                        `  const W = state.canvas.width, H = state.canvas.height;`,
                        `  const rng = mulberry32(state.seed);`,
                        `  // state.params.key, state.colorPalette[index]`,
                        `  function initializeSystem() {`,
                        `    ctx.fillStyle = state.colorPalette[0];`,
                        `    ctx.fillRect(0, 0, W, H);`,
                        `    // ... express the philosophy (single-frame render)`,
                        `  }`,
                        `  return { initializeSystem };`,
                        `}`,
                        `\`\`\``,
                        `- canvas2d renders in a SINGLE FRAME — put all drawing in \`initializeSystem()\``,
                        `- MUST return \`{ initializeSystem }\` — the viewer calls it on param/seed changes`,
                      ].join("\n")
                    : `Use the ${renderer} algorithm contract (see \`create_sketch\` tool description for state API).`,
                ``,
                `## Craftsmanship`,
                ``,
                `Create algorithms that feel like they emerged through countless iterations by a master generative artist:`,
                `- **Balance**: Complexity without visual noise, order without rigidity`,
                `- **Color Harmony**: Thoughtful palettes, not random RGB values`,
                `- **Composition**: Even in randomness, maintain visual hierarchy and flow`,
                `- **Performance**: Smooth execution, optimized for real-time if animated`,
                `- **Reproducibility**: Same seed ALWAYS produces identical output`,
                ``,
                `## After Creation`,
                ``,
                `- The browser preview opens automatically — the user can adjust sliders and explore seeds`,
                `- Use \`update_algorithm\` to iterate on the code`,
                `- Use \`set_parameters\` / \`set_colors\` to tune values`,
                `- Use \`fork_sketch\` to create variations`,
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
          `- **Renderer:** ${typeof def.renderer === 'string' ? def.renderer : def.renderer.type}`,
          `- **Canvas:** ${def.canvas.width}×${def.canvas.height}`,
          `- **Seed:** ${def.state.seed}`,
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
          `- **Renderer:** ${typeof def.renderer === 'string' ? def.renderer : def.renderer.type}`,
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

// ---------------------------------------------------------------------------
// critique-and-iterate — capture → self-critique → improve → compare → document
// ---------------------------------------------------------------------------

function registerCritiqueAndIterate(
  server: McpServer,
  state: EditorState,
): void {
  server.prompt(
    "critique-and-iterate",
    "Capture a sketch, self-critique it, identify improvements, fork, apply changes, compare, and document the iteration",
    {
      sketchId: z
        .string()
        .describe("ID of the sketch to critique and iterate on"),
      aspects: z
        .string()
        .optional()
        .describe("Comma-separated aspects to focus on (composition, color, rhythm, unity, expression). Default: all"),
      iterations: z
        .string()
        .optional()
        .describe("Number of improvement iterations (default: 1)"),
    },
    async (args) => {
      const sketch = state.getSketch(args.sketchId);
      const iterations = args.iterations ? parseInt(args.iterations, 10) : 1;
      const aspectList = args.aspects
        ? args.aspects.split(",").map((a) => a.trim())
        : ["composition", "color", "rhythm", "unity", "expression"];

      let sketchContext = "";
      if (sketch) {
        const def = sketch.definition;
        sketchContext = [
          `## Current Sketch: "${def.title}"`,
          `- **ID:** ${def.id}`,
          `- **Renderer:** ${def.renderer.type}`,
          `- **Canvas:** ${def.canvas.width}×${def.canvas.height}`,
          `- **Composition Level:** ${def.compositionLevel ?? "sketch"}`,
          def.philosophy
            ? `- **Philosophy:** ${def.philosophy}`
            : `- **Philosophy:** not set`,
          `- **Parameters:** ${def.parameters?.length ?? 0} defined`,
          `- **Colors:** ${def.colors?.length ?? 0} defined`,
        ].join("\n");
      } else {
        sketchContext = `## Sketch: ${args.sketchId}\n*(Not currently loaded — use open_sketch first)*`;
      }

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Perform a structured critique-and-iterate cycle on a generative art sketch.`,
                ``,
                sketchContext,
                ``,
                `## Focus Aspects`,
                aspectList.map((a) => `- ${a}`).join("\n"),
                ``,
                `## Iterations: ${iterations}`,
                ``,
                `## Process`,
                ``,
                `For each iteration:`,
                ``,
                `### Step 1: Capture & Critique`,
                `1. Use \`critique_sketch\` with sketchId="${args.sketchId}" and aspects=[${aspectList.map((a) => `"${a}"`).join(", ")}]`,
                `2. Study the returned screenshot carefully`,
                `3. Answer each framework question honestly — what works and what doesn't`,
                `4. Note the severity calibration for this composition level`,
                ``,
                `### Step 2: Identify Improvements`,
                `Based on the critique, identify 2-3 specific, actionable improvements:`,
                `- Rank them by expected visual impact`,
                `- Be precise: "shift the focal cluster from center to upper-left third" not "improve composition"`,
                `- Consider which improvements can be achieved via parameter changes vs algorithm changes`,
                ``,
                `### Step 3: Fork & Apply`,
                `1. Use \`fork_sketch\` to create a new version (preserve the original for comparison)`,
                `2. Apply the identified improvements:`,
                `   - Use \`set_parameters\` or \`set_colors\` for parameter-level changes`,
                `   - Use \`update_algorithm\` for algorithmic changes`,
                `3. Use \`capture_screenshot\` to verify each change visually`,
                ``,
                `### Step 4: Compare`,
                `1. Use \`compare_sketches\` with the original and improved sketch IDs`,
                `2. Evaluate: did each intended improvement actually improve the piece?`,
                `3. Note any unintended consequences — improvements in one aspect sometimes degrade another`,
                ``,
                `### Step 5: Document`,
                `After all iterations:`,
                `1. Update the improved sketch's philosophy field to document what changed and why`,
                `2. Summarize the iteration journey: what was tried, what worked, what was learned`,
                `3. If the original was better in some aspects, note what to preserve in future iterations`,
                ``,
                `## Guidelines`,
                `- Be your own harshest (but fairest) critic — the goal is genuine improvement`,
                `- Small, focused changes are better than sweeping rewrites`,
                `- If a change doesn't work, revert it before trying the next improvement`,
                `- The final piece should feel like a natural evolution, not a different sketch`,
                `- Always pass your \`agent\` name and \`model\` identifier when calling tools that create or modify sketches`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// develop-artistic-concept — concept → study → thumbnails → develop → critique → iterate → document
// ---------------------------------------------------------------------------

function registerDevelopArtisticConcept(
  server: McpServer,
  _state: EditorState,
): void {
  server.prompt(
    "develop-artistic-concept",
    "Develop an artistic concept through a full studio workflow: concept planning, studies, development, critique, iteration, and documentation",
    {
      concept: z
        .string()
        .describe("The artistic concept or theme to explore"),
      medium: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Preferred renderer/medium (default: p5)"),
      depth: z
        .enum(["quick", "standard", "deep"])
        .optional()
        .describe("How deeply to explore: quick (3 studies), standard (6 studies), deep (9+ studies). Default: standard"),
    },
    async (args) => {
      const medium = args.medium ?? "p5";
      const depth = args.depth ?? "standard";
      const studyCount = depth === "quick" ? 3 : depth === "deep" ? 9 : 6;

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Develop the following artistic concept through a full studio workflow.`,
                ``,
                `## Concept`,
                `${args.concept}`,
                ``,
                `## Medium: ${medium}`,
                `## Depth: ${depth} (${studyCount} studies)`,
                ``,
                `## Phase 1: Conceptual Planning`,
                `1. Use \`develop_concept\` with your concept and medium to get a structured plan`,
                `2. Define: mood, color strategy, compositional approach, and relevant skills`,
                `3. Create a series with \`create_series\` — write a narrative and intent statement`,
                ``,
                `## Phase 2: Thumbnail Studies`,
                `1. Create ${studyCount} quick study-level sketches with \`create_sketch\` (compositionLevel: "study")`,
                `2. Each study should explore a different aspect of the concept:`,
                `   - Vary composition (centered vs asymmetric vs edge-driven)`,
                `   - Vary color (warm vs cool, saturated vs muted)`,
                `   - Vary rhythm (regular vs progressive vs chaotic)`,
                `   - Vary density (sparse vs dense vs gradient)`,
                `3. Use small canvases (600x600 or similar) — studies are fast explorations`,
                `4. Use \`capture_batch\` to see all studies at once`,
                ``,
                `## Phase 3: Selection & Critique`,
                `1. Use \`series_summary\` to see the full set of studies with screenshots`,
                `2. Use \`critique_sketch\` on the 2-3 most promising studies`,
                `3. Identify which studies best capture the concept's intent`,
                `4. Note what works in each — composition choices, color relationships, rhythmic qualities`,
                ``,
                `## Phase 4: Development`,
                `1. Use \`promote_sketch\` to advance the best 1-2 studies to "drafts" stage`,
                `2. Refine the promoted sketches:`,
                `   - Add more parameters for fine control`,
                `   - Develop the color palette with more nuance`,
                `   - Strengthen compositional structure`,
                `   - Load relevant skills with \`load_skill\` for guidance`,
                `3. Use \`critique_sketch\` after each round of changes`,
                ``,
                `## Phase 5: Critique & Iteration`,
                `1. Use \`compare_sketches\` to evaluate drafts against each other`,
                `2. For the strongest draft, use the critique-and-iterate workflow:`,
                `   - Critique → identify improvements → fork → apply → compare`,
                `3. Promote the best iteration to "refinements" stage`,
                `4. Continue refining until the piece feels resolved`,
                ``,
                `## Phase 6: Final & Documentation`,
                `1. Promote the best refinement to "finals" stage (canvas will upscale)`,
                `2. Update the philosophy field with the full artistic statement`,
                `3. Use \`series_summary\` to capture the complete progression`,
                `4. Document: what was the concept? How did it evolve? What was discovered?`,
                ``,
                `## Guidelines`,
                `- Each phase should feel like a natural progression, not a checklist`,
                `- Trust the studies — let unexpected results redirect the exploration`,
                `- The final piece should feel inevitable, like it couldn't have been any other way`,
                `- Always pass your \`agent\` name and \`model\` identifier when calling tools`,
                `- Use \`auto_arrange\` periodically to keep the workspace organized`,
              ].join("\n"),
            },
          },
        ],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// study-reference — analyze → identify key qualities → create study → document
// ---------------------------------------------------------------------------

function registerStudyReference(
  server: McpServer,
  _state: EditorState,
): void {
  server.prompt(
    "study-reference",
    "Study a reference image: analyze it, identify key qualities, create a generative study sketch inspired by it, and document learnings",
    {
      referenceId: z
        .string()
        .describe("ID of the reference to study"),
      seriesId: z
        .string()
        .optional()
        .describe("Series the reference belongs to (also where the study sketch will be added)"),
      sketchId: z
        .string()
        .optional()
        .describe("Sketch the reference belongs to"),
      medium: z
        .enum(["p5", "three", "glsl", "canvas2d", "svg"])
        .optional()
        .describe("Renderer for the study sketch (default: p5)"),
      focus: z
        .string()
        .optional()
        .describe("Specific quality to focus on: composition, palette, rhythm, mood, technique, or a custom focus"),
    },
    async (args) => {
      const medium = args.medium ?? "p5";
      const focus = args.focus ?? "all key qualities";

      return {
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: [
                `Study a reference image and create a generative art sketch inspired by it.`,
                ``,
                `## Reference: ${args.referenceId}`,
                args.seriesId ? `## Series: ${args.seriesId}` : "",
                `## Medium: ${medium}`,
                `## Focus: ${focus}`,
                ``,
                `## Phase 1: Analyze the Reference`,
                `1. Use \`analyze_reference\` with referenceId="${args.referenceId}"${args.seriesId ? ` seriesId="${args.seriesId}"` : ""}${args.sketchId ? ` sketchId="${args.sketchId}"` : ""} to get the analysis framework and image`,
                `2. Study the image carefully using the framework prompts`,
                `3. Answer each category: composition, palette, rhythm, mood, technique`,
                `4. Use \`update_reference_analysis\` to save your structured analysis`,
                ``,
                `## Phase 2: Extract Key Qualities`,
                `From your analysis, identify 2-4 key qualities that are most interesting for generative art:`,
                `- These could be: a specific compositional structure, a color relationship, a rhythmic pattern, a mood quality`,
                `- Focus on qualities that can be *translated* into code, not literally replicated`,
                `- Consider what makes this reference compelling — what would be lost if you removed each quality?`,
                ``,
                `## Phase 3: Extract Palette`,
                `1. Use \`extract_palette\` to study the reference's color strategy`,
                `2. Extract 5-8 hex colors that capture the essential palette`,
                `3. Save the palette in the reference analysis`,
                ``,
                `## Phase 4: Create Study Sketch`,
                `1. Use \`create_sketch\` with compositionLevel: "study" to create a quick exploration`,
                `2. Translate the key qualities into generative parameters and algorithm choices:`,
                `   - Composition → element placement, density distribution, negative space`,
                `   - Palette → color definitions, themes derived from the reference palette`,
                `   - Rhythm → repetition patterns, interval variations, scale relationships`,
                `   - Mood → overall tone, animation speed, mark quality`,
                `   - Technique → rendering approach, layering, transparency`,
                `3. Add the reference to the sketch with \`add_reference\``,
                `4. Document in the philosophy field how the reference influenced the study`,
                `5. Use \`capture_screenshot\` to verify the result`,
                ``,
                `## Phase 5: Compare & Document`,
                `1. Use \`analyze_reference\` again to see the reference alongside your study`,
                `2. Evaluate: which qualities translated well? Which were lost or transformed?`,
                `3. Note what you learned — what worked, what surprised you, what to try next`,
                `4. Update the study sketch's philosophy with these insights`,
                ``,
                `## Guidelines`,
                `- The goal is *inspiration*, not replication — a study should be recognizably generative`,
                `- A good study captures the *spirit* of the reference while being authentically algorithmic`,
                `- Use small canvases (600x600) — studies are explorations, not finished pieces`,
                `- If the reference suggests multiple interesting directions, create multiple studies`,
                `- Always pass your \`agent\` name and \`model\` identifier when calling tools`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    },
  );
}
