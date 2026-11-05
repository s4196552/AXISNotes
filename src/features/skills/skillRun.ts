import {
  type AiMessage,
  type AiRunRequest,
  type AiRunResult,
  backend,
  isBackendError,
} from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { InvalidAnswer } from "../../lib/aiJson";
import { createUniqueNote } from "../commands/actions";
import { folderScope } from "../ai/folderScope";
import { folderOf } from "../drafts/drafts";
import {
  extractHtml,
  parseSkillFiles,
  type Skill,
  type SkillFile,
  type SkillFiles,
  skillSystem,
} from "./skills";

// Running a skill from an AI block: what the request reads and asks for, and checking
// what comes back (an HTML page, or the files a Teach session writes).

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface SkillRequestInput {
  skill: Skill;
  prompt: string;
  turns: Turn[];
  /** The note the block is in. */
  path: string;
  useNote: boolean;
  selectionText?: string;
  choice: { provider?: string; model?: string; effort: AiRunRequest["effort"] };
}

const text = (role: AiMessage["role"], t: string): AiMessage => ({
  role,
  content: [{ type: "text", text: t }],
});

/** The first user message when the user typed nothing. */
const START: Record<Skill["output"], string> = {
  markdown: "Run the skill on the attached notes.",
  html: "Run the skill on the attached notes.",
  chat: "Start the interview.",
  files: "Start or continue the course.",
};

/** The notes a skill reads: its note, or every note in the note's folder. */
export function skillAttach(skill: Skill, path: string, useNote: boolean): string[] {
  if (!useNote) return [];
  if (skill.reads !== "folder") return [path];
  const scope = folderScope(
    useAppStore.getState().notes,
    folderOf(path),
    false,
    useConfig.getState().config.ai.folders,
  );
  return [...new Set([path, ...scope.include])];
}

export function skillRequest(o: SkillRequestInput): AiRunRequest {
  const sel = o.selectionText ? `Selected text:\n"""\n${o.selectionText}\n"""\n\n` : "";
  const ask = o.prompt.trim() || START[o.skill.output];
  const messages: AiMessage[] = [text("system", skillSystem(o.skill))];
  if (o.skill.output === "chat") {
    o.turns.forEach((t, i) => messages.push(text(t.role, i === 0 ? sel + t.text : t.text)));
    messages.push(text("user", o.turns.length ? ask : sel + ask));
  } else messages.push(text("user", sel + ask));
  return {
    task: "chat",
    effort: o.choice.effort,
    provider: o.choice.provider,
    model: o.choice.model,
    messages,
    attach: skillAttach(o.skill, o.path, o.useNote),
    sources: o.selectionText ? [o.path] : [],
    ...(o.skill.output === "files" ? { json: true } : {}),
    // Pages and lessons are long.
    ...(o.skill.output === "html" || o.skill.output === "files" ? { maxOutputTokens: 16000 } : {}),
  };
}

export type SkillOutcome =
  | { kind: "text"; result: AiRunResult }
  | { kind: "html"; result: AiRunResult; html: string }
  | { kind: "files"; result: AiRunResult; files: SkillFiles };

/**
 * Run a skill's request. For a page or files, the answer is checked; if it doesn't fit,
 * the model is asked once more with the problems.
 */
export async function runSkill(
  skill: Skill,
  request: AiRunRequest,
  onRun: (runId: string) => void,
  onDelta: (d: string) => void,
): Promise<SkillOutcome> {
  const attempt = async (req: AiRunRequest) => {
    const runId = crypto.randomUUID();
    onRun(runId);
    return backend.aiRun(runId, req, onDelta);
  };
  const first = await attempt(request);
  if (skill.output !== "html" && skill.output !== "files") return { kind: "text", result: first };
  const parse = (answer: string): { html?: string; files?: SkillFiles } =>
    skill.output === "html" ? { html: extractHtml(answer) } : { files: parseSkillFiles(answer) };
  let checked: { html?: string; files?: SkillFiles };
  let result = first;
  try {
    checked = parse(first.text);
  } catch (e) {
    if (!(e instanceof InvalidAnswer)) throw e;
    result = await attempt({
      ...request,
      messages: [
        ...request.messages,
        text("assistant", first.text),
        text(
          "user",
          `That reply can't be used: ${e.problems.join("; ")}. Reply again, following the format exactly.`,
        ),
      ],
    });
    checked = parse(result.text);
  }
  return checked.html !== undefined
    ? { kind: "html", result, html: checked.html }
    : { kind: "files", result, files: checked.files! };
}

// ---- Keeping what a skill made ----

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Save a skill's web page next to its note, as "<note> - <skill>.html". */
export async function savePageNextTo(path: string, skill: Skill, html: string): Promise<string> {
  const note = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const saved = await createUniqueNote(folderOf(path), `${note} - ${skill.title}`, html, ".html");
  await useAppStore.getState().refreshTree();
  return saved;
}

export interface PlannedFile extends SkillFile {
  /** Its vault path in the workspace folder. */
  target: string;
  /** A file of that name is already there and would be replaced. */
  replaces: boolean;
}

/** Where each file would go in `folder`, and which ones already exist. */
export function planFiles(folder: string, files: SkillFile[]): PlannedFile[] {
  const existing = new Set<string>();
  const walk = (e: { path: string; kind: string; children?: { path: string; kind: string }[] }) => {
    for (const c of e.children ?? []) {
      if (c.kind === "file") existing.add(c.path.toLowerCase());
      else walk(c as never);
    }
  };
  const tree = useAppStore.getState().tree;
  if (tree) walk(tree);
  return files.map((f) => {
    const target = join(folder, f.path);
    return { ...f, target, replaces: existing.has(target.toLowerCase()) };
  });
}

/** Write a skill's files into the folder (replacing ones it updates, like Progress.md). */
export async function writeFiles(files: PlannedFile[]): Promise<void> {
  for (const f of files) {
    try {
      await backend.createFile(f.target, f.content);
    } catch (e) {
      if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
      await backend.writeFile(f.target, f.content);
    }
  }
  await useAppStore.getState().refreshTree();
}

/** A Grill me conversation as Markdown, for a draft. */
export function transcript(skill: Skill, turns: Turn[]): string {
  const lines = [`# ${skill.title}`, ""];
  for (const t of turns) lines.push(`**${t.role === "user" ? "Me" : "AI"}:** ${t.text.trim()}`, "");
  return `${lines.join("\n").trim()}\n`;
}
