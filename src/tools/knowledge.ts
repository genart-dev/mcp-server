/**
 * Design knowledge tools.
 * list_skills, load_skill, get_guidelines
 */

import { createDefaultSkillRegistry } from "@genart-dev/core";

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
  };

  const category = categoryMap[topic];
  if (!category) {
    return {
      success: false,
      topic,
      error: `No guidelines found for topic: '${topic}'. Available topics: composition, color, parameters, animation, performance`,
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
