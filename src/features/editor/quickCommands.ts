import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { Facet, StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CustomQuickCommand } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { splitFrontmatter, withFrontmatter } from "../../lib/markdown";
import { PAGE_STYLE_PROP, type PageStyle } from "../templates/templates";
import { minimalChange } from "./targets";

// The command menu (Ctrl+/, or an optional typed trigger) and `:` emoji, with
// configurable triggers. The other typed menus (`@@`, `((`, `::`, `{{`) are in triggers.ts.

export interface QuickCommandConfig {
  /** Typed trigger for the command menu; "" = only Ctrl+/ opens it. */
  slashTrigger: string;
  emojiTrigger: string;
  mentionTrigger: string;
  blockTrigger: string;
  propertyTrigger: string;
  templateTrigger: string;
  disabled: string[];
  custom: CustomQuickCommand[];
  /** Daily note file-name format, for `@@today` links. */
  dailyFormat: string;
  /** Folder of user templates: `{{` inserts variables there, values elsewhere. */
  templatesFolder: string;
  /** Opens the template picker (host UI). */
  insertTemplate(): void;
  /** Runs an app command by id (host UI), e.g. "handwriting". */
  runCommand(id: string): void;
}

export const DEFAULT_QUICK_CONFIG: QuickCommandConfig = {
  slashTrigger: "",
  emojiTrigger: ":",
  mentionTrigger: "@@",
  blockTrigger: "((",
  propertyTrigger: "::",
  templateTrigger: "{{",
  disabled: [],
  custom: [],
  dailyFormat: "YYYY-MM-DD",
  templatesFolder: "Templates",
  insertTemplate: () => {},
  runCommand: () => {},
};

export const quickCommandConfig = Facet.define<QuickCommandConfig, QuickCommandConfig>({
  combine: (v) => v[0] ?? DEFAULT_QUICK_CONFIG,
});

// ---- Opening the command menu with a key (Ctrl+/) ----

const setMenuAnchor = StateEffect.define<number | null>();

/**
 * Where the key-opened command menu started, while it's open. What's typed after it
 * filters the menu, like typing after a `/` trigger. Cleared when the menu closes, the
 * cursor leaves the line, or a command runs.
 */
export const commandMenuAnchor = StateField.define<number | null>({
  create: () => null,
  update(anchor, tr) {
    for (const e of tr.effects) if (e.is(setMenuAnchor)) return e.value;
    if (anchor === null) return null;
    const at = tr.changes.mapPos(anchor, -1);
    const head = tr.state.selection.main.head;
    const doc = tr.state.doc;
    if (head < at || doc.lineAt(head).number !== doc.lineAt(at).number) return null;
    if (completionStatus(tr.startState) !== null && completionStatus(tr.state) === null) {
      return null;
    }
    return at;
  },
});

/** Open the command menu at the cursor (bound to Ctrl+/ by the `command-menu` command). */
export function openCommandMenu(view: EditorView) {
  view.focus();
  view.dispatch({ effects: setMenuAnchor.of(view.state.selection.main.head) });
  startCompletion(view);
}

interface SlashCommand {
  id: string;
  label: string;
  detail?: string;
  /** Replace the typed `/query` (from..to) with something. */
  run(view: EditorView, from: number, to: number, cfg: QuickCommandConfig): void;
}

/** Insert `text` at from..to; `|` in text marks the cursor (else the end). */
function insert(view: EditorView, from: number, to: number, text: string) {
  const at = text.indexOf("|");
  const clean = at === -1 ? text : text.slice(0, at) + text.slice(at + 1);
  view.dispatch({
    changes: { from, to, insert: clean },
    selection: { anchor: from + (at === -1 ? clean.length : at) },
  });
}

