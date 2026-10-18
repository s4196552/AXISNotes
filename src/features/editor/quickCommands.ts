import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { Facet, StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  AlignJustify,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  Clock,
  File,
  FileInput,
  Grid3x3,
  Grip,
  Heading1,
  Heading2,
  Heading3,
  Info,
  LayoutTemplate,
  Link,
  List,
  ListOrdered,
  ListTodo,
  type LucideIcon,
  Network,
  PanelLeft,
  PenLine,
  SeparatorHorizontal,
  SquareCode,
  Table,
  TextQuote,
  Workflow,
  Zap,
} from "lucide-react";
import type { CustomQuickCommand } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { splitFrontmatter, withFrontmatter } from "../../lib/markdown";
import { PAGE_STYLE_PROP, type PageStyle } from "../templates/templates";
import { lucideSvg } from "./lucideSvg";
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
  /** Daily note file-name format and folder, for `@@today` links. */
  dailyFormat: string;
  dailyFolder: string;
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
  dailyFolder: "Daily",
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
  icon: LucideIcon;
  /** The Markdown that does the same thing, shown on the right (like Notion's `#`). */
  markdown?: string;
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
  { id: "h1", label: "Heading 1", icon: Heading1, markdown: "#", run: linePrefix("# ") },
  { id: "h2", label: "Heading 2", icon: Heading2, markdown: "##", run: linePrefix("## ") },
  { id: "h3", label: "Heading 3", icon: Heading3, markdown: "###", run: linePrefix("### ") },
  { id: "bullet", label: "Bulleted list", icon: List, markdown: "-", run: linePrefix("- ") },
  {
    id: "numbered",
    label: "Numbered list",
    icon: ListOrdered,
    markdown: "1.",
    run: linePrefix("1. "),
  },
  { id: "task", label: "Task", icon: ListTodo, markdown: "- [ ]", run: linePrefix("- [ ] ") },
  { id: "quote", label: "Quote", icon: TextQuote, markdown: ">", run: linePrefix("> ") },
  {
    id: "code",
    label: "Code block",
    icon: SquareCode,
    markdown: "```",
    run: (v, f, t) => insert(v, f, t, "```\n|\n```"),
  },
  {
    id: "table",
    label: "Table",
    icon: Table,
    markdown: "|",
    run: (v, f, t) => insert(v, f, t, "| Column | Column |\n| --- | --- |\n| | |"),
  },
  {
    id: "divider",
    label: "Divider",
    icon: SeparatorHorizontal,
    markdown: "---",
    run: (v, f, t) => insert(v, f, t, "---\n"),
  },
  {
    id: "callout",
    label: "Callout",
    icon: Info,
    markdown: "> [!note]",
    run: (v, f, t) => insert(v, f, t, "> [!note]\n> |"),
  },
  {
    id: "link",
    label: "Link to note",
    icon: Link,
    markdown: "[[",
    run: (v, f, t) => insert(v, f, t, "[[|]]"),
  },
  {
    id: "embed",
    label: "Embed note",
    icon: FileInput,
    markdown: "![[",
    run: (v, f, t) => insert(v, f, t, "![[|]]"),
  },
  {
    id: "template",
    label: "Insert template…",
    icon: LayoutTemplate,
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.insertTemplate();
    },
  },
  {
    id: "diagram",
    label: "Diagram…",
    icon: Workflow,
    detail: "AI or outline",
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.runCommand("diagram");
    },
  },
  {
    id: "mermaid",
    label: "Mermaid diagram (code)",
    icon: Network,
    markdown: "```mermaid",
    run: (v, f, t) => insert(v, f, t, "```mermaid\nflowchart TD\n  A[Start] --> B|\n```"),
  },
  {
    id: "handwriting",
    label: "Handwriting to text…",
    icon: PenLine,
    detail: "pen",
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.runCommand("handwriting");
    },
  },
  {
    id: "date",
    label: "Today's date",
    icon: CalendarDays,
    detail: formatDate(new Date(), "YYYY-MM-DD"),
    run: (v, f, t) => insert(v, f, t, formatDate(new Date(), "YYYY-MM-DD")),
  },
  {
    id: "due",
    label: "Due date",
    icon: CalendarClock,
    detail: "today",
    markdown: "📅",
    run: (v, f, t) => insert(v, f, t, `📅 ${formatDate(new Date(), "YYYY-MM-DD")}`),
  },
  {
    id: "priority-high",
    label: "Priority: high",
    icon: ChevronsUp,
    markdown: "⏫",
    run: (v, f, t) => insert(v, f, t, "⏫"),
  },
  {
    id: "priority-medium",
    label: "Priority: medium",
    icon: ChevronUp,
    markdown: "🔼",
    run: (v, f, t) => insert(v, f, t, "🔼"),
  },
  {
    id: "priority-low",
    label: "Priority: low",
    icon: ChevronDown,
    markdown: "🔽",
    run: (v, f, t) => insert(v, f, t, "🔽"),
  },
  {
    id: "time",
    label: "Current time",
    icon: Clock,
    run: (v, f, t) => insert(v, f, t, formatDate(new Date(), "HH:mm")),
  },
  {
    id: "style-lined",
    label: "Page style: Lined",
    icon: AlignJustify,
    run: setPageStyle("lined"),
  },
  { id: "style-dotted", label: "Page style: Dotted", icon: Grip, run: setPageStyle("dotted") },
  {
    id: "style-grid",
    label: "Page style: Math grid",
    icon: Grid3x3,
    run: setPageStyle("math-grid"),
  },
  {
    id: "style-cornell",
    label: "Page style: Cornell",
    icon: PanelLeft,
    run: setPageStyle("cornell"),
  },
  { id: "style-plain", label: "Page style: Plain", icon: File, run: setPageStyle("plain") },
];

