import {
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSection,
  completionStatus,
  startCompletion,
} from "@codemirror/autocomplete";
import { type EditorState, Facet, StateEffect, StateField } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import {
  AlignJustify,
  CalendarClock,
  CalendarDays,
  ChevronDown,
  ChevronRight,
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
  ListCollapse,
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
  Type,
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

type CommandIcon = LucideIcon | readonly [LucideIcon, LucideIcon];

/** Text before and after the cursor in a block: `[before, after]`. */
type BlockText = readonly [string, string];

interface SlashCommand {
  id: string;
  label: string;
  /** One icon, or a small one before a larger one (e.g. ▸ H1 for a toggle heading). */
  icon: CommandIcon;
  /** One line under the label saying what the command does. */
  description: string;
  /** The Markdown that does the same thing, shown on the right (like Notion's `#`). */
  markdown?: string;
  /**
   * A block type: the Markdown for a block holding `text`, split at the cursor. Block
   * commands start a new line below one that already has text, and offer "Turn into" to
   * change the current line instead (both like Notion).
   */
  block?: (text: string) => BlockText;
  /** Replace the typed `/query` (from..to) with something. Block commands don't need one. */
  run?(view: EditorView, from: number, to: number, cfg: QuickCommandConfig): void;
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

/** The Markdown that makes a line a block: heading, list item, task, quote, callout or toggle. */
const BLOCK_PREFIX =
  /^(>\s*\[![\w-]+(?:\|[^\]]*)?\][+-]?\s?|#{1,6}\s|[-*+]\s(\[[ xX]\]\s)?|\d+\.\s|>\s)/;

/**
 * The current line without the command typed into it (from..to): `kept` as written, and
 * `text` with its block Markdown removed.
 */
function lineAround(state: EditorState, from: number, to: number) {
  const line = state.doc.lineAt(from);
  const raw = state.sliceDoc(line.from, from);
  const after = state.sliceDoc(to, line.to).trim();
  const join = (a: string) => (a && after ? `${a} ${after}` : a + after);
  // The block Markdown is stripped before trimming, so a bare "- " counts as empty.
  return { line, kept: join(raw.trimEnd()), text: join(raw.replace(BLOCK_PREFIX, "").trim()) };
}

/** Write a block over `from..to` with the cursor at the split. */
function putBlock(view: EditorView, from: number, to: number, [head, tail]: BlockText) {
  view.dispatch({
    changes: { from, to, insert: head + tail },
    selection: { anchor: from + head.length },
  });
}

/** Turn into: the current line becomes the block, keeping its text. */
function turnInto(view: EditorView, from: number, to: number, block: SlashCommand["block"] & {}) {
  const { line, text } = lineAround(view.state, from, to);
  putBlock(view, line.from, line.to, block(text));
}

/** A new block: on a new line below a line with text, else in place of the (empty) line. */
function newBlock(view: EditorView, from: number, to: number, block: SlashCommand["block"] & {}) {
  const { line, kept, text } = lineAround(view.state, from, to);
  if (!text) return putBlock(view, line.from, line.to, block(""));
  const [head, tail] = block("");
  putBlock(view, line.from, line.to, [`${kept}\n${head}`, tail]);
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

const prefixed =
  (prefix: string) =>
  (t: string): BlockText => [prefix + t, ""];

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "text",
    label: "Text",
    icon: Type,
    description: "Plain paragraph text",
    block: prefixed(""),
  },
  {
    id: "h1",
    label: "Heading 1",
    icon: Heading1,
    description: "Largest section heading",
    markdown: "#",
    block: prefixed("# "),
  },
  {
    id: "h2",
    label: "Heading 2",
    icon: Heading2,
    description: "Medium section heading",
    markdown: "##",
    block: prefixed("## "),
  },
  {
    id: "h3",
    label: "Heading 3",
    icon: Heading3,
    description: "Smallest section heading",
    markdown: "###",
    block: prefixed("### "),
  },
  {
    id: "bullet",
    label: "Bulleted list",
    icon: List,
    description: "A list with bullet points",
    markdown: "-",
    block: prefixed("- "),
  },
  {
    id: "numbered",
    label: "Numbered list",
    icon: ListOrdered,
    description: "A list numbered 1, 2, 3",
    markdown: "1.",
    block: prefixed("1. "),
  },
  {
    id: "task",
    label: "Task",
    icon: ListTodo,
    description: "A checkbox you can tick off",
    markdown: "- [ ]",
    block: prefixed("- [ ] "),
  },
  {
    id: "toggle",
    label: "Toggle list",
    icon: ListCollapse,
    description: "Lines you can show or hide",
    markdown: "> [!toggle]",
    block: prefixed("> [!toggle]+ "),
  },
  {
    id: "quote",
    label: "Quote",
    icon: TextQuote,
    description: "Set text apart as a quote",
    markdown: ">",
    block: prefixed("> "),
  },
  {
    id: "callout",
    label: "Callout",
    icon: Info,
    description: "A highlighted box for a note or tip",
    markdown: "> [!note]",
    block: prefixed("> [!note]\n> "),
  },
  {
    id: "code",
    label: "Code block",
    icon: SquareCode,
    description: "A block of code",
    markdown: "```",
    block: (t) => ["```\n" + t, "\n```"],
  },
  {
    id: "table",
    label: "Table",
    icon: Table,
    description: "Rows and columns",
    markdown: "|",
    run: (v, f, t) => insert(v, f, t, "| Column | Column |\n| --- | --- |\n| | |"),
  },
  {
    id: "divider",
    label: "Divider",
    icon: SeparatorHorizontal,
    description: "A line between sections",
    markdown: "---",
    run: (v, f, t) => insert(v, f, t, "---\n"),
  },
  {
    id: "toggle-h1",
    label: "Toggle heading 1",
    icon: [ChevronRight, Heading1],
    description: "Large heading that hides what's under it",
    markdown: "> [!toggle|h1]",
    block: prefixed("> [!toggle|h1]+ "),
  },
  {
    id: "toggle-h2",
    label: "Toggle heading 2",
    icon: [ChevronRight, Heading2],
    description: "Medium heading that hides what's under it",
    markdown: "> [!toggle|h2]",
    block: prefixed("> [!toggle|h2]+ "),
  },
  {
    id: "toggle-h3",
    label: "Toggle heading 3",
    icon: [ChevronRight, Heading3],
    description: "Small heading that hides what's under it",
    markdown: "> [!toggle|h3]",
    block: prefixed("> [!toggle|h3]+ "),
  },
  {
    id: "link",
    label: "Link to note",
    icon: Link,
    description: "Link to another note",
    markdown: "[[",
    run: (v, f, t) => insert(v, f, t, "[[|]]"),
  },
  {
    id: "embed",
    label: "Embed note",
    icon: FileInput,
    description: "Show another note or block here",
    markdown: "![[",
    run: (v, f, t) => insert(v, f, t, "![[|]]"),
  },
  {
    id: "template",
    label: "Insert template…",
    icon: LayoutTemplate,
    description: "Fill in one of your templates",
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.insertTemplate();
    },
  },
  {
    id: "diagram",
    label: "Diagram…",
    icon: Workflow,
    description: "Draw one with AI or from an outline",
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.runCommand("diagram");
    },
  },
  {
    id: "mermaid",
    label: "Mermaid diagram (code)",
    icon: Network,
    description: "Write a diagram as Mermaid code",
    markdown: "```mermaid",
    run: (v, f, t) => insert(v, f, t, "```mermaid\nflowchart TD\n  A[Start] --> B|\n```"),
  },
  {
    id: "handwriting",
    label: "Handwriting to text…",
    icon: PenLine,
    description: "Write with a pen, then turn it into text",
    run: (v, f, t, cfg) => {
      v.dispatch({ changes: { from: f, to: t, insert: "" } });
      cfg.runCommand("handwriting");
    },
  },
  {
    id: "date",
    label: "Today's date",
    icon: CalendarDays,
    get description() {
      return `Insert ${formatDate(new Date(), "YYYY-MM-DD")}`;
    },
    run: (v, f, t) => insert(v, f, t, formatDate(new Date(), "YYYY-MM-DD")),
  },
  {
    id: "due",
    label: "Due date",
    icon: CalendarClock,
    description: "Make a task due today",
    markdown: "📅",
    run: (v, f, t) => insert(v, f, t, `📅 ${formatDate(new Date(), "YYYY-MM-DD")}`),
  },
  {
    id: "priority-high",
    label: "Priority: high",
    icon: ChevronsUp,
    description: "Mark a task as high priority",
    markdown: "⏫",
    run: (v, f, t) => insert(v, f, t, "⏫"),
  },
  {
    id: "priority-medium",
    label: "Priority: medium",
    icon: ChevronUp,
    description: "Mark a task as medium priority",
    markdown: "🔼",
    run: (v, f, t) => insert(v, f, t, "🔼"),
  },
  {
    id: "priority-low",
    label: "Priority: low",
    icon: ChevronDown,
    description: "Mark a task as low priority",
    markdown: "🔽",
    run: (v, f, t) => insert(v, f, t, "🔽"),
  },
  {
    id: "time",
    label: "Current time",
    icon: Clock,
    description: "Insert the time now",
    run: (v, f, t) => insert(v, f, t, formatDate(new Date(), "HH:mm")),
  },
  {
    id: "style-lined",
    label: "Page style: Lined",
    icon: AlignJustify,
    description: "Ruled lines behind the note",
    run: setPageStyle("lined"),
  },
  {
    id: "style-dotted",
    label: "Page style: Dotted",
    icon: Grip,
    description: "A dot grid behind the note",
    run: setPageStyle("dotted"),
  },
  {
    id: "style-grid",
    label: "Page style: Math grid",
    icon: Grid3x3,
    description: "Graph paper behind the note",
    run: setPageStyle("math-grid"),
  },
  {
    id: "style-cornell",
    label: "Page style: Cornell",
    icon: PanelLeft,
    description: "Cue column, notes and summary",
    run: setPageStyle("cornell"),
  },
  {
    id: "style-plain",
    label: "Page style: Plain",
    icon: File,
    description: "No background",
    run: setPageStyle("plain"),
  },
];

