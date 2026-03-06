import { describe, it, expect } from "vitest";
import { listSkills, loadSkill, getGuidelines } from "./knowledge.js";

describe("knowledge tools", () => {
  describe("list_skills", () => {
    it("returns all skills when no category filter", async () => {
      const result = await listSkills({});
      expect(result.success).toBe(true);
      expect(result.total).toBe(24);
      expect(result.skills).toHaveLength(24);
    });

    it("filters by composition category", async () => {
      const result = await listSkills({ category: "composition" });
      expect(result.success).toBe(true);
      expect(result.total).toBe(6);
      const skills = result.skills as Array<{ category: string }>;
      for (const skill of skills) {
        expect(skill.category).toBe("composition");
      }
    });

    it("filters by color category", async () => {
      const result = await listSkills({ category: "color" });
      expect(result.success).toBe(true);
      expect(result.total).toBe(6);
      const skills = result.skills as Array<{ category: string }>;
      for (const skill of skills) {
        expect(skill.category).toBe("color");
      }
    });

    it("returns empty for unknown category", async () => {
      const result = await listSkills({ category: "unknown" });
      expect(result.success).toBe(true);
      expect(result.total).toBe(0);
      expect(result.skills).toHaveLength(0);
    });

    it("each skill summary has required fields", async () => {
      const result = await listSkills({});
      const skills = result.skills as Array<Record<string, unknown>>;
      for (const skill of skills) {
        expect(skill.id).toBeTruthy();
        expect(skill.name).toBeTruthy();
        expect(skill.category).toBeTruthy();
        expect(skill.complexity).toBeTruthy();
        expect(skill.description).toBeTruthy();
      }
    });
  });

  describe("load_skill", () => {
    it("loads a known skill with full data", async () => {
      const result = await loadSkill({ skillId: "golden-ratio" });
      expect(result.success).toBe(true);
      const skill = result.skill as Record<string, unknown>;
      expect(skill.id).toBe("golden-ratio");
      expect(skill.name).toBe("Golden Ratio");
      expect(skill.category).toBe("composition");
      expect(skill.theory).toBeTruthy();
      expect((skill.principles as string[]).length).toBeGreaterThanOrEqual(3);
      expect((skill.references as unknown[]).length).toBeGreaterThanOrEqual(1);
    });

    it("returns error for unknown skill", async () => {
      const result = await loadSkill({ skillId: "nonexistent" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("Skill not found");
      expect(result.skill).toBeNull();
    });

    it("includes suggestedParameters when available", async () => {
      const result = await loadSkill({ skillId: "color-harmony" });
      expect(result.success).toBe(true);
      const skill = result.skill as Record<string, unknown>;
      const params = skill.suggestedParameters as unknown[];
      expect(params.length).toBeGreaterThan(0);
    });

    it("includes suggestedColors when available", async () => {
      const result = await loadSkill({ skillId: "color-harmony" });
      expect(result.success).toBe(true);
      const skill = result.skill as Record<string, unknown>;
      const colors = skill.suggestedColors as unknown[];
      expect(colors.length).toBeGreaterThan(0);
    });

    it("loads a color theory skill", async () => {
      const result = await loadSkill({ skillId: "simultaneous-contrast" });
      expect(result.success).toBe(true);
      const skill = result.skill as Record<string, unknown>;
      expect(skill.category).toBe("color");
      expect(skill.complexity).toBe("advanced");
    });
  });

  describe("get_guidelines", () => {
    it("returns composition guidelines", async () => {
      const result = await getGuidelines({ topic: "composition" });
      expect(result.success).toBe(true);
      expect(result.topic).toBe("composition");
      expect(result.guidelines).toBeTruthy();
      const skills = result.relatedSkills as Array<{ id: string }>;
      expect(skills.length).toBe(6);
    });

    it("returns color guidelines", async () => {
      const result = await getGuidelines({ topic: "color" });
      expect(result.success).toBe(true);
      expect(result.topic).toBe("color");
      expect(result.guidelines).toBeTruthy();
      const skills = result.relatedSkills as Array<{ id: string }>;
      expect(skills.length).toBe(6);
    });

    it("returns parameter guidelines (static)", async () => {
      const result = await getGuidelines({ topic: "parameters" });
      expect(result.success).toBe(true);
      expect(result.topic).toBe("parameters");
      expect(result.guidelines).toContain("Parameter Design");
      expect(result.relatedSkills).toEqual([]);
    });

    it("returns animation guidelines (static)", async () => {
      const result = await getGuidelines({ topic: "animation" });
      expect(result.success).toBe(true);
      expect(result.guidelines).toContain("Animation");
    });

    it("returns performance guidelines (static)", async () => {
      const result = await getGuidelines({ topic: "performance" });
      expect(result.success).toBe(true);
      expect(result.guidelines).toContain("Performance");
    });

    it("returns error for unknown topic", async () => {
      const result = await getGuidelines({ topic: "unknown" });
      expect(result.success).toBe(false);
      expect(result.error).toContain("No guidelines found");
    });

    it("maps palette topic to color category", async () => {
      const result = await getGuidelines({ topic: "palette" });
      expect(result.success).toBe(true);
      const skills = result.relatedSkills as Array<{ id: string }>;
      expect(skills.length).toBe(6);
    });
  });
});
