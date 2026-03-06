/**
 * Critique tools — Phase 2: Perception & Self-Critique (ADR 053).
 * critique_sketch, compare_sketches
 *
 * Each tool captures a screenshot and returns a structured critique framework
 * (questions, principles, pitfalls) per aspect. Critique severity calibrates
 * to the sketch's compositionLevel.
 */

import { createDefaultSkillRegistry } from "@genart-dev/core";
import type { EditorState } from "../state.js";
import { captureScreenshot, captureBatch, type CaptureScreenshotResult, type BatchItemResult } from "./capture.js";

const registry = createDefaultSkillRegistry();

// ---------------------------------------------------------------------------
// Aspect definitions
// ---------------------------------------------------------------------------

/** Aspects the agent can self-critique. */
export type CritiqueAspect =
  | "composition"
  | "color"
  | "rhythm"
  | "unity"
  | "expression";

export const ALL_ASPECTS: readonly CritiqueAspect[] = [
  "composition",
  "color",
  "rhythm",
  "unity",
  "expression",
];

/** Per-aspect framework: questions to ask, principles to check, pitfalls to watch for. */
interface AspectFramework {
  aspect: CritiqueAspect;
  questions: string[];
  principles: string[];
  pitfalls: string[];
}

/** Composition level type (matches @genart-dev/format CompositionLevel). */
type CompositionLevel = "study" | "sketch" | "developed" | "exhibition";

/** Severity calibration per composition level. */
interface SeverityCalibration {
  level: CompositionLevel;
  description: string;
  focus: string;
  tolerance: string;
}

const SEVERITY: Record<string, SeverityCalibration> = {
  study: {
    level: "study",
    description: "Fast, exploratory — value the energy of discovery over polish",
    focus: "Is the core idea visible? Does the sketch capture a single insight?",
    tolerance: "High tolerance for roughness, imbalance, and incomplete resolution. Studies should feel alive, not finished.",
  },
  sketch: {
    level: "sketch",
    description: "Intentional but rough — the idea should read clearly",
    focus: "Do composition and color serve the concept? Are parameters well-chosen?",
    tolerance: "Moderate tolerance. Unresolved edges and raw marks are fine, but the structure should be deliberate.",
  },
  developed: {
    level: "developed",
    description: "Refined — every major decision should be justified",
    focus: "Do all elements work together? Is there a clear visual hierarchy? Does the palette feel cohesive?",
    tolerance: "Low tolerance for accidental imbalance. Rough areas should be intentional, not neglected.",
  },
  exhibition: {
    level: "exhibition",
    description: "Polished — every element earns its place",
    focus: "Could you defend every choice? Does the piece hold up under sustained viewing? Is the concept fully realized?",
    tolerance: "Minimal tolerance. Each mark, color, and spatial relationship should feel inevitable.",
  },
};

// ---------------------------------------------------------------------------
// Aspect framework builders
// ---------------------------------------------------------------------------

function buildCompositionFramework(): AspectFramework {
  return {
    aspect: "composition",
    questions: [
      "Where does the eye land first? Is that the intended focal point?",
      "Is there a clear visual hierarchy (primary, secondary, tertiary)?",
      "How does the composition use the edges and corners of the canvas?",
      "Is negative space working actively or is it leftover?",
      "Does the arrangement feel balanced or intentionally unbalanced?",
    ],
    principles: [
      "Visual weight distribution — dense, dark, saturated, or detailed areas carry more weight",
      "Entry points and eye paths — the viewer needs a way in and a journey through the piece",
      "Edge tension — elements near canvas edges create tension; use this deliberately",
      "Rule of thirds / golden ratio — useful starting points, not rigid rules",
      "Figure-ground clarity — the relationship between positive and negative space",
    ],
    pitfalls: [
      "Centering everything — creates static compositions unless intentionally symmetrical",
      "Filling the canvas uniformly — denies the viewer rest areas and focal emphasis",
      "Tangent lines — elements barely touching edges or each other create visual discomfort",
      "Competing focal points — multiple areas of equal emphasis confuse the eye",
      "Ignoring the canvas aspect ratio — composition should respond to the format",
    ],
  };
}

