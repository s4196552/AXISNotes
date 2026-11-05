import { create } from "zustand";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { splitFrontmatter } from "../../lib/markdown";
import { InvalidAnswer, parseAnswer } from "../../lib/aiJson";
import { BUILTIN_SKILL_FILES } from "./builtinSkills";

// Skills: reusable instructions for the AI, run from the command menu (/mindmap,
// /flashcards…) with any provider and model. Each skill is a `SKILL.md`: YAML
// frontmatter (name, description, plus AXIS's `output` and `reads`) and the instructions.
// Built-in skills ship with the app; skills in the vault's `Skills/<name>/SKILL.md` add to
// them or replace a built-in of the same name, and stay editable plain Markdown.

export type SkillOutput = "markdown" | "html" | "chat" | "files";
export type SkillReads = "note" | "folder";

export interface Skill {
  /** Lower-case id from `name`, as typed after `/`. */
  id: string;
  title: string;
  description: string;
  output: SkillOutput;
  reads: SkillReads;
  instructions: string;
  /** "built-in", or the vault path of its SKILL.md. */
  source: string;
}

export const SKILLS_DIR = "Skills";
const SKILL_FILE = /(^|\/)SKILL\.md$/i;
const OUTPUTS: SkillOutput[] = ["markdown", "html", "chat", "files"];

export const skillId = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

const titleCase = (id: string) =>
  id
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");

/** A skill from a SKILL.md's text, or null if it has no name or instructions. */
export function parseSkill(text: string, source: string): Skill | null {
  const fm = splitFrontmatter(text);
  const p = fm.props as Record<string, unknown>;
  const folder = source.split("/").slice(-2, -1)[0] ?? "";
  const id = skillId(typeof p.name === "string" && p.name.trim() ? p.name : folder);
  const instructions = text.slice(fm.length).trim();
  if (!id || !instructions) return null;
  const output = OUTPUTS.includes(p.output as SkillOutput) ? (p.output as SkillOutput) : "markdown";
  return {
    id,
    title: typeof p.title === "string" && p.title.trim() ? p.title.trim() : titleCase(id),
    description: typeof p.description === "string" ? p.description.trim() : "",
    output,
    reads: p.reads === "folder" ? "folder" : "note",
    instructions,
    source,
  };
}

export const BUILTIN_SKILLS: Skill[] = Object.values(BUILTIN_SKILL_FILES)
  .map((t) => parseSkill(t, "built-in"))
  .filter((s): s is Skill => s !== null);

/** Built-ins, with vault skills added (a vault skill replaces a built-in of its name). */
export function mergeSkills(vault: Skill[]): Skill[] {
  const byId = new Map(BUILTIN_SKILLS.map((s) => [s.id, s]));
  for (const s of vault) byId.set(s.id, s);
  return [...byId.values()];
}

export const useSkills = create<{ skills: Skill[] }>(() => ({ skills: BUILTIN_SKILLS }));

/** SKILL.md notes in the vault, by path. */
const skillPaths = () =>
  useAppStore
    .getState()
    .notes.map((n) => n.path)
    .filter((p) => SKILL_FILE.test(p))
    .sort();

let watching = false;
let loaded = "";

/** Read the vault's skills again (when its SKILL.md notes change). */
export async function loadVaultSkills() {
  const paths = skillPaths();
  const vault: Skill[] = [];
  for (const p of paths) {
    try {
      const s = parseSkill((await backend.readFile(p)).content, p);
      if (s) vault.push(s);
    } catch {
      // Unreadable or removed meanwhile: skip it.
    }
  }
  useSkills.setState({ skills: mergeSkills(vault) });
}

/** The skills to offer, keeping them up to date with the vault from first use. */
export function skillList(): Skill[] {
  if (!watching) {
    watching = true;
    const sync = () => {
      const key = skillPaths().join("\n");
      if (key === loaded) return;
      loaded = key;
      void loadVaultSkills();
    };
    sync();
    useAppStore.subscribe((a, b) => a.notes !== b.notes && sync());
  }
  return useSkills.getState().skills;
}

/** A skill's latest text (a vault skill is read again, so edits apply right away). */
export async function freshSkill(id: string): Promise<Skill | null> {
  const s = useSkills.getState().skills.find((k) => k.id === id) ?? null;
  if (!s || s.source === "built-in") return s;
  try {
    return parseSkill((await backend.readFile(s.source)).content, s.source) ?? s;
  } catch {
    return s;
  }
}

