import type { Skill } from "./skills";

/** Human-chosen menu order. Categorization never changes a skill's ID or instructions. */
const CATEGORIES = [
  {
    name: "Learn & understand",
    ids: ["teach", "teach-the-ai", "example"],
  },
  { name: "Practice & remember", ids: ["test", "flashcards", "mnemonic", "make-it-stick"] },
  { name: "Visualize & present", ids: ["mindmap", "infographic", "slide-deck"] },
  { name: "Plan & collaborate", ids: ["grill-me", "handoff"] },
] as const;

export interface SkillGroup {
  name: string;
  skills: Skill[];
}

/** Keep overrides in their named category and unknown/custom skills available at the end. */
export function groupSkills(skills: readonly Skill[]): SkillGroup[] {
  const remaining = new Map(skills.map((skill) => [skill.id, skill]));
  const groups: SkillGroup[] = [];
  for (const category of CATEGORIES) {
    const found: Skill[] = [];
    for (const id of category.ids) {
      const skill = remaining.get(id);
      if (skill) {
        found.push(skill);
        remaining.delete(id);
      }
    }
    if (found.length) groups.push({ name: category.name, skills: found });
  }
  if (remaining.size) groups.push({ name: "Other skills", skills: [...remaining.values()] });
  return groups;
}

const SKILL_SECTION_PREFIX = "Skills · ";
export const skillSection = (category: string) => SKILL_SECTION_PREFIX + category;
export const skillSectionCategory = (section: string) =>
  section.startsWith(SKILL_SECTION_PREFIX) ? section.slice(SKILL_SECTION_PREFIX.length) : null;
