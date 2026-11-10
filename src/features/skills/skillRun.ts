import {
  type AiMessage,
  type AiRule,
  type AiRunRequest,
  type AiRunResult,
  backend,
  isBackendError,
} from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { InvalidAnswer } from "../../lib/aiJson";
import { markText } from "../../lib/aiAccess";
import { createUniqueNote } from "../commands/actions";
import { folderScope } from "../ai/folderScope";
import { conversationMarkdown, type Turn } from "../ai/conversation";
import { created, group, record, type UndoStep } from "../filetree/undo";
import { giveAiIcon } from "./aiIcon";
import { folderOf, isDraft, suggestedFolder } from "../drafts/drafts";
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

export type { Turn } from "../ai/conversation";

export interface SkillRequestInput {
  skill: Skill;
  prompt: string;
  turns: Turn[];
  conversationRule?: AiRule;
  /** The note the block is in. */
  path: string;
  useNote: boolean;
  /** Notes to read instead of the block's note (a skill run on files picked in the tree). */
  sources?: string[];
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
  chat: "Start the conversation.",
  files: "Start or continue the course.",
};

/** Keep the sent prompt and a conversation's saved history identical. */
export const skillPrompt = (skill: Skill, prompt: string): string =>
  prompt.trim() || START[skill.output];

/** The notes a skill reads: its note, or every note in the note's folder. */
export function skillAttach(
  skill: Skill,
  path: string,
  useNote: boolean,
  sources?: string[],
): string[] {
  if (!useNote) return [];
  if (sources?.length) return [...sources];
  if (skill.reads !== "folder") return [path];
  const scope = folderScope(
    useAppStore.getState().notes,
    homeFolder(path),
    false,
    useConfig.getState().config.ai.folders,
  );
  return [...new Set([path, ...scope.include])];
}

export function skillRequest(o: SkillRequestInput): AiRunRequest {
  const sel = o.selectionText ? `Selected text:\n"""\n${o.selectionText}\n"""\n\n` : "";
  const ask = skillPrompt(o.skill, o.prompt);
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
    ...(o.skill.output === "chat" && o.turns.length ? { atLeast: o.conversationRule } : {}),
    attach: skillAttach(o.skill, o.path, o.useNote, o.sources),
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
  // What a skill makes keeps the privacy of the notes it read, wherever it's saved.
  const rule = result.rule;
  if (checked.html !== undefined)
    return { kind: "html", result, html: markText("page.html", checked.html, rule) };
  const files = checked.files!;
  return {
    kind: "files",
    result,
    files: {
      ...files,
      files: files.files.map((f) => ({ ...f, content: markText(f.path, f.content, rule) })),
    },
  };
}

// ---- Keeping what a skill made ----

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/**
 * Where a skill's results go: the note's folder, or for a draft (a skill run on files
 * picked in the tree) the folder it was made for, not the hidden drafts folder.
 */
export const homeFolder = (path: string) =>
  isDraft(path) ? suggestedFolder(path) : folderOf(path);

/**
 * Save something a skill made as a new file in `folder` under a free name, with the AI
 * icon; Ctrl+Z in the file tree takes it back while it's unchanged. Returns its path.
 */
export async function keepSkillFile(
  folder: string,
  name: string,
  content: string,
  ext: string,
): Promise<string> {
  const saved = await createUniqueNote(folder, name, content, ext);
  record(created(saved, content, `Save “${name}”`));
  await giveAiIcon([saved]);
  await useAppStore.getState().refreshTree();
  return saved;
}

/**
 * Save a chat skill's conversation (Grill me) next to its note, or update the file it
 * was saved to after an earlier reply. Marked with the rule of what it read.
 */
export async function saveConversation(
  path: string,
  skill: Skill,
  html: boolean,
  turns: Turn[],
  rule: AiRule,
  saved?: string[],
): Promise<string[]> {
  const ext = html ? ".html" : ".md";
  const content = markText(
    `conversation${ext}`,
    html ? transcriptHtml(skill, turns) : transcript(skill, turns),
    rule,
  );
  const existing = saved?.find((file) => file.endsWith(ext));
  if (existing) {
    await backend.writeFile(existing, content);
    return [existing, ...(saved ?? []).filter((p) => p !== existing)];
  }
  const note = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const file = await keepSkillFile(homeFolder(path), `${skill.title} - ${note}`, content, ext);
  return [file, ...(saved ?? [])];
}