/** Replace the typed command and make the current line start with `prefix`. */
function linePrefix(prefix: string) {
  return (view: EditorView, from: number, to: number) => {
    const line = view.state.doc.lineAt(from);
    const before = view.state.sliceDoc(line.from, from).trimEnd();
    const after = view.state.sliceDoc(to, line.to).trimStart();
    const rest = (before && after ? `${before} ${after}` : before + after).replace(
      /^(#{1,6}\s|[-*+]\s(\[[ xX]\]\s)?|\d+\.\s|>\s)/,
      "",
    );
    const text = prefix + rest.trimStart();
    view.dispatch({
      changes: { from: line.from, to: line.to, insert: text },
      selection: { anchor: line.from + text.length },
    });
  };
}

function setPageStyle(style: PageStyle) {
  return (view: EditorView, from: number, to: number) => {
    view.dispatch({ changes: { from, to, insert: "" } });
    const doc = view.state.doc.toString();
    const props = { ...splitFrontmatter(doc).props };
    if (style === "plain") delete props[PAGE_STYLE_PROP];
    else props[PAGE_STYLE_PROP] = style;
    view.dispatch({ changes: minimalChange(doc, withFrontmatter(doc, props)) });
  };
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { id: "h1", label: "Heading 1", run: linePrefix("# ") },
  { id: "h2", label: "Heading 2", run: linePrefix("## ") },
  { id: "h3", label: "Heading 3", run: linePrefix("### ") },
  { id: "bullet", label: "Bulleted list", run: linePrefix("- ") },
  { id: "numbered", label: "Numbered list", run: linePrefix("1. ") },
  { id: "task", label: "Task", detail: "- [ ]", run: linePrefix("- [ ] ") },
  { id: "quote", label: "Quote", run: linePrefix("> ") },
  { id: "code", label: "Code block", run: (v, f, t) => insert(v, f, t, "```\n|\n```") },
  {
    id: "table",
    label: "Table",
    run: (v, f, t) => insert(v, f, t, "| Column | Column |\n| --- | --- |\n| | |"),
  },
  { id: "divider", label: "Divider", run: (v, f, t) => insert(v, f, t, "---\n") },
  { id: "callout", label: "Callout", run: (v, f, t) => insert(v, f, t, "> [!note]\n> |") },
  { id: "link", label: "Link to note", detail: "[[", run: (v, f, t) => insert(v, f, t, "[[|]]") },
  { id: "embed", label: "Embed note", detail: "![[", run: (v, f, t) => insert(v, f, t, "![[|]]") },
  {
    id: "template",
    label: "Insert template…",
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.insertTemplate();
    },
  },
  {
    id: "diagram",
    label: "Diagram…",
    detail: "AI or outline",
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.runCommand("diagram");
    },
  },
  {
    id: "mermaid",
    label: "Mermaid diagram (code)",
    run: (v, f, t) => insert(v, f, t, "```mermaid\nflowchart TD\n  A[Start] --> B|\n```"),
  },
  {
    id: "handwriting",
    label: "Handwriting to text…",
    detail: "pen",
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.runCommand("handwriting");
    },
  },
  {
    id: "date",
    label: "Today's date",
    detail: formatDate(new Date(), "YYYY-MM-DD"),
    run: (v, f, t) => insert(v, f, t, formatDate(new Date(), "YYYY-MM-DD")),
  },
  {
    id: "due",
    label: "Due date",
    detail: "📅 today",
    run: (v, f, t) => insert(v, f, t, `📅 ${formatDate(new Date(), "YYYY-MM-DD")}`),
  },
  {
    id: "priority-high",
    label: "Priority: high",
    detail: "⏫",
    run: (v, f, t) => insert(v, f, t, "⏫"),
  },
  {
    id: "priority-medium",
    label: "Priority: medium",
    detail: "🔼",
    run: (v, f, t) => insert(v, f, t, "🔼"),
  },
  {
    id: "priority-low",
    label: "Priority: low",
    detail: "🔽",
    run: (v, f, t) => insert(v, f, t, "🔽"),
  },
  {
    id: "time",
    label: "Current time",
    run: (v, f, t) => insert(v, f, t, formatDate(new Date(), "HH:mm")),
  },
  { id: "style-lined", label: "Page style: Lined", run: setPageStyle("lined") },
  { id: "style-dotted", label: "Page style: Dotted", run: setPageStyle("dotted") },
  { id: "style-grid", label: "Page style: Math grid", run: setPageStyle("math-grid") },
  { id: "style-cornell", label: "Page style: Cornell", run: setPageStyle("cornell") },
  { id: "style-plain", label: "Page style: Plain", run: setPageStyle("plain") },
];

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where the command menu's text starts: at the Ctrl+/ anchor, or after a typed trigger. */
function menuStart(context: CompletionContext, cfg: QuickCommandConfig) {
  const anchor = context.state.field(commandMenuAnchor, false) ?? null;
  if (anchor !== null && context.pos >= anchor) {
    const typed = context.state.sliceDoc(anchor, context.pos);
    if (/^[\w ]{0,24}$/.test(typed)) return { start: anchor, typedFrom: anchor };
  }
  if (!cfg.slashTrigger) return null;
  const m = context.matchBefore(new RegExp(`(^|\\s)${escapeRe(cfg.slashTrigger)}[\\w ]{0,24}$`));
  if (!m) return null;
  const start = m.from + (/^\s/.test(m.text) ? 1 : 0);
  return { start, typedFrom: start + cfg.slashTrigger.length };
}

