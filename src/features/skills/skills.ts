import { create } from "zustand";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { splitFrontmatter } from "../../lib/markdown";
import { InvalidAnswer, parseAnswer } from "../../lib/aiJson";
import { BUILTIN_SKILL_FILES } from "./builtinSkills";
import { COPYABLE_RULE, makeCopyable } from "./copyable";
import { giveAiIcon } from "./aiIcon";
import { withReferences } from "./skillReferences";

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
  /** A set of skills it came with (`collection:` in its frontmatter), shown together. */
  collection?: string;
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
    ...(typeof p.collection === "string" && p.collection.trim()
      ? { collection: p.collection.trim() }
      : {}),
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
  const all = useSkills.getState().skills;
  const s = all.find((k) => k.id === id) ?? null;
  if (!s || s.source === "built-in") return s;
  let fresh = s;
  try {
    fresh = parseSkill((await backend.readFile(s.source)).content, s.source) ?? s;
  } catch {
    // Unreadable now: use what was loaded.
  }
  // Its reference files and the skills it names go with it (it can't open them itself).
  return withReferences(fresh, all);
}

// ---- Copying built-ins to the vault, and making a skill from a note ----

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Write each built-in skill to `Skills/<name>/SKILL.md` unless it's already there. */
export async function copyBuiltinsToVault(): Promise<number> {
  let added = 0;
  const made: string[] = [];
  for (const [id, text] of Object.entries(BUILTIN_SKILL_FILES)) {
    try {
      await backend.createFile(join(SKILLS_DIR, `${id}/SKILL.md`), text);
      made.push(join(SKILLS_DIR, id));
      added++;
    } catch (e) {
      if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
    }
  }
  // Skill folders show the AI icon in the file tree.
  await giveAiIcon(made);
  await useAppStore.getState().refreshTree();
  return added;
}

/** The SKILL.md text for a new skill. */
export function newSkillFile(o: {
  name: string;
  description: string;
  output: SkillOutput;
  folder: boolean;
  instructions: string;
}): string {
  return [
    "---",
    `name: ${skillId(o.name)}`,
    `title: ${JSON.stringify(o.name.trim())}`,
    `description: ${JSON.stringify(o.description.trim())}`,
    `output: ${o.output}`,
    `reads: ${o.folder ? "folder" : "note"}`,
    "---",
    o.instructions.trim(),
    "",
  ].join("\n");
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
      await giveAiIcon([target.slice(0, target.lastIndexOf("/"))]);
      await useAppStore.getState().refreshTree();
      return target;
    } catch (e) {
      if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
    }
  }
  throw new Error("Couldn't find a free name for the skill.");
}

// ---- What a skill asks the model for, and what comes back ----

// ---- Markdown or HTML ----

/** What a run makes: a Markdown note, an HTML page, or (Teach) both. */
export type SkillFormat = "markdown" | "html" | "both";

export const FORMAT_LABELS: Record<SkillFormat, string> = {
  markdown: "Markdown",
  html: "HTML",
  both: "Both",
};

/** The formats a skill can be run in. Every skill offers Markdown and HTML. */
export const formatsOf = (s: Skill): SkillFormat[] =>
  s.output === "files" ? ["both", "markdown", "html"] : ["markdown", "html"];

/** The format a skill runs in unless the user picks another. */
export const defaultFormat = (s: Skill): SkillFormat =>
  s.output === "html" ? "html" : s.output === "files" ? "both" : "markdown";

// A SKILL.md can say how to answer in each format, in sections headed "## Format: Markdown",
// "## Format: HTML" or "## Format: Both". The rest of the file is shared. When the chosen
// format has no section, a general instruction for that format is added instead.
const FORMAT_HEADING = /^##\s*format:\s*(markdown|html|both)\s*$/i;