// ---- Copying built-ins to the vault, and making a skill from a note ----

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Write each built-in skill to `Skills/<name>/SKILL.md` unless it's already there. */
export async function copyBuiltinsToVault(): Promise<number> {
  let added = 0;
  for (const [id, text] of Object.entries(BUILTIN_SKILL_FILES)) {
    try {
      await backend.createFile(join(SKILLS_DIR, `${id}/SKILL.md`), text);
      added++;
    } catch (e) {
      if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
    }
  }
  await useAppStore.getState().refreshTree();
  return added;
}

/** Turn a note into a skill: its text becomes the instructions. Returns the new path. */
export async function skillFromNote(path: string): Promise<string> {
  const text = (await backend.readFile(path)).content;
  const fm = splitFrontmatter(text);
  const body = text.slice(fm.length).trim();
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const id = skillId(name) || "my-skill";
  const firstLine = body.split(/\r?\n/).find((l) => l.trim() && !l.startsWith("#")) ?? "";
  const description = firstLine
    .replace(/[#*_`>"]/g, "")
    .trim()
    .slice(0, 140);
  const file = [
    "---",
    `name: ${id}`,
    `title: ${JSON.stringify(name)}`,
    `description: ${JSON.stringify(description || `Run the instructions from ${name}`)}`,
    "output: markdown",
    "reads: note",
    "---",
    body || "Follow the user's request using the note you were given.",
    "",
  ].join("\n");
  for (let i = 0; i < 100; i++) {
    const target = join(SKILLS_DIR, `${i === 0 ? id : `${id}-${i}`}/SKILL.md`);
    try {
      await backend.createFile(target, file);
      await useAppStore.getState().refreshTree();
      return target;
    } catch (e) {
      if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
    }
  }
  throw new Error("Couldn't find a free name for the skill.");
}

// ---- What a skill asks the model for, and what comes back ----

/** The system message for a run: the skill's instructions and the reply format. */
export function skillSystem(s: Skill): string {
  const base =
    "You are running a skill inside AXISNotes, a Markdown note-taking app. " +
    "The user's notes are attached. Follow the skill's instructions exactly.";
  return `${base}\n\n# Skill: ${s.title}\n\n${s.instructions}`;
}

/** The HTML document in a reply (code fences and chatter around it are dropped). */
export function extractHtml(answer: string): string {
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(answer);
  const body = fenced ? fenced[1]! : answer;
  const start = body.search(/<!doctype html|<html[\s>]/i);
  const end = body.toLowerCase().lastIndexOf("</html>");
  if (start === -1) throw new InvalidAnswer(["the reply has no HTML document (<!doctype html>…)"]);
  return (end > start ? body.slice(start, end + 7) : body.slice(start)).trim() + "\n";
}

export interface SkillFile {
  path: string;
  content: string;
}

export interface SkillFiles {
  message: string;
  files: SkillFile[];
}

const MAX_FILES = 12;
const MAX_FILE_BYTES = 512 * 1024;

/** Files a skill wants written, checked: plain names, .md or .html, sizes kept small. */
export function parseSkillFiles(answer: string): SkillFiles {
  const v = parseAnswer<{ message: string; files: SkillFile[] }>(answer, {
    type: "object",
    props: {
      message: { type: "string", optional: true },
      files: {
        type: "array",
        min: 1,
        max: MAX_FILES,
        items: {
          type: "object",
          props: { path: { type: "string" }, content: { type: "string" } },
        },
      },
    },
  });
  const problems: string[] = [];
  const seen = new Set<string>();
  const files = v.files.map((f, i) => {
    const path = f.path.trim().replace(/^\.\/+/, "");
    if (!/^[^/\\:*?"<>|]+\.(md|html?)$/i.test(path) || path.startsWith("."))
      problems.push(`files[${i}].path must be a plain file name ending in .md or .html`);
    if (seen.has(path.toLowerCase())) problems.push(`files[${i}].path repeats ${path}`);
    seen.add(path.toLowerCase());
    if (f.content.length > MAX_FILE_BYTES) problems.push(`files[${i}] is too large`);
    return { path, content: f.content.endsWith("\n") ? f.content : `${f.content}\n` };
  });
  if (problems.length) throw new InvalidAnswer(problems);
  return { message: v.message ?? "", files };
}
