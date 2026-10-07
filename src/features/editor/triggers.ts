import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import type { EditorView } from "@codemirror/view";
import { backend, type NoteRef, type PropertyKey } from "../../ipc";
import { useAppStore } from "../../app/store";
import { formatDate, parseDate } from "../../lib/dates";
import { type BlockChoice, ensureBlockId, listBlocks, newBlockId } from "../../lib/blocks";
import { isNotePath, LIST_PREFIX, noteName } from "../../lib/markdown";
import { renderTemplate } from "../templates/templates";
import { linkHost } from "./links";
import { notePath } from "./embeds";
import { editNote } from "../files/editNote";
import { escapeRe, quickCommandConfig } from "./quickCommands";
import { minimalChange } from "./targets";

// The typed menus besides commands and emoji, each with a configurable trigger:
//   @@  dates and notes        → [[Daily/2026-10-07|2026-10-07]] (📅 2026-10-07 on a task), [[Note]]
//   ((  blocks across the vault → [[Note#^id]] (adding the id to the block if needed)
//   ::  inline properties      → key:: (keys already used in the vault first)
//   {{  template variables     → {{date}} in templates, the value itself elsewhere
// Everything they insert is plain Markdown that Obsidian and other editors understand.

/** The trigger and what's been typed after it, at a line start or after a space. */
function matchTrigger(
  context: CompletionContext,
  trigger: string,
  body: string,
  max: number,
  before = "\\s([",
) {
  if (!trigger) return null;
  const re = new RegExp(`(^|[${before}])${escapeRe(trigger)}${body}{0,${max}}$`, "u");
  const m = context.matchBefore(re);
  if (!m) return null;
  // Skip the character before the trigger, if one was matched (a `(` before `((` is the
  // user's own, not part of the trigger).
  const start = m.from + (re.exec(m.text)?.[1]?.length ?? 0);
  const queryFrom = start + trigger.length;
  return { start, queryFrom, query: context.state.sliceDoc(queryFrom, context.pos) };
}

/**
 * How to write a link to `path`: its name, or its path (without `.md`) when another note
 * has the same name, so the link can't resolve to the wrong one.
 */
export function linkTargetFor(path: string, notes: readonly NoteRef[]): string {
  const name = noteName(path);
  const same = notes.filter((n) => n.name.toLowerCase() === name.toLowerCase()).length;
  return same > 1 ? path.replace(/\.md$/i, "") : name;
}

/** A link to the daily note for `date`, in its folder, showing just the date. */
export function dailyLink(date: Date, format: string, folder: string): string {
  const name = formatDate(date, format);
  const dir = folder.replace(/^\/+|\/+$/g, "");
  return dir ? `[[${dir}/${name}|${name}]]` : `[[${name}]]`;
}

/**
 * Replace from..to with `text`; the cursor goes `cursor` characters into it (default: the
 * end). No marker characters, so `|` in a link alias is kept.
 */
function put(view: EditorView, from: number, to: number, text: string, cursor = text.length) {
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + cursor },
  });
}

// ---- @@ dates and notes ----

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** The dates offered by `@@`, relative to `now`. */
export function mentionDates(now: Date): { label: string; date: Date }[] {
  const at = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const out = [
    { label: "Today", date: at(0) },
    { label: "Tomorrow", date: at(1) },
    { label: "Yesterday", date: at(-1) },
  ];
  for (let d = 1; d <= 7; d++) {
    const date = at(d);
    out.push({ label: `Next ${WEEKDAYS[date.getDay()]}`, date });
  }
  out.push({ label: "In a week", date: at(7) }, { label: "In two weeks", date: at(14) });
  return out;
}

const TASK_LINE_RE = /^\s*[-*+]\s+\[[ xX]\]\s/;