function buildColorFramework(): AspectFramework {
  return {
    aspect: "color",
    questions: [
      "Does the palette feel intentional or arbitrary?",
      "Is there a dominant color temperature (warm/cool) or a deliberate tension between them?",
      "How many distinct hues are active? Is that number serving the concept?",
      "Are value contrasts (light/dark) creating readable structure?",
      "Do any colors feel out of place — or is dissonance intentional?",
    ],
    principles: [
      "Color harmony — analogous, complementary, triadic, or split-complementary relationships",
      "Value structure — squint at the piece; the composition should read in grayscale",
      "Temperature as depth — warm advances, cool recedes (atmospheric perspective)",
      "Saturation as emphasis — high saturation draws the eye; use it sparingly for focus",
      "Color proportion — unequal amounts create interest (e.g., 60-30-10 ratio)",
    ],
    pitfalls: [
      "Too many fully saturated colors competing for attention",
      "No value range — all mid-tones flatten the piece",
      "Random color assignment — palette should derive from concept, not just randomness",
      "Ignoring simultaneous contrast — adjacent colors alter each other's appearance",
      "Uniform opacity everywhere — varying transparency adds depth and atmosphere",
    ],
  };
}

function buildRhythmFramework(): AspectFramework {
  return {
    aspect: "rhythm",
    questions: [
      "Is there a repeating visual motif or interval?",
      "Does the rhythm accelerate, decelerate, or remain steady?",
      "Are there moments of syncopation — unexpected breaks in the pattern?",
      "Does the rhythm contribute to or fight against the composition?",
      "Is there scale variation — does the motif appear at multiple sizes?",
    ],
    principles: [
      "Regular rhythm creates calm and order; irregular rhythm creates energy",
      "Progressive rhythm (gradual change) creates movement and depth",
      "Alternating rhythm adds complexity without chaos",
      "Rhythm at multiple scales (fractal repetition) creates richness",
      "Silence (empty intervals) is as important as sound (marked intervals)",
    ],
    pitfalls: [
      "Perfectly regular grids without variation feel mechanical, not generative",
      "Random distribution reads as noise, not rhythm",
      "Single-scale repetition feels monotonous — vary size, spacing, or density",
      "Rhythm that ignores the composition's focal structure",
      "Over-complexity — too many overlapping rhythms create visual noise",
    ],
  };
}

function buildUnityFramework(): AspectFramework {
  return {
    aspect: "unity",
    questions: [
      "Does the piece feel like one cohesive work or disconnected parts?",
      "Is there a unifying visual language (consistent mark quality, shape vocabulary)?",
      "Do the parameters work together or do some feel bolted on?",
      "Would removing any element weaken the whole?",
      "Does the algorithm express a single clear idea?",
    ],
    principles: [
      "Unity through repetition — shared elements tie the composition together",
      "Unity through proximity — grouped elements feel related",
      "Unity through continuation — aligned elements create visual connections",
      "Variety within unity — enough variation to hold interest, enough consistency to cohere",
      "Conceptual unity — all visual decisions serve the stated philosophy",
    ],
    pitfalls: [
      "Feature accumulation — adding elements that don't serve the core concept",
      "Inconsistent mark quality — mixing precise geometry with organic marks without intention",
      "Disconnected color and form — palette that doesn't relate to the spatial structure",
      "Parameter sprawl — too many controls that don't interact meaningfully",
      "Style mixing without integration — combining techniques that don't speak to each other",
    ],
  };
}

function buildExpressionFramework(): AspectFramework {
  return {
    aspect: "expression",
    questions: [
      "What mood or feeling does this piece evoke?",
      "Is the generative process visible in the output? Should it be?",
      "Does the algorithm's logic contribute to the emotional quality?",
      "Is there a sense of the unexpected — does the piece surprise even its creator?",
      "Does the philosophy statement match the visual experience?",
    ],
    principles: [
      "Generative art is a conversation between intention and emergence",
      "The algorithm is a medium — its constraints and affordances shape expression",
      "Controlled randomness creates life; pure randomness creates noise",
      "The seed is a collaborator — different seeds should produce meaningfully different moods",
      "Process and result are both the artwork — the code embodies artistic decisions",
    ],
    pitfalls: [
      "Over-control — leaving no room for generative surprise",
      "Under-control — no discernible artistic intention behind the randomness",
      "Technique as end — impressive code that produces emotionally flat output",
      "Derivative work — reproducing established generative art tropes without adding perspective",
      "Mismatched intent — the philosophy says one thing but the visual says another",
    ],
  };
}