export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const cfg = context.state.facet(quickCommandConfig);
  const at = menuStart(context, cfg);
  if (!at) return null;
  const { start, typedFrom } = at;
  // Once a command runs the menu is done, so typing afterwards doesn't reopen it.
  const done = (view: EditorView) => view.dispatch({ effects: setMenuAnchor.of(null) });
  const options: Completion[] = [
    ...SLASH_COMMANDS.filter((c) => !cfg.disabled.includes(c.id)).map((c) => ({
      label: c.label,
      detail: c.detail,
      type: "keyword",
      apply: (view: EditorView, _c: Completion, _f: number, to: number) => {
        done(view);
        c.run(view, start, to, cfg);
      },
    })),
    ...cfg.custom.map((c) => ({
      label: c.label,
      detail: "custom",
      type: "keyword",
      apply: (view: EditorView, _c: Completion, _f: number, to: number) => {
        done(view);
        insert(view, start, to, c.insert.replace("{{cursor}}", "|"));
      },
    })),
  ];
  return { from: typedFrom, options, validFor: /^[\w ]*$/ };
}

// ---- Emoji ----

type EmojiData = Record<string, string[]>;
let emojiData: EmojiData | null = null;
let emojiLoading: Promise<EmojiData> | null = null;

/** Load the emoji keyword table on first use (kept out of the startup bundle). */
export function loadEmoji(): Promise<EmojiData> {
  if (emojiData) return Promise.resolve(emojiData);
  emojiLoading ??= import("emojilib").then(
    (m) => (emojiData = (m.default ?? m) as unknown as EmojiData),
  );
  return emojiLoading;
}

/** Emoji whose name or keywords start with `query` (name matches first). */
export function searchEmoji(
  data: EmojiData,
  query: string,
  limit = 40,
): { emoji: string; name: string }[] {
  const q = query.toLowerCase();
  const byName: { emoji: string; name: string }[] = [];
  const byKeyword: { emoji: string; name: string }[] = [];
  for (const [emoji, words] of Object.entries(data)) {
    const name = words[0] ?? "";
    if (name.startsWith(q) || name.includes("_" + q)) byName.push({ emoji, name });
    else if (words.some((w) => w.startsWith(q))) byKeyword.push({ emoji, name });
    if (byName.length >= limit) break;
  }
  return [...byName, ...byKeyword].slice(0, limit);
}

export async function emojiCompletions(
  context: CompletionContext,
): Promise<CompletionResult | null> {
  const cfg = context.state.facet(quickCommandConfig);
  if (!cfg.emojiTrigger) return null;
  // Require two word characters so times like 10:30 don't trigger it.
  const m = context.matchBefore(
    new RegExp(`(^|[\\s(])${escapeRe(cfg.emojiTrigger)}[a-z0-9_+-]{2,}$`, "i"),
  );
  if (!m) return null;
  const start = m.from + (/^[\s(]/.test(m.text) ? 1 : 0);
  const query = context.state.sliceDoc(start + cfg.emojiTrigger.length, context.pos);
  const data = await loadEmoji();
  return {
    from: start,
    filter: false,
    options: searchEmoji(data, query).map(({ emoji, name }) => ({
      label: `${emoji}  ${name.replace(/_/g, " ")}`,
      apply: emoji,
      type: "text",
    })),
  };
}