export function mentionCompletions(context: CompletionContext): CompletionResult | null {
  const cfg = context.state.facet(quickCommandConfig);
  const m = matchTrigger(context, cfg.mentionTrigger, "[\\p{L}\\p{N} _'.-]", 40);
  if (!m) return null;
  const { start } = m;
  const line = context.state.doc.lineAt(context.pos);
  const onTask = TASK_LINE_RE.test(line.text);
  // A daily-note link in the daily folder (following it creates the note from the daily
  // template), or the Tasks due date on a task line.
  const dateText = (date: Date) =>
    onTask
      ? `📅 ${formatDate(date, "YYYY-MM-DD")}`
      : dailyLink(date, cfg.dailyFormat, cfg.dailyFolder);
  const dates = mentionDates(new Date());
  // A typed date, e.g. @@2026-12-25.
  const date = typedDate(m.query.trim());
  if (date) dates.unshift({ label: m.query.trim(), date });
  const options: Completion[] = dates.map(({ label, date }) => ({
    label,
    detail: `${formatDate(date, "ddd D MMM YYYY")}${onTask ? " · due date" : ""}`,
    type: "constant",
    boost: 10,
    apply: (view, _c, _f, to) => put(view, start, to, dateText(date)),
  }));
  const notes = context.state.facet(linkHost).notes();
  for (const n of notes) {
    const folder = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "";
    options.push({
      label: n.name,
      detail: folder || "note",
      type: "text",
      apply: (view, _c, _f, to) => put(view, start, to, `[[${linkTargetFor(n.path, notes)}]]`),
    });
  }
  // Re-run for digits, so a date typed after the menu opened (@@2026-12-25) is offered.
  return { from: m.queryFrom, options, validFor: (text) => MENTION_TEXT.test(text) };
}

const MENTION_TEXT = /^[\p{L} _'.-][\p{L}\p{N} _'.-]*$|^$/u;

/** A real `YYYY-MM-DD` date (not one that rolls over, like 2026-02-30), or null. */
export function typedDate(text: string): Date | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? parseDate(text, "YYYY-MM-DD") : null;
}

// ---- (( blocks across the vault ----

const SEARCH_NOTES = 12;
const MAX_BLOCKS = 40;
const BLOCK_DEBOUNCE_MS = 120;

interface FoundBlock extends BlockChoice {
  path: string;
}