const ASPECT_BUILDERS: Record<CritiqueAspect, () => AspectFramework> = {
  composition: buildCompositionFramework,
  color: buildColorFramework,
  rhythm: buildRhythmFramework,
  unity: buildUnityFramework,
  expression: buildExpressionFramework,
};

// ---------------------------------------------------------------------------
// critique_sketch
// ---------------------------------------------------------------------------

export interface CritiqueSketchInput {
  sketchId?: string;
  aspects?: CritiqueAspect[];
  previewSize?: number;
}

export interface CritiqueSketchResult {
  /** JSON-safe critique framework for the text content block. */
  metadata: Record<string, unknown>;
  /** Small JPEG as base64 for MCP image content block. */
  previewJpegBase64: string;
}

export async function critiqueSketch(
  state: EditorState,
  input: CritiqueSketchInput,
): Promise<CritiqueSketchResult> {
  state.requireWorkspace();

  // Resolve sketch ID
  let sketchId: string;
  if (input.sketchId) {
    sketchId = input.sketchId;
  } else if (state.selection.size > 0) {
    sketchId = [...state.selection][0]!;
  } else {
    throw new Error("No sketch specified and nothing selected");
  }

  const loaded = state.requireSketch(sketchId);
  const sketch = loaded.definition;

  // Capture screenshot for visual analysis
  const capture: CaptureScreenshotResult = await captureScreenshot(state, {
    target: "sketch",
    sketchId,
    previewSize: input.previewSize ?? 400,
  });

  // Determine which aspects to critique
  const aspects = input.aspects ?? [...ALL_ASPECTS];

  // Build frameworks
  const frameworks = aspects.map((a) => ASPECT_BUILDERS[a]());

  // Determine severity calibration
  const level = sketch.compositionLevel ?? "sketch";
  const severity = SEVERITY[level] ?? SEVERITY["sketch"]!;

  // Gather relevant skills as context
  const relevantSkills = gatherRelevantSkills(aspects);

  const metadata: Record<string, unknown> = {
    success: true,
    sketchId,
    title: sketch.title,
    compositionLevel: level,
    philosophy: sketch.philosophy ?? null,
    severity: {
      level: severity.level,
      description: severity.description,
      focus: severity.focus,
      tolerance: severity.tolerance,
    },
    frameworks,
    relevantSkills,
    instructions: [
      "Use the image above and the frameworks below to perform a structured self-critique.",
      `Calibrate your critique to the ${severity.level} level: ${severity.description}`,
      "For each aspect, answer the questions, check the principles, and watch for the pitfalls.",
      "Be honest but constructive — identify what works as well as what could improve.",
      "End with 2-3 specific, actionable improvements ranked by impact.",
    ],
  };

  return {
    metadata,
    previewJpegBase64: capture.previewJpegBase64,
  };
}

// ---------------------------------------------------------------------------
// compare_sketches
// ---------------------------------------------------------------------------

export interface CompareSketchesInput {
  sketchIds: string[];
  aspects?: CritiqueAspect[];
  previewSize?: number;
}

export interface CompareSketchesResult {
  /** JSON-safe comparison framework. */
  metadata: Record<string, unknown>;
  /** Per-sketch inline JPEG base64 strings. */
  previews: Array<{ sketchId: string; inlineJpegBase64: string }>;
}

