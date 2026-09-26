import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { type AxisConfig, useConfig } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { noteName, splitFrontmatter, withFrontmatter } from "../../lib/markdown";
import { getActiveEditor } from "../editor/activeEditor";
import { minimalChange } from "../editor/targets";
import {
  BUILTIN_TEMPLATES,
  promptsIn,
  renderTemplate,
  type Template,
} from "../templates/templates";
import { useUi } from "./ui";

// Actions shared by the command palette, keyboard shortcuts, `/` commands and the calendar.

const report = (e: unknown) =>
  useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));

/** Folder of the open note, or the vault root. */
export function currentFolder(): string {
  const p = useAppStore.getState().activePath;
  return p && p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
}

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Create `base.md` (or `base N.md`) in `folder` with `content`; returns the path. */
export async function createUniqueNote(
  folder: string,
  base: string,
  content: string,
): Promise<string> {
  for (let i = 0; i < 1000; i++) {
    const path = join(folder, `${i === 0 ? base : `${base} ${i}`}.md`);
    try {
      await backend.createFile(path, content);
      return path;
    } catch (e) {
      if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
    }
  }
  throw new Error("could not find a free note name");
}

const lineOfOffset = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

export async function newNote(title = "Untitled", folder = currentFolder()) {
  try {
    const path = await createUniqueNote(folder, title, "");
    await useAppStore.getState().refreshTree();
    useAppStore.getState().openFile(path);
  } catch (e) {
    report(e);
  }
}

// ---- Templates ----

export function listTemplates(): Template[] {
  const folder = useConfig.getState().config.templatesFolder.replace(/\/+$/, "");
  const user = useAppStore
    .getState()
    .notes.filter((n) => folder && n.path.startsWith(folder + "/"))
    .map((n) => ({ id: `note:${n.path}`, name: n.name, body: "", path: n.path }));
  return [...user, ...BUILTIN_TEMPLATES];
}

async function templateBody(t: Template): Promise<string> {
  return t.path ? (await backend.readFile(t.path)).content : t.body;
}

/** Ask for `{{prompt:...}}` answers; null if cancelled. */
async function answersFor(body: string): Promise<Record<string, string> | null> {
  const questions = promptsIn(body);
  if (questions.length === 0) return {};
  return useUi.getState().ask("Template", questions);
}

/** Insert a template at the cursor of the open note, merging its properties. */
export async function insertTemplate(t: Template) {
  const active = getActiveEditor();
  if (!active) return;
  try {
    const body = await templateBody(t);
    const answers = await answersFor(body);
    if (!answers) return;
    const { text, cursor } = renderTemplate(body, {
      title: noteName(active.path),
      now: new Date(),
      answers,
    });
    const fm = splitFrontmatter(text);
    const insertText = text.slice(fm.length);
    const { view } = active;
    const at = view.state.selection.main.head;
    view.dispatch({
      changes: { from: at, to: view.state.selection.main.to, insert: insertText },
      selection: { anchor: at + Math.max(0, cursor - fm.length) },
    });
    if (Object.keys(fm.props).length) {
      const doc = view.state.doc.toString();
      const merged = { ...splitFrontmatter(doc).props, ...fm.props };
      view.dispatch({ changes: minimalChange(doc, withFrontmatter(doc, merged)) });
    }
    view.focus();
  } catch (e) {
    report(e);
  }
}

/** Ask for a title and create a note from a template in the current folder. */
export async function newNoteFromTemplate(t: Template) {
  try {
    const body = await templateBody(t);
    const questions = ["Note title", ...promptsIn(body)];
    const answers = await useUi.getState().ask(`New note from “${t.name}”`, questions, {
      "Note title": "Untitled",
    });
    if (!answers) return;
    const title = (answers["Note title"] ?? "").trim() || "Untitled";
    const { text, cursor } = renderTemplate(body, { title, now: new Date(), answers });
    const path = await createUniqueNote(currentFolder(), title, text);
    await useAppStore.getState().refreshTree();
    useAppStore.getState().openFile(path, { line: lineOfOffset(text, cursor) });
  } catch (e) {
    report(e);
  }
}

// ---- Daily notes ----

export function dailyNotePath(
  date: Date,
  cfg: AxisConfig["dailyNotes"] = useConfig.getState().config.dailyNotes,
): string {
  const { folder, format } = cfg;
  return join(folder.replace(/^\/+|\/+$/g, ""), `${formatDate(date, format)}.md`);
}

/** Open the daily note for `date`, creating it from the daily template if needed. */
export async function openDailyNote(date = new Date()) {
  const store = useAppStore.getState();
  const path = dailyNotePath(date);
  try {
    if (!store.notes.some((n) => n.path === path)) {
      const cfg = useConfig.getState().config.dailyNotes;
      let body = BUILTIN_TEMPLATES.find((t) => t.id === "builtin:daily")!.body;
      if (cfg.template) {
        try {
          body = (await backend.readFile(cfg.template)).content;
        } catch {
          store.setError(`Daily note template not found: ${cfg.template}`);
        }
      }
      const { text, cursor } = renderTemplate(body, { title: noteName(path), now: date });
      try {
        await backend.createFile(path, text);
      } catch (e) {
        if (!(isBackendError(e) && e.code === "AlreadyExists")) throw e;
      }
      await store.refreshTree();
      useAppStore.getState().openFile(path, { line: lineOfOffset(text, cursor) });
      return;
    }
    store.openFile(path);
  } catch (e) {
    report(e);
  }
}
