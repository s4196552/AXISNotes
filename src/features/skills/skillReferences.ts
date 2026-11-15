import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import type { Skill } from "./skills";

// What a vault skill brings along when it runs. Skills in the Agent Skills layout (like
// those made for Claude Code) keep reference files beside their SKILL.md and name other
// skills ("call the Skill tool with "grilling""). AXISNotes can't open files or call tools
// during a run, so those files and named skills go with the instructions instead.

/** At most this much reference text goes with one skill. */
export const MAX_REFERENCE_CHARS = 60_000;

const TEXT = /\.(md|markdown|txt)$/i;
const SKILL_FILE = /(^|\/)SKILL\.md$/i;
/** `call the Skill tool with "grilling"`, `… twice, for "grilling" and "domain-modeling"`. */
const NAMED = /Skill tool[^.\n]*/gi;
const QUOTED = /["`“]([a-z0-9][a-z0-9-]*)["`”]/gi;

const dirOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

/** Other skills the instructions tell the model to call, by name, in order. */
export function namedSkills(instructions: string): string[] {
  const names: string[] = [];
  for (const m of instructions.matchAll(NAMED))
    for (const q of m[0].matchAll(QUOTED)) {
      const id = q[1]!.toLowerCase();
      if (!names.includes(id)) names.push(id);
    }
  return names;
}

/** Text files beside a vault skill's SKILL.md (and one folder down), by vault path. */
export function referencePaths(skillPath: string, notes: readonly string[]): string[] {
  const dir = dirOf(skillPath);
  if (!dir) return [];
  return notes
    .filter((p) => {
      if (!p.startsWith(`${dir}/`) || SKILL_FILE.test(p) || !TEXT.test(p)) return false;
      return p.slice(dir.length + 1).split("/").length <= 2;
    })
    .sort();
}

const NO_TOOLS =
  "You can't run commands, open files, browse or call tools in this conversation. Where the skill says to call another skill, follow that skill: it is included below. Where it says to run commands, read or write files, or use an issue tracker, ask the user for what you need or tell them exactly what to do.";

/**
 * A vault skill's instructions with its reference files and the skills it names added
 * (within `MAX_REFERENCE_CHARS`). Built-in skills, and skills that need neither, are
 * returned unchanged.
 */
export async function withReferences(skill: Skill, all: readonly Skill[]): Promise<Skill> {
  if (skill.source === "built-in") return skill;
  const notes = useAppStore.getState().notes.map((n) => n.path);
  const files = referencePaths(skill.source, notes);
  const named = namedSkills(skill.instructions)
    .filter((id) => id !== skill.id)
    .map((id) => all.find((s) => s.id === id))
    .filter((s): s is Skill => !!s && s.id !== skill.id);
  if (!files.length && !named.length) return skill;
  const parts: string[] = [];
  let budget = MAX_REFERENCE_CHARS;
  const add = (heading: string, text: string) => {
    if (budget <= 0) return;
    const body = text.length > budget ? `${text.slice(0, budget)}\n\n[…cut short]` : text;
    budget -= body.length;
    parts.push(`## ${heading}\n\n${body.trim()}`);
  };
  for (const s of named) add(`Skill “${s.id}”`, s.instructions);
  const dir = dirOf(skill.source);
  for (const p of files) {
    try {
      add(`File ${p.slice(dir.length + 1)}`, (await backend.readFile(p)).content);
    } catch {
      // Removed meanwhile: leave it out.
    }
  }
  return {
    ...skill,
    instructions: `${skill.instructions}\n\n# Included with this skill\n\n${NO_TOOLS}\n\n${parts.join("\n\n")}`,
  };
}