export async function compareSketches(
  state: EditorState,
  input: CompareSketchesInput,
): Promise<CompareSketchesResult> {
  state.requireWorkspace();

  const ids = input.sketchIds;
  if (ids.length < 2) {
    throw new Error("compare_sketches requires at least 2 sketch IDs");
  }
  if (ids.length > 4) {
    throw new Error("compare_sketches supports a maximum of 4 sketches");
  }

  // Validate all sketches exist
  const sketchInfos = ids.map((id) => {
    const loaded = state.requireSketch(id);
    return {
      id,
      title: loaded.definition.title,
      compositionLevel: loaded.definition.compositionLevel ?? "sketch",
      philosophy: loaded.definition.philosophy ?? null,
      renderer: loaded.definition.renderer.type,
      seed: loaded.definition.state.seed,
    };
  });

  // Batch capture all sketches
  const batchResult = await captureBatch(state, {
    sketchIds: ids,
    previewSize: input.previewSize ?? 300,
  });

  // Build previews array matched by sketch ID
  const previews = batchResult.items.map((item: BatchItemResult) => ({
    sketchId: (item.metadata as Record<string, unknown>)["sketchId"] as string,
    inlineJpegBase64: item.inlineJpegBase64,
  }));

  // Determine aspects
  const aspects = input.aspects ?? [...ALL_ASPECTS];
  const frameworks = aspects.map((a) => ASPECT_BUILDERS[a]());

  // Build comparison-specific questions per aspect
  const comparisonQuestions = aspects.map((aspect) => ({
    aspect,
    questions: buildComparisonQuestions(aspect, sketchInfos.length),
  }));

  const metadata: Record<string, unknown> = {
    success: true,
    sketches: sketchInfos,
    aspects,
    frameworks,
    comparisonQuestions,
    instructions: [
      `Compare the ${ids.length} sketches shown above across the specified aspects.`,
      "For each aspect, use the framework questions and comparison questions to analyze differences.",
      "Identify which sketch handles each aspect most effectively and why.",
      "Note where sketches complement each other — techniques from one could improve another.",
      "End with a ranking per aspect and overall, with specific observations justifying each placement.",
    ],
  };

  return { metadata, previews };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build comparison-specific questions for an aspect. */
function buildComparisonQuestions(
  aspect: CritiqueAspect,
  count: number,
): string[] {
  const base: Record<CritiqueAspect, string[]> = {
    composition: [
      "Which sketch has the strongest focal point?",
      "How do the compositions differ in their use of space?",
      "Which creates the most effective visual hierarchy?",
    ],
    color: [
      "Which palette feels most intentional?",
      "How do the value ranges compare — which has the strongest lights and darks?",
      "Which color temperature creates the most effective mood?",
    ],
    rhythm: [
      "Which sketch has the most engaging visual rhythm?",
      "How do the rhythmic structures differ — regular vs progressive vs irregular?",
      "Which achieves the best balance of repetition and variation?",
    ],
    unity: [
      "Which sketch feels most cohesive as a single work?",
      "Where does unity break down in each — what elements feel disconnected?",
      "Which has the tightest relationship between concept and execution?",
    ],
    expression: [
      "Which sketch evokes the strongest emotional response?",
      "How does each sketch's generative process contribute to its expression?",
      "Which most successfully balances intention with emergence?",
    ],
  };

  const questions = [...base[aspect]];
  if (count > 2) {
    questions.push(
      `Could elements from different sketches be combined to create something stronger?`,
    );
  }
  return questions;
}

/** Gather skill summaries relevant to the requested aspects. */
function gatherRelevantSkills(
  aspects: CritiqueAspect[],
): Array<{ id: string; name: string; relevantTo: CritiqueAspect }> {
  const aspectToCategory: Record<CritiqueAspect, string[]> = {
    composition: ["composition"],
    color: ["color"],
    rhythm: ["composition"],
    unity: ["composition", "color"],
    expression: ["process"],
  };

  const seen = new Set<string>();
  const result: Array<{ id: string; name: string; relevantTo: CritiqueAspect }> = [];

  for (const aspect of aspects) {
    const categories = aspectToCategory[aspect];
    for (const cat of categories) {
      const skills = registry.list(cat);
      for (const skill of skills) {
        if (!seen.has(skill.id)) {
          seen.add(skill.id);
          result.push({ id: skill.id, name: skill.name, relevantTo: aspect });
        }
      }
    }
  }

  return result;
}