/** Save a skill's web page next to its note, as "<note> - <skill>.html". */
export async function savePageNextTo(path: string, skill: Skill, html: string): Promise<string> {
  const note = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  // A note made for the run (a skill on picked files) is already named after the skill.
  const name = note.startsWith(`${skill.title} - `) ? note : `${note} - ${skill.title}`;
  return keepSkillFile(homeFolder(path), name, html, ".html");
}

/** Restore only a replacement whose contents still match this step. */
function replaced(path: string, before: string, after: string): UndoStep {
  return {
    label: `Update “${path}”`,
    async revert() {
      const current = await backend.readFile(path);
      if (current.content !== after)
        throw new Error(`“${path}” has changed since the lesson was saved.`);
      await backend.writeFile(path, before, current.modifiedMs);
      return replaced(path, after, before);
    },
  };
}

/** Only the private backup goes to the trash. Even a directory that appears
 * at the target during the save stays safe. */
async function saveLessonFile(
  target: string,
  file: SkillFile,
  root: string,
): Promise<UndoStep | null> {
  try {
    await backend.createFile(target, file.content, root);
    return created(target, file.content);
  } catch (e) {
    if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
  }

  const current = await backend.readFile(target).catch((e: unknown) => {
    if (isBackendError(e) && e.code === "NotFound")
      throw new Error(`Cannot save “${target}” over a folder. Rename the folder and retry.`);
    throw e;
  });
  if (current.content === file.content) return null;
  const backup = `.axisnotes/teach-${crypto.randomUUID()}-${file.path}`;
  await backend.createFile(backup, current.content, root);
  await backend.trashEntry(backup);
  await backend.writeFile(target, file.content, current.modifiedMs, root);
  return replaced(target, current.content, file.content);
}

/** Publish successful writes as they finish so a retry skips those files. */
export async function writeFiles(
  folder: string,
  files: SkillFile[],
  saved: string[],
  onSaved: (paths: string[]) => void,
): Promise<void> {
  const root = useAppStore.getState().vault?.root;
  if (!root) throw new Error("Open a vault to save the lesson.");
  const steps: UndoStep[] = [];
  const done = new Set(saved);
  try {
    for (const file of files) {
      const target = join(folder, file.path);
      if (done.has(target)) continue;
      const step = await saveLessonFile(target, file, root);
      if (step) steps.push(step);
      done.add(target);
      onSaved([...done]);
    }
  } finally {
    if (useAppStore.getState().vault?.root === root && done.size) {
      if (steps.length) record(group("Save lesson files", steps));
      await giveAiIcon([...done]);
      await useAppStore.getState().refreshTree();
    }
  }
}

/** A Grill me conversation as Markdown, for a draft. */
export function transcript(skill: Skill, turns: Turn[]): string {
  return conversationMarkdown(skill.title, turns);
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A turn's Markdown as simple HTML: paragraphs, lists, bold and inline code. */
function turnHtml(md: string): string {
  const inline = (t: string) =>
    escapeHtml(t)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  const out: string[] = [];
  let list: string[] | null = null;
  const flush = () => {
    if (list) out.push(`<ul>${list.map((i) => `<li>${i}</li>`).join("")}</ul>`);
    list = null;
  };
  for (const line of md.trim().split("\n")) {
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) (list ??= []).push(inline(item[1]!));
    else {
      flush();
      if (line.trim()) out.push(`<p>${inline(line.trim())}</p>`);
    }
  }
  flush();
  return out.join("\n");
}

/** A Grill me conversation as a self-contained web page, made here (not by the model). */
export function transcriptHtml(skill: Skill, turns: Turn[]): string {
  const title = escapeHtml(skill.title);
  const body = turns
    .map(
      (t) =>
        `<section class="${t.role === "user" ? "me" : "ai"}"><h2>${t.role === "user" ? "Me" : "AI"}</h2>\n${turnHtml(t.text)}</section>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root { color-scheme: light dark; --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --me: #eef2ff; --ai: #f6f8fa; }
@media (prefers-color-scheme: dark) { :root { --bg: #0d1117; --fg: #e6edf3; --muted: #8d96a0; --me: #1c2541; --ai: #161b22; } }
body { margin: 0 auto; max-width: 760px; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
h1 { font-size: 1.6rem; }
section { border-radius: 10px; padding: 8px 16px; margin: 12px 0; }
section.me { background: var(--me); }
section.ai { background: var(--ai); }
h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 8px 0 0; }
code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>
<h1>${title}</h1>
${body}
</body>
</html>
`;
}
