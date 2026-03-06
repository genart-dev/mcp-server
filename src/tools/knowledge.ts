/**
 * Design knowledge tools.
 * list_skills, load_skill, get_guidelines, suggest_skills
 */

import { createDefaultSkillRegistry } from "@genart-dev/core";
import type { EditorState } from "../state.js";

const registry = createDefaultSkillRegistry();

// ---------------------------------------------------------------------------
// list_skills
// ---------------------------------------------------------------------------

export interface ListSkillsInput {
  category?: string;
}

export async function listSkills(
  input: ListSkillsInput,
): Promise<Record<string, unknown>> {
  const skills = registry.list(input.category);

  return {
    success: true,
    skills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      complexity: s.complexity,
      description: s.description,
    })),
    total: skills.length,
  };
}

// ---------------------------------------------------------------------------
// load_skill
// ---------------------------------------------------------------------------

export interface LoadSkillInput {
  skillId: string;
  renderer?: string;
}

export async function loadSkill(
  input: LoadSkillInput,
): Promise<Record<string, unknown>> {
  const skill = registry.get(input.skillId);

  if (!skill) {
    return {
      success: false,
      error: `Skill not found: '${input.skillId}'`,
      skill: null,
    };
  }

  const skillData: Record<string, unknown> = {
    id: skill.id,
    name: skill.name,
    category: skill.category,
    complexity: skill.complexity,
    description: skill.description,
    theory: skill.theory,
    principles: skill.principles,
    references: skill.references,
    suggestedParameters: skill.suggestedParameters ?? [],
    suggestedColors: skill.suggestedColors ?? [],
  };

  // Include renderer-specific example if requested and available
  if (input.renderer && skill.examples) {
    const example =
      skill.examples[input.renderer as keyof typeof skill.examples];
    if (example) {
      skillData["example"] = example;
    }
  }

  return {
    success: true,
    skill: skillData,
  };
}

// ---------------------------------------------------------------------------
// get_guidelines
// ---------------------------------------------------------------------------

export interface GetGuidelinesInput {
  topic: string;
  renderer?: string;
}

/** Static guidelines for topics that don't map to skill categories. */
const STATIC_GUIDELINES: Record<string, string> = {
  parameters: `## Parameter Design Guidelines

- Keep parameter count between 3 and 8 for usability
- Use intuitive ranges: 0-1 for normalized values, actual units for physical quantities
- Set defaults that produce an interesting (not extreme) result
- Group related parameters in tabs for complex sketches
- Name parameters descriptively: "noiseScale" not "ns"
- Step size should match visual sensitivity: fine for color, coarse for counts`,

  animation: `## Animation Guidelines

- Use requestAnimationFrame for smooth 60fps animation
- Separate initialization from per-frame updates
- Provide pause/resume control for resource management
- Use time-based animation (not frame-count) for consistent speed
- Consider using easing functions for natural motion
- Keep draw loops lightweight — precompute what you can in setup`,

  performance: `## Performance Guidelines

- Only the selected artboard should run live; others should pause
- Use offscreen rendering for thumbnails
- Dispose WebGL contexts and GPU resources when unmounting
- Limit particle/element counts with parameters
- Use spatial data structures (quadtree, grid) for collision/proximity
- Profile with Chrome DevTools before optimizing`,
};

export async function getGuidelines(
  input: GetGuidelinesInput,
): Promise<Record<string, unknown>> {
  const topic = input.topic;

  // Check for static guidelines first
  if (STATIC_GUIDELINES[topic]) {
    return {
      success: true,
      topic,
      guidelines: STATIC_GUIDELINES[topic],
      relatedSkills: [],
    };
  }

  // Map topic to skill category
  const categoryMap: Record<string, string> = {
    composition: "composition",
    color: "color",
    colours: "color",
    layout: "composition",
    palette: "color",
    painting: "painting",
    watercolor: "painting",
    ink: "illustration",
    illustration: "illustration",
    "mixed-media": "illustration",
    "mixed media": "illustration",
    process: "process",
    layering: "process",
    "mark-making": "process",
    refinement: "process",
    constraints: "process",
  };

  const category = categoryMap[topic];
  if (!category) {
    return {
      success: false,
      topic,
      error: `No guidelines found for topic: '${topic}'. Available topics: composition, color, painting, illustration, process, parameters, animation, performance`,
      guidelines: null,
      relatedSkills: [],
    };
  }

  const skills = registry.list(category);
  const guidelines = skills
    .map(
      (s) =>
        `### ${s.name}\n\n${s.description}\n\n**Principles:**\n${s.principles.map((p) => `- ${p}`).join("\n")}`,
    )
    .join("\n\n---\n\n");

  return {
    success: true,
    topic,
    guidelines: `## ${category.charAt(0).toUpperCase() + category.slice(1)} Guidelines\n\n${guidelines}`,
    relatedSkills: skills.map((s) => ({
      id: s.id,
      name: s.name,
      complexity: s.complexity,
    })),
  };
}

// ---------------------------------------------------------------------------
// suggest_skills
// ---------------------------------------------------------------------------

export interface SuggestSkillsInput {
  sketchId?: string;
  context?: string;
}