/**
 * The command menu's sections, in order, like Notion's. While something is typed the
 * matches are ranked by how well they match, under one "Filtered results" header.
 */
export const COMMAND_GROUPS: { name: string; ids: string[] }[] = [
  {
    name: "Basic blocks",
    ids: [
      "h1",
      "h2",
      "h3",
      "bullet",
      "numbered",
      "task",
      "quote",
      "code",
      "table",
      "divider",
      "callout",
    ],
  },
  { name: "Links", ids: ["link", "embed"] },
  {
    name: "Insert",
    ids: ["date", "time", "due", "priority-high", "priority-medium", "priority-low", "template"],
  },
  { name: "Diagrams and pen", ids: ["diagram", "mermaid", "handwriting"] },
  {
    name: "Page style",
    ids: ["style-plain", "style-lined", "style-dotted", "style-grid", "style-cornell"],
  },
];
const CUSTOM_GROUP = "Custom";
const FILTERED: CompletionSection = { name: "Filtered results", rank: 0 };

const placeOf = new Map(
  COMMAND_GROUPS.flatMap((g, rank) =>
    g.ids.map((id, order) => [id, { section: { name: g.name, rank }, order }] as const),
  ),
);

/** A command-menu option: carries its icon and Markdown hint for `commandMenuRender`. */
interface CommandCompletion extends Completion {
  commandIcon: LucideIcon;
  markdown?: string;
}

const isCommand = (c: Completion): c is CommandCompletion => "commandIcon" in c;

/**
 * Draws the command menu's icons (in place of CodeMirror's type glyph, hidden for the
 * `command` type) and the right-aligned Markdown hint. Pass to `autocompletion({ addToOptions })`.
 */
export const commandMenuRender = [
  {
    position: 20,
    render(c: Completion) {
      if (!isCommand(c)) return null;
      const span = document.createElement("span");
      span.className = "cm-commandIcon";
      span.append(lucideSvg(c.commandIcon));
      return span;
    },
  },
  {
    position: 90,
    render(c: Completion) {
      if (!isCommand(c) || !c.markdown) return null;
      const kbd = document.createElement("kbd");
      kbd.className = "cm-commandMarkdown";
      kbd.textContent = c.markdown;
      return kbd;
    },
  },
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
  // Nothing typed: Notion-style sections in their set order. Typed: one ranked list. The
  // result is only reused while that stays true, so the layout switches as you type.
  const filtering = context.state.sliceDoc(typedFrom, context.pos).trim() !== "";
  const place = (section: CompletionSection, order: number) =>
    filtering ? { section: FILTERED } : { section, boost: -order };
  const custom: CompletionSection = { name: CUSTOM_GROUP, rank: COMMAND_GROUPS.length };
  const options: CommandCompletion[] = [
    ...SLASH_COMMANDS.filter((c) => !cfg.disabled.includes(c.id)).map((c) => {
      const at = placeOf.get(c.id) ?? { section: custom, order: 0 };
      return {
        label: c.label,
        detail: c.detail,
        markdown: c.markdown,
        commandIcon: c.icon,
        type: "command",
        ...place(at.section, at.order),
        apply: (view: EditorView, _c: Completion, _f: number, to: number) => {
          done(view);
          c.run(view, start, to, cfg);
        },
      };
    }),
    ...cfg.custom.map((c, i) => ({
      label: c.label,
      detail: "custom",
      commandIcon: Zap,
      type: "command",
      ...place(custom, i),
      apply: (view: EditorView, _c: Completion, _f: number, to: number) => {
        done(view);
        insert(view, start, to, c.insert.replace("{{cursor}}", "|"));
      },
    })),
  ];
  const validFor = (typed: string) => /^[\w ]*$/.test(typed) && (typed.trim() !== "") === filtering;
  return { from: typedFrom, options, validFor };
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