/** A block's text for the menu: Markdown marks removed, links shown as their text. */
export function blockPreview(s: string, n = 72): string {
  const plain = s
    .replace(/!?\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|~~|==|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > n ? plain.slice(0, n - 1) + "…" : plain;
}

/** Blocks whose text contains every word of `query` (current note first). */
async function findBlocks(
  query: string,
  current: { path: string; text: string; cursor: number },
): Promise<FoundBlock[]> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  // Match the whole block (a paragraph's later lines too); the label is just for display.
  const matches = (b: BlockChoice) => words.every((w) => b.text.toLowerCase().includes(w));
  // Not the block being typed in (it would link to itself).
  const own = listBlocks(current.text).filter((b, i, all) => {
    const next = all[i + 1]?.pos ?? Infinity;
    return !(current.cursor >= b.pos && current.cursor < next);
  });
  const out: FoundBlock[] = own.filter(matches).map((b) => ({ ...b, path: current.path }));
  if (words.length === 0) return out.slice(0, MAX_BLOCKS);
  const terms = words.map((w) => w.replace(/["()]/g, "")).filter(Boolean);
  if (terms.length === 0) return out;
  let hits: string[] = [];
  try {
    hits = (await backend.search(terms.join(" "), SEARCH_NOTES)).map((h) => h.path);
  } catch {
    // Search unavailable: offer this note's blocks only.
  }
  // Read the matching notes in parallel; keep the search order.
  const others = hits.filter((path) => path !== current.path && isNotePath(path));
  const contents = await Promise.all(
    others.map((path) =>
      backend.readFile(path).then(
        (f) => f.content,
        () => null, // Removed since it was indexed.
      ),
    ),
  );
  others.forEach((path, i) => {
    const content = contents[i];
    if (content == null) return;
    for (const b of listBlocks(content)) if (matches(b)) out.push({ ...b, path });
  });
  return out.slice(0, MAX_BLOCKS);
}

/**
 * Where block `b` is now in `text` (which may have changed since it was listed): the one
 * block with the same full text, or the one still at its old place if several have it.
 * Null if it's gone or can't be told apart, so an id never goes on the wrong block.
 */
export function relocateBlock(text: string, b: BlockChoice): BlockChoice | null {
  const same = listBlocks(text).filter((c) => c.text === b.text);
  if (same.length === 1) return same[0]!;
  return same.find((c) => c.pos === b.pos) ?? null;
}

/** Replace the first `from` text in the editor with `to` (no-op if it's not there). */
function replaceText(view: EditorView, from: string, to: string) {
  const at = view.state.doc.toString().indexOf(from);
  if (at !== -1) view.dispatch({ changes: { from: at, to: at + from.length, insert: to } });
}

/** Insert a link to block `b`, giving the block an id if it has none. */
async function linkBlock(view: EditorView, from: number, to: number, b: FoundBlock) {
  const current = view.state.facet(notePath);
  const store = useAppStore.getState();
  const target = linkTargetFor(b.path, view.state.facet(linkHost).notes());
  if (b.path === current) {
    // Same note: remove the typed `((query`, add the id, insert the link, all in one edit.
    const doc = view.state.doc.toString();
    const without = doc.slice(0, from) + doc.slice(to);
    const block = relocateBlock(without, { ...b, pos: b.pos > to ? b.pos - (to - from) : b.pos });
    if (!block) return;
    const r = block.id ? { text: without, id: block.id } : ensureBlockId(without, block.pos);
    if (!r) return;
    const added = minimalChange(without, r.text);
    const at = added.from < from ? from + (r.text.length - without.length) : from;
    const link = `[[${target}#^${r.id}]]`;
    const final = r.text.slice(0, at) + link + r.text.slice(at);
    view.dispatch({
      changes: minimalChange(doc, final),
      selection: { anchor: at + link.length },
    });
    return;
  }
  // Another note. Insert the link right away (with the id it will have), so nothing typed
  // meanwhile can be overwritten; then add that id to the block on disk.
  const typed = view.state.sliceDoc(from, to);
  const id = b.id ?? newBlockId();
  const link = `[[${target}#^${id}]]`;
  put(view, from, to, link);
  if (b.id) return;
  let problem: string | null = null;
  let linkedId = id;
  try {
    // editNote goes through the note's editor if it's open, and retries a changed file.
    await editNote(b.path, (text) => {
      const block = relocateBlock(text, b);
      const r = block && ensureBlockId(text, block.pos, () => id);
      problem = !block
        ? `that paragraph changed in ${noteName(b.path)}`
        : !r
          ? "that paragraph can't take an id"
          : null;
      if (!r) return null;
      linkedId = r.id;
      return r.text;
    });
  } catch (e) {
    problem = e instanceof Error ? e.message : String(e);
  }
  if (problem) {
    // Put back what was typed (if the link is still as inserted), so it can be retried.
    replaceText(view, link, typed);
    store.setError(`Couldn't link the block: ${problem}`);
  } else if (linkedId !== id) {
    // It got an id elsewhere in the meantime: link to that one instead.
    replaceText(view, link, `[[${target}#^${linkedId}]]`);
  }
}

export async function blockCompletions(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const cfg = context.state.facet(quickCommandConfig);
  const m = matchTrigger(context, cfg.blockTrigger, "[^()\\n]", 60, "\\s([");
  if (!m) return null;
  // Wait for a pause in typing: each query searches the vault and reads notes.
  if (m.query.trim()) {
    await new Promise((r) => setTimeout(r, BLOCK_DEBOUNCE_MS));
    if (context.aborted) return null;
  }
  const current = context.state.facet(notePath);
  const blocks = await findBlocks(m.query.trim(), {
    path: current,
    text: context.state.doc.toString(),
    cursor: context.pos,
  });
  if (context.aborted) return null;
  const { start } = m;
  return {
    from: m.queryFrom,
    filter: false,
    options: blocks.map<Completion>((b) => ({
      label: blockPreview(b.label),
      detail: `${b.path === current ? "this note" : b.path.replace(/\.md$/i, "")}${b.id ? "" : " · new id"}`,
      type: "text",
      // Returns the promise (CodeMirror ignores it; tests await it).
      apply: (view, _c, _f, to) => linkBlock(view, start, to, b),
    })),
  };
}

// ---- :: inline properties ----

let keyCache: { at: number; keys: PropertyKey[] } | null = null;
const KEY_CACHE_MS = 5000;

async function propertyKeys(): Promise<PropertyKey[]> {
  if (keyCache && Date.now() - keyCache.at < KEY_CACHE_MS) return keyCache.keys;
  try {
    keyCache = { at: Date.now(), keys: await backend.listPropertyKeys() };
  } catch {
    keyCache = { at: Date.now(), keys: [] };
  }
  return keyCache.keys;
}

/** Forget cached property keys (tests, and after a vault switch). */
export function clearPropertyKeyCache() {
  keyCache = null;
}

export async function propertyCompletions(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const cfg = context.state.facet(quickCommandConfig);
  if (!cfg.propertyTrigger) return null;
  // At the start of a line, list item or task (any form the indexer reads `key::` in).
  const m = context.matchBefore(
    new RegExp(
      String.raw`^[ \t]*${LIST_PREFIX}${escapeRe(cfg.propertyTrigger)}[\p{L}\p{N} _-]{0,40}$`,
      "u",
    ),
  );
  if (!m) return null;
  const start = m.from + m.text.lastIndexOf(cfg.propertyTrigger, m.text.length);
  const queryFrom = start + cfg.propertyTrigger.length;
  const query = context.state.sliceDoc(queryFrom, context.pos).trim();
  const keys = await propertyKeys();
  if (context.aborted) return null;
  // Our own matching and order (CodeMirror would rank a new key that equals the typed
  // text above an existing longer one): keys starting with the text, then containing
  // it, each most used first; a new key with the typed text last.
  const q = query.toLowerCase();
  const rank = (k: PropertyKey) => {
    const key = k.key.toLowerCase();
    return key.startsWith(q) ? 0 : key.includes(q) ? 1 : 2;
  };
  const options: Completion[] = keys
    .filter((k) => !["tags", "tag", "aliases", "alias"].includes(k.key) && rank(k) < 2)
    .sort((a, b) => rank(a) - rank(b) || b.count - a.count)
    .map((k) => ({
      label: k.key,
      detail: `${k.count} ${k.count === 1 ? "note" : "notes"}`,
      type: "property",
      apply: (view, _c, _f, to) => put(view, start, to, `${k.key}:: `),
    }));
  if (query && /^\p{L}/u.test(query) && !keys.some((k) => k.key.toLowerCase() === q)) {
    options.push({
      label: query,
      detail: "new property",
      type: "property",
      apply: (view, _c, _f, to) => put(view, start, to, `${query}:: `),
    });
  }
  return { from: queryFrom, options, filter: false };
}

// ---- {{ template variables ----

interface TemplateVar {
  name: string;
  label: string;
  /** Only meaningful inside a template (not filled in when typed in a note). */
  templateOnly?: boolean;
  /** Text inserted inside a template, and where the cursor goes in it. */
  insert?: string;
  cursor?: number;
}

export const TEMPLATE_VARS: TemplateVar[] = [
  { name: "title", label: "Note title" },
  { name: "date", label: "Date (YYYY-MM-DD)" },
  { name: "date:dddd, MMMM D, YYYY", label: "Date, long" },
  { name: "time", label: "Time (HH:mm)" },
  { name: "cursor", label: "Where the cursor starts", templateOnly: true },
  {
    name: "prompt",
    label: "Ask a question when inserted",
    templateOnly: true,
    insert: "{{prompt:}}",
    cursor: "{{prompt:".length,
  },
];

export function templateCompletions(context: CompletionContext): CompletionResult | null {
  const cfg = context.state.facet(quickCommandConfig);
  if (!cfg.templateTrigger) return null;
  const m = context.matchBefore(new RegExp(`${escapeRe(cfg.templateTrigger)}[\\w:, ]{0,30}$`));
  if (!m) return null;
  const start = m.from;
  const queryFrom = start + cfg.templateTrigger.length;
  const path = context.state.facet(notePath);
  const folder = cfg.templatesFolder.replace(/^\/+|\/+$/g, "");
  const inTemplate = !!folder && path.startsWith(folder + "/");
  // Swallow a `}}` already after the cursor (typed or auto-closed).
  const closeAfter = context.state.sliceDoc(context.pos, context.pos + 2) === "}}" ? 2 : 0;
  const now = new Date();
  const value = (name: string) =>
    renderTemplate(`{{${name}}}`, { title: noteName(path), now }).text;
  const options = TEMPLATE_VARS.filter((v) => inTemplate || !v.templateOnly).map<Completion>(
    (v) => ({
      label: v.name,
      displayLabel: `{{${v.name}}}`,
      detail: inTemplate ? v.label : `${v.label} → ${value(v.name)}`,
      type: "variable",
      apply: (view, _c, _f, to) => {
        const text = inTemplate ? (v.insert ?? `{{${v.name}}}`) : value(v.name);
        put(view, start, to + closeAfter, text, inTemplate ? v.cursor : undefined);
      },
    }),
  );
  return { from: queryFrom, options, validFor: /^[\w:, ]*$/ };
}