/** Keyword-to-skill relevance mapping for context-based suggestions. */
const CONTEXT_KEYWORDS: Record<string, readonly string[]> = {
  // Composition keywords
  layout: ["golden-ratio", "rule-of-thirds", "visual-weight", "gestalt-grouping"],
  balance: ["visual-weight", "golden-ratio", "rule-of-thirds"],
  grid: ["rule-of-thirds", "gestalt-grouping", "rhythm-movement"],
  flow: ["rhythm-movement", "gestalt-grouping"],
  movement: ["rhythm-movement", "mark-making"],
  rhythm: ["rhythm-movement", "mark-making"],
  focal: ["rule-of-thirds", "visual-weight", "figure-ground"],
  negative: ["figure-ground", "visual-weight"],
  space: ["figure-ground", "visual-weight", "atmospheric-depth"],
  // Color keywords
  palette: ["color-harmony", "palette-generation", "color-mixing-strategy"],
  color: ["color-harmony", "color-temperature", "itten-contrasts", "color-mixing-strategy"],
  warm: ["color-temperature", "atmospheric-depth"],
  cool: ["color-temperature", "atmospheric-depth"],
  contrast: ["simultaneous-contrast", "itten-contrasts", "value-structure"],
  value: ["value-structure", "itten-contrasts", "layering-strategy"],
  gray: ["color-mixing-strategy", "value-structure"],
  // Painting keywords
  watercolor: ["watercolor-techniques", "layering-strategy", "material-behavior"],
  ink: ["ink-illustration", "mark-making", "material-behavior"],
  oil: ["painting-foundations", "layering-strategy", "material-behavior"],
  charcoal: ["material-behavior", "mark-making"],
  brush: ["mark-making", "material-behavior"],
  layer: ["layering-strategy", "mixed-media-workflow", "iterative-refinement"],
  texture: ["material-behavior", "mark-making"],
  // Process keywords
  study: ["thumbnail-studies", "creative-constraints", "iterative-refinement"],
  thumbnail: ["thumbnail-studies", "creative-constraints"],
  refine: ["iterative-refinement", "layering-strategy"],
  iterate: ["iterative-refinement", "thumbnail-studies"],
  depth: ["atmospheric-depth", "color-temperature", "value-structure"],
  atmosphere: ["atmospheric-depth", "color-temperature"],
  perspective: ["atmospheric-depth"],
  constraint: ["creative-constraints"],
  limit: ["creative-constraints", "color-mixing-strategy"],
  hatch: ["mark-making", "ink-illustration"],
  stipple: ["mark-making"],
  gestural: ["mark-making", "iterative-refinement"],
  mix: ["color-mixing-strategy", "mixed-media-workflow"],
  glaze: ["layering-strategy", "material-behavior"],
};

export async function suggestSkills(
  state: EditorState,
  input: SuggestSkillsInput,
): Promise<Record<string, unknown>> {
  const allSkills = registry.list();
  const scored = new Map<string, { score: number; reasons: string[] }>();

  // Initialize all skills with base score
  for (const skill of allSkills) {
    scored.set(skill.id, { score: 0, reasons: [] });
  }

  // Score based on sketch context if a sketch is provided
  if (input.sketchId) {
    const loaded = state.getSketch(input.sketchId);
    if (loaded) {
      const sketch = loaded.definition;

      // Boost skills not already used by the sketch
      const usedSkills = new Set(sketch.skills ?? []);
      for (const skill of allSkills) {
        if (!usedSkills.has(skill.id)) {
          const entry = scored.get(skill.id)!;
          entry.score += 1;
          entry.reasons.push("not yet used in this sketch");
        }
      }

      // Boost process skills based on compositionLevel
      const level = sketch.compositionLevel;
      if (level) {
        const levelSkills: Record<string, string[]> = {
          study: ["thumbnail-studies", "creative-constraints", "iterative-refinement"],
          sketch: ["iterative-refinement", "mark-making", "layering-strategy", "color-mixing-strategy"],
          developed: ["layering-strategy", "material-behavior", "atmospheric-depth", "color-mixing-strategy"],
          exhibition: ["layering-strategy", "material-behavior", "atmospheric-depth", "iterative-refinement", "mark-making"],
        };
        for (const id of levelSkills[level] ?? []) {
          const entry = scored.get(id);
          if (entry) {
            entry.score += 3;
            entry.reasons.push(`recommended for ${level}-level work`);
          }
        }
      }

      // Boost based on existing layers (painting-related skills)
      if (sketch.layers && sketch.layers.length > 0) {
        const layerTypes = sketch.layers.map((l) => l.type);
        if (layerTypes.some((t) => t.startsWith("painting:"))) {
          for (const id of ["layering-strategy", "material-behavior", "iterative-refinement"]) {
            const entry = scored.get(id);
            if (entry) {
              entry.score += 2;
              entry.reasons.push("sketch uses painting layers");
            }
          }
        }
      }
    }
  }

  // Score based on free-text context
  if (input.context) {
    const words = input.context.toLowerCase().split(/\W+/);
    for (const word of words) {
      const matched = CONTEXT_KEYWORDS[word];
      if (matched) {
        for (const skillId of matched) {
          const entry = scored.get(skillId);
          if (entry) {
            entry.score += 2;
            if (!entry.reasons.includes(`matches context keyword "${word}"`)) {
              entry.reasons.push(`matches context keyword "${word}"`);
            }
          }
        }
      }
    }
  }

  // If no context clues at all, boost process skills as general recommendations
  if (!input.sketchId && !input.context) {
    for (const skill of allSkills) {
      if (skill.category === "process") {
        const entry = scored.get(skill.id)!;
        entry.score += 2;
        entry.reasons.push("process knowledge is broadly applicable");
      }
    }
  }

  // Sort by score descending, take top 5
  const ranked = allSkills
    .map((skill) => ({
      id: skill.id,
      name: skill.name,
      category: skill.category,
      complexity: skill.complexity,
      description: skill.description,
      relevanceScore: scored.get(skill.id)!.score,
      rationale: scored.get(skill.id)!.reasons,
    }))
    .filter((s) => s.relevanceScore > 0)
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 5);

  return {
    success: true,
    suggestions: ranked,
    total: ranked.length,
  };
}
