/** The vault folder that holds skills (`Skills/<name>/SKILL.md`). */
export const SKILLS_DIR = "Skills";

/** A skill's id from its name: lower case, as typed after `/`. */
export const skillId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