/**
 * The command menu's sections, in order, like Notion's. While something is typed the
 * matches are ranked by how well they match, under one "Filtered results" header.
 */
export const COMMAND_GROUPS: { name: string; ids: string[] }[] = [
  {
    name: "Basic blocks",
    ids: [
      "text",
      "h1",
      "h2",
      "h3",
      "bullet",
      "numbered",
      "task",
      "toggle",
      "quote",
      "callout",
      "code",
      "table",
      "divider",
      "toggle-h1",
      "toggle-h2",
      "toggle-h3",
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
export const TURN_INTO = "Turn into";

const placeOf = new Map(
  COMMAND_GROUPS.flatMap((g, rank) =>
    g.ids.map((id, order) => [id, { section: { name: g.name, rank }, order }] as const),
  ),
);

/** A command-menu option: carries its icon, description and Markdown hint for `commandMenuRender`. */
interface CommandCompletion extends Completion {
  commandIcon: CommandIcon;
  description: string;
  markdown?: string;
}

const isCommand = (c: Completion): c is CommandCompletion => "commandIcon" in c;

/**
 * Draws the command menu's icons (in place of CodeMirror's type glyph, hidden for the
 * `command` type), the description under the label and the right-aligned Markdown hint.
 * Pass to `autocompletion({ addToOptions })`.
 */
export const commandMenuRender = [
  {
    position: 20,
    render(c: Completion) {
      if (!isCommand(c)) return null;
      const span = document.createElement("span");
      span.className = "cm-commandIcon";
      if (Array.isArray(c.commandIcon)) {
        const [small, main] = c.commandIcon as readonly [LucideIcon, LucideIcon];
        span.append(lucideSvg(small, 10), lucideSvg(main));
      } else span.append(lucideSvg(c.commandIcon as LucideIcon));
      return span;
    },
  },
  {
    position: 60,
    render(c: Completion) {
      if (!isCommand(c) || !c.description) return null;
      const div = document.createElement("div");
      div.className = "cm-commandDescription";
      div.textContent = c.description;
      return div;
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
  const option = (
    c: Pick<SlashCommand, "label" | "icon" | "description" | "markdown">,
    placed: Partial<Completion>,
    run: (view: EditorView, to: number) => void,
  ): CommandCompletion => ({
    label: c.label,
    description: c.description,
    markdown: c.markdown,
    commandIcon: c.icon,
    type: "command",
    ...placed,
    apply: (view: EditorView, _c: Completion, _f: number, to: number) => {
      done(view);
      run(view, to);
    },
  });
  // Nothing typed: Notion-style sections in their set order. Typed: one ranked list. The
  // result is only reused while that stays true, so the layout switches as you type.
  const filtering = context.state.sliceDoc(typedFrom, context.pos).trim() !== "";
  const place = (section: CompletionSection, order: number) =>
    filtering ? { section: FILTERED } : { section, boost: -order };
  const custom: CompletionSection = { name: CUSTOM_GROUP, rank: COMMAND_GROUPS.length };
  // Turn into: offered while filtering, when the line already has text to keep.
  const turnable = filtering && lineAround(context.state, start, context.pos).text !== "";
  const commands = SLASH_COMMANDS.filter((c) => !cfg.disabled.includes(c.id));
  // Each Turn into follows its command with the same score; the sort keeps that order.
  const options: CommandCompletion[] = [
    ...commands.flatMap((c) => {
      const at = placeOf.get(c.id) ?? { section: custom, order: 0 };
      const block = c.block;
      const main = option(c, place(at.section, at.order), (view, to) =>
        block ? newBlock(view, start, to, block) : c.run?.(view, start, to, cfg),
      );
      if (!turnable || !block) return [main];
      const turn = option(
        { ...c, description: "Change this line, keeping its text" },
        { section: FILTERED, detail: TURN_INTO },
        (view, to) => turnInto(view, start, to, block),
      );
      return [main, turn];
    }),
    ...cfg.custom.map((c, i) =>
      option(
        { label: c.label, icon: Zap, description: c.insert.replace("{{cursor}}", "").trim() },
        place(custom, i),
        (view, to) => insert(view, start, to, c.insert.replace("{{cursor}}", "|")),
      ),
    ),
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
