import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { CustomQuickCommand } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { splitFrontmatter, withFrontmatter } from "../../lib/markdown";
import { PAGE_STYLE_PROP, type PageStyle } from "../templates/templates";
import { minimalChange } from "./targets";

// `/` commands and `:` emoji, with configurable triggers.

export interface QuickCommandConfig {
  slashTrigger: string;
  emojiTrigger: string;
  disabled: string[];
  custom: CustomQuickCommand[];
  /** Opens the template picker (host UI). */
  insertTemplate(): void;
}

export const quickCommandConfig = Facet.define<QuickCommandConfig, QuickCommandConfig>({
  combine: (v) =>
    v[0] ?? {
      slashTrigger: "/",
      emojiTrigger: ":",
      disabled: [],
      custom: [],
      insertTemplate: () => {},
    },
});

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
    id: "date",
    label: "Today's date",
    detail: formatDate(new Date(), "YYYY-MM-DD"),
    run: (v, f, t) => insert(v, f, t, formatDate(new Date(), "YYYY-MM-DD")),
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

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function slashCompletions(context: CompletionContext): CompletionResult | null {
  const cfg = context.state.facet(quickCommandConfig);
  if (!cfg.slashTrigger) return null;
  const m = context.matchBefore(new RegExp(`(^|\\s)${escapeRe(cfg.slashTrigger)}[\\w ]{0,24}$`));
  if (!m) return null;
  const start = m.from + (/^\s/.test(m.text) ? 1 : 0);
  const typedFrom = start + cfg.slashTrigger.length;
  const options: Completion[] = [
    ...SLASH_COMMANDS.filter((c) => !cfg.disabled.includes(c.id)).map((c) => ({
      label: c.label,
      detail: c.detail,
      type: "keyword",
      apply: (view: EditorView, _c: Completion, _f: number, to: number) =>
        c.run(view, start, to, cfg),
    })),
    ...cfg.custom.map((c) => ({
      label: c.label,
      detail: "custom",
      type: "keyword",
      apply: (view: EditorView, _c: Completion, _f: number, to: number) =>
        insert(view, start, to, c.insert.replace("{{cursor}}", "|")),
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