function splitFormats(instructions: string): {
  shared: string;
  sections: Partial<Record<SkillFormat, string>>;
} {
  const shared: string[] = [];
  const sections: Partial<Record<SkillFormat, string[]>> = {};
  let current: string[] = shared;
  for (const line of instructions.split("\n")) {
    const m = FORMAT_HEADING.exec(line.trim());
    if (m) {
      current = sections[m[1]!.toLowerCase() as SkillFormat] = [];
    } else if (current !== shared && /^#{1,2}\s/.test(line)) {
      current = shared;
      shared.push(line);
    } else current.push(line);
  }
  const out: Partial<Record<SkillFormat, string>> = {};
  for (const [k, v] of Object.entries(sections)) out[k as SkillFormat] = v.join("\n").trim();
  return { shared: shared.join("\n").trim(), sections: out };
}

const GENERIC: Record<SkillFormat, string> = {
  markdown:
    "Answer in Markdown only (headings, lists, tables, callouts; no HTML). Reply with only the result, no introduction or closing remarks.",
  html: "Answer as one self-contained HTML page: one inline <style> and, if needed, one inline <script>; no external files, fonts, images or network requests, so it works offline when opened from disk. Readable on a phone, follows the system's light or dark mode, visible keyboard focus. Reply with only the HTML document, starting with <!doctype html>.",
  both: "",
};

// A skill that writes files keeps replying with its JSON object of files; the format
// says which kinds of file to write, never how to reply.
const GENERIC_FILES: Record<SkillFormat, string> = {
  markdown:
    "Write every file as a Markdown note (.md); don't write any .html file. Keep replying with the JSON object described above.",
  html: "Write the lesson or result files as self-contained HTML pages (.html): one inline <style> and, if needed, one inline <script>; no external files, fonts, images or network requests. Notes that track progress stay Markdown (.md). Keep replying with the JSON object described above.",
  both: "",
};

/**
 * The skill as it runs in `format`: its instructions keep the shared part and that
 * format's section, and a page/note skill makes a page or a note to match.
 */
export function withFormat(s: Skill, format: SkillFormat | null | undefined): Skill {
  const f = format && formatsOf(s).includes(format) ? format : defaultFormat(s);
  const { shared, sections } = splitFormats(s.instructions);
  const own = sections[f];
  // A conversation stays a conversation; its format is how it's kept (see `transcriptHtml`).
  const generic =
    s.output === "chat" || f === defaultFormat(s)
      ? ""
      : (s.output === "files" ? GENERIC_FILES : GENERIC)[f];
  const extra = own ?? generic;
  const instructions = extra ? `${shared}\n\n${extra}` : shared;
  const output: SkillOutput =
    s.output === "markdown" || s.output === "html"
      ? f === "html"
        ? "html"
        : "markdown"
      : s.output;
  return { ...s, output, instructions };
}

/** The system message for a run: the skill's instructions and the reply format. */
export function skillSystem(s: Skill): string {
  const base =
    "You are running a skill inside AXISNotes, a Markdown note-taking app. " +
    "The user's notes are attached. Follow the skill's instructions exactly.";
  // A page-making run is also told to leave its text copyable (makeCopyable enforces it).
  const pages = s.output === "html" || s.output === "files" ? `\n\n${COPYABLE_RULE}` : "";
  return `${base}${pages}\n\n# Skill: ${s.title}\n\n${s.instructions}`;
}

/**
 * The HTML document in a reply (code fences and chatter around it are dropped), with the
 * guard that keeps its text selectable and copyable.
 */
export function extractHtml(answer: string): string {
  const fenced = /```(?:html)?\s*\n([\s\S]*?)```/i.exec(answer);
  const body = fenced ? fenced[1]! : answer;
  const start = body.search(/<!doctype html|<html[\s>]/i);
  const end = body.toLowerCase().lastIndexOf("</html>");
  if (start === -1) throw new InvalidAnswer(["the reply has no HTML document (<!doctype html>…)"]);
  return makeCopyable((end > start ? body.slice(start, end + 7) : body.slice(start)).trim() + "\n");
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
    const content = f.content.endsWith("\n") ? f.content : `${f.content}\n`;
    return { path, content: /\.html?$/i.test(path) ? makeCopyable(content) : content };
  });
  if (problems.length) throw new InvalidAnswer(problems);
  return { message: v.message ?? "", files };
}
