import { EditorSelection, type EditorState, type Line } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { insertCode } from "./code";
import { type CodeColor } from "./codeColors";
import { taggedCode } from "./inlineCodeLanguage";
import { toggleMark } from "./inlineMarks";
import { QUOTE_HEADER, SLASH_COMMANDS } from "./quickCommands";

// What the note's right-click menu does (T-288). With text selected an item acts on the
// selection: Format wraps it, Paragraph changes the selected lines, Insert turns them into
// the block. With no selection it acts at the caret, or on the caret's line. The marks and
// block Markdown are the ones the / commands and Ctrl+B already use.

/** Bold, italic, strikethrough and highlight: wrap the selection, or unwrap it. */
export const FORMAT_MARKS = {
  bold: "**",
  italic: "*",
  strikethrough: "~~",
  highlight: "==",
} as const;

export function formatSelection(view: EditorView, kind: keyof typeof FORMAT_MARKS): boolean {
  return toggleMark(view, FORMAT_MARKS[kind]);
}

// ---- Paragraph: lists, headings and quotes ----

export type LineKind = "bullet" | "numbered" | "task" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
export type ParagraphKind = LineKind | "quote";

/** A line's indent, its block Markdown (list marker, heading `#`s) and its kind. */
function parseLine(text: string): { indent: string; prefix: string; kind: ParagraphKind | null } {
  const indent = /^[ \t]*/.exec(text)![0];
  const rest = text.slice(indent.length);
  let m: RegExpExecArray | null;
  if ((m = /^(#{1,6})(?:[ \t]+|$)/.exec(rest)))
    return { indent, prefix: m[0], kind: `h${m[1]!.length}` as LineKind };
  if ((m = /^[-*+][ \t]+\[[ xX]\](?:[ \t]+|$)/.exec(rest)))
    return { indent, prefix: m[0], kind: "task" };
  if ((m = /^[-*+](?:[ \t]+|$)/.exec(rest)) && !/^([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(rest))
    return { indent, prefix: m[0], kind: "bullet" };
  if ((m = /^\d{1,9}[.)](?:[ \t]+|$)/.exec(rest)))
    return { indent, prefix: m[0], kind: "numbered" };
  if (/^>/.test(rest)) return { indent, prefix: "", kind: "quote" };
  return { indent, prefix: "", kind: null };
}

/** The lines the selection covers; a range ending at a line's start leaves that line out. */
function coveredLines(state: EditorState): Line[] {
  const out = new Map<number, Line>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    let last = state.doc.lineAt(r.to).number;
    if (!r.empty && last > first && state.doc.lineAt(r.to).from === r.to) last--;
    for (let n = first; n <= last; n++) out.set(n, state.doc.line(n));
  }
  return [...out.values()].sort((a, b) => a.number - b.number);
}

/** The kind every selected line with text has, or null when they differ or have none. */
export function paragraphKind(state: EditorState): ParagraphKind | null {
  const lines = coveredLines(state).filter((l) => l.text.trim());
  const kinds = new Set(lines.map((l) => parseLine(l.text).kind));
  return kinds.size === 1 ? [...kinds][0]! : null;
}

/** The block Markdown a line of `kind` starts with (the / command's), numbered from `n`. */
function prefixFor(kind: LineKind, n: number): string {
  if (kind === "numbered") return `${n}. `;
  const block = SLASH_COMMANDS.find((c) => c.id === kind)?.block;
  return block ? block("")[0] : "";
}

/**
 * Make the selected lines (or the caret's line) a list, task list or heading, or plain
 * text again when they all are one already: Heading 2 on a heading 2 removes it.
 */
export function toggleParagraph(view: EditorView, kind: ParagraphKind): boolean {
  if (kind === "quote") return toggleQuote(view);
  const { state } = view;
  const lines = coveredLines(state);
  const withText = lines.filter((l) => l.text.trim());
  const remove = withText.length > 0 && withText.every((l) => parseLine(l.text).kind === kind);
  const targets = withText.length ? withText : lines;
  let n = 0;
  const changes = targets.map((line) => {
    const { indent, prefix } = parseLine(line.text);
    const from = line.from + indent.length;
    const to = from + prefix.length;
    if (remove) return { from, to, insert: "" };
    n++;
    // Headings can't be indented (four spaces would make code); list items keep theirs.
    const heading = kind.startsWith("h");
    return { from: heading ? line.from : from, to, insert: prefixFor(kind, n) };
  });
  const set = state.changes(changes);
  view.dispatch({
    changes: set,
    selection: EditorSelection.create(
      state.selection.ranges.map((r) =>
        EditorSelection.range(set.mapPos(r.anchor, 1), set.mapPos(r.head, 1)),
      ),
      state.selection.mainIndex,
    ),
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

/** A quote's title line (`> [!NOTE] TITLE`): its title, or null for another line. */
const QUOTE_TITLE = /^[ \t]*>[ \t]*\[![\w-]+(?:\|[^\]]*)?\][+-]?[ \t]*(.*)$/;

/**
 * Quote: the selected lines (or the caret's line) go in the Quote block the / command
 * makes, `> [!NOTE] TITLE` with TITLE selected to type over. On a quote already, the
 * whole quote becomes plain lines again (an untouched TITLE line goes).
 */
function toggleQuote(view: EditorView): boolean {
  const { state } = view;
  const { doc } = state;
  const lines = coveredLines(state).filter(
    (l) => l.number >= doc.lineAt(state.selection.main.from).number,
  );
  const withText = lines.filter((l) => l.text.trim());
  const isQuote = (n: number) => /^[ \t]*>/.test(doc.line(n).text);
  if (withText.length && withText.every((l) => isQuote(l.number))) {
    let first = lines[0]!.number;
    let last = lines.at(-1)!.number;
    while (first > 1 && isQuote(first - 1)) first--;
    while (last < doc.lines && isQuote(last + 1)) last++;
    const out: string[] = [];
    for (let n = first; n <= last; n++) {
      const text = doc.line(n).text;
      const title = QUOTE_TITLE.exec(text);
      if (title) {
        if (title[1]!.trim() && title[1]!.trim() !== "TITLE") out.push(title[1]!.trim());
        continue;
      }
      out.push(text.replace(/^[ \t]*>[ \t]?/, ""));
    }
    const from = doc.line(first).from;
    const to = doc.line(last).to;
    view.dispatch({
      changes: { from, to, insert: out.join("\n") },
      selection: { anchor: from },
      userEvent: "input.format",
    });
    view.focus();
    return true;
  }
  const from = lines[0]!.from;
  const to = lines.at(-1)!.to;
  const body = lines.map((l) => (l.text.trim() ? `> ${l.text}` : ">"));
  if (!withText.length) body.splice(0, body.length, "> ");
  const text = [QUOTE_HEADER, ...body].join("\n");
  const titleAt = from + QUOTE_HEADER.indexOf("TITLE");
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.range(titleAt, titleAt + "TITLE".length),
    userEvent: "input.format",
  });
  view.focus();
  return true;
}

// ---- Format ▸ Color: the coloured-code tags (`green`text``, codeColors.ts) ----

/** Characters coloured code can't start with (inlineCodeLanguage.ts's CODE_START). */
const CANT_START = /[\s`,.;:!?)\]}'’]/;

/** The coloured span the main selection is in, if any. */
function colorSpanAt(state: EditorState) {
  const r = state.selection.main;
  const line = state.doc.lineAt(r.from);
  if (r.to > line.to) return null;
  return taggedCode(state, [line]).find((t) => t.color && t.from <= r.from && r.to <= t.to) ?? null;
}

/** The colour of the coloured text the selection or caret is in, or null. */
export function selectionColor(state: EditorState): CodeColor | null {
  return colorSpanAt(state)?.color ?? null;
}

/**
 * Colour the selection (each line of it) with `color`. In coloured text already, the
 * same colour takes the colour off and another colour replaces it. With no selection the
 * tag goes in at the caret, ready to type into.
 */
export function colorSelection(view: EditorView, color: CodeColor): boolean {
  const { state } = view;
  const span = colorSpanAt(state);
  if (span) {
    const r = state.selection.main;
    const tagFrom = span.from + 1;
    const tagTo = span.codeFrom - 1;
    const changes =
      span.color === color
        ? [
            { from: span.from, to: span.codeFrom },
            { from: span.codeTo, to: span.to },
          ]
        : [{ from: tagFrom, to: tagTo, insert: color }];
    const set = state.changes(changes);
    const clamp = (p: number) => Math.min(Math.max(p, span.codeFrom), span.codeTo);
    view.dispatch({
      changes: set,
      selection: EditorSelection.range(set.mapPos(clamp(r.anchor)), set.mapPos(clamp(r.head))),
      userEvent: "input.format",
    });
    view.focus();
    return true;
  }
  const open = `\`${color}\``;
  view.dispatch(
    state.changeByRange((range) => {
      if (range.empty)
        return {
          changes: { from: range.from, insert: `${open}\`\`` },
          range: EditorSelection.cursor(range.from + open.length),
        };
      const changes: { from: number; insert: string }[] = [];
      for (let pos = range.from; pos <= range.to;) {
        const line = state.doc.lineAt(pos);
        const a = Math.max(line.from, range.from);
        const b = Math.min(line.to, range.to);
        const text = state.sliceDoc(a, b);
        const from = a + (text.length - text.trimStart().length);
        const to = b - (text.length - text.trimEnd().length);
        const inner = state.sliceDoc(from, to);
        if (from < to && !CANT_START.test(inner[0]!) && !inner.includes("``"))
          changes.push({ from, insert: open }, { from: to, insert: "``" });
        if (line.to >= range.to) break;
        pos = line.to + 1;
      }
      const set = state.changes(changes);
      return {
        changes: set,
        range: EditorSelection.range(set.mapPos(range.from, 1), set.mapPos(range.to, -1)),
      };
    }),
    { userEvent: "input.format" },
  );
  view.focus();
  return true;
}

// ---- Insert: blocks ----

/**
 * Put `text` in place of lines first..last (the selection's), or on its own line after
 * the caret's line when that has text, with a blank line around it where it meets other
 * text. `select` is where to put the selection, as offsets in `text`.
 */
function putBlock(
  view: EditorView,
  text: string,
  select: [number, number],
  lines: { first: number; last: number } | null,
) {
  const { state } = view;
  const { doc } = state;
  const caretLine = doc.lineAt(state.selection.main.head);
  const replace =
    lines ?? (caretLine.text.trim() ? null : { first: caretLine.number, last: caretLine.number });
  let from: number, to: number, before: string, nextLine: number;
  if (replace) {
    from = doc.line(replace.first).from;
    to = doc.line(replace.last).to;
    before = replace.first > 1 && doc.line(replace.first - 1).text.trim() ? "\n" : "";
    nextLine = replace.last + 1;
  } else {
    from = to = caretLine.to;
    before = "\n\n";
    nextLine = caretLine.number + 1;
  }
  const after = nextLine <= doc.lines && doc.line(nextLine).text.trim() ? "\n" : "";
  const start = from + before.length;
  view.dispatch({
    changes: { from, to, insert: before + text + after },
    selection: EditorSelection.range(start + select[0], start + select[1]),
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
}

/** The selected lines' numbers and text, or null with nothing selected. */
function selectedLines(state: EditorState): { first: number; last: number; text: string[] } | null {
  if (state.selection.main.empty) return null;
  const lines = coveredLines(state).filter(
    (l) => l.number >= state.doc.lineAt(state.selection.main.from).number,
  );
  return {
    first: lines[0]!.number,
    last: lines.at(-1)!.number,
    text: lines.map((l) => l.text),
  };
}

const TABLE = "| Column | Column |\n| --- | --- |\n| | |";

/** Cells of a pasted row: split at tabs (from a spreadsheet) or at `|`. */
function cells(line: string): string[] {
  const t = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return (t.includes("\t") ? t.split("\t") : t.split("|")).map((c) => c.trim());
}

export type InsertKind = "footnote" | "table" | "callout" | "divider" | "code" | "math";

export function insertBlock(view: EditorView, kind: InsertKind): boolean {
  const { state } = view;
  const sel = selectedLines(state);
  switch (kind) {
    case "footnote":
      return insertFootnote(view);
    case "code":
      // The / command's code block: around the selection, else an empty one with the
      // caret where its language goes.
      if (sel) return insertCode(view, true);
      putBlock(view, "```\n```", [3, 3], null);
      return true;
    case "math": {
      if (!sel) {
        putBlock(view, "$$\n\n$$", [3, 3], null);
        return true;
      }
      const text = `$$\n${sel.text.join("\n")}\n$$`;
      putBlock(view, text, [3, text.length - 3], sel);
      return true;
    }
    case "callout": {
      const head = "> [!note]";
      if (!sel) {
        putBlock(view, `${head}\n> `, [head.length + 3, head.length + 3], null);
        return true;
      }
      const text = [head, ...sel.text.map((l) => (l.trim() ? `> ${l}` : ">"))].join("\n");
      putBlock(view, text, [head.length + 1, text.length], sel);
      return true;
    }
    case "divider":
      putBlock(view, "---", [3, 3], sel ? { first: sel.last + 1, last: sel.last } : null);
      return true;
    case "table": {
      if (!sel) {
        putBlock(view, TABLE, [2, 8], null);
        return true;
      }
      const rows = sel.text.filter((l) => l.trim()).map(cells);
      if (!rows.length) {
        putBlock(view, TABLE, [2, 8], sel);
        return true;
      }
      const width = Math.max(...rows.map((r) => r.length));
      const line = (r: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      const text = [
        line(rows[0]!),
        `| ${Array(width).fill("---").join(" | ")} |`,
        ...rows.slice(1).map(line),
      ].join("\n");
      putBlock(view, text, [text.length, text.length], sel);
      return true;
    }
  }
}

/**
 * A footnote: `[^n]` after the selection (or at the caret), and its `[^n]: ` line at the
 * end of the note, where the caret goes to write it.
 */
function insertFootnote(view: EditorView): boolean {
  const { state } = view;
  const doc = state.doc.toString();
  const used = [...doc.matchAll(/\[\^(\d+)\]/g)].map((m) => Number(m[1]));
  const n = Math.max(0, ...used) + 1;
  const ref = `[^${n}]`;
  const at = state.selection.main.to;
  const lastLine = state.doc.line(state.doc.lines).text;
  const sep = /^\[\^[^\]]+\]:/.test(lastLine)
    ? "\n"
    : doc.endsWith("\n\n") || !doc
      ? ""
      : doc.endsWith("\n")
        ? "\n"
        : "\n\n";
  const def = `${sep}${ref}: `;
  view.dispatch({
    changes: [
      { from: at, insert: ref },
      { from: doc.length, insert: def },
    ],
    selection: { anchor: doc.length + ref.length + def.length },
    scrollIntoView: true,
    userEvent: "input",
  });
  view.focus();
  return true;
}

// ---- Clipboard ----

/** What Cut and Copy take: the selection, or the caret's line with nothing selected. */
export function copyRange(state: EditorState): { from: number; to: number; text: string } {
  const r = state.selection.main;
  if (!r.empty) return { from: r.from, to: r.to, text: state.sliceDoc(r.from, r.to) };
  const line = state.doc.lineAt(r.head);
  return { from: line.from, to: line.to, text: line.text };
}

/** Remove what Cut took: the selection, or the whole caret line with its line break. */
export function cutRange(view: EditorView) {
  const { state } = view;
  const r = state.selection.main;
  let { from, to } = copyRange(state);
  if (r.empty) {
    if (to < state.doc.length) to++;
    else if (from > 0) from--;
  }
  view.dispatch({ changes: { from, to }, selection: { anchor: from }, userEvent: "delete.cut" });
  view.focus();
}

/** Put `text` over the selection (or at the caret). */
export function pasteText(view: EditorView, text: string) {
  view.dispatch(view.state.replaceSelection(text), {
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  view.focus();
}

/**
 * Text without its formatting, for "Paste as plain text": HTML tags, Markdown marks
 * (bold, italic, strikethrough, highlight, code), links (their text), headings and
 * quote markers go; the words, line breaks and list markers stay.
 */
export function plainText(text: string): string {
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    "#39": "'",
    nbsp: " ",
  };
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-zA-Z][^<>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|apos|#39|nbsp);/g, (_, e: string) => entities[e]!)
    .split("\n")
    .map((line) =>
      line
        .replace(/^(\s*)(?:>\s?)+/, "$1")
        .replace(/^(\s*)\[![\w-]+(?:\|[^\]]*)?\][+-]?\s*/, "$1")
        .replace(/^(\s*)#{1,6}\s+/, "$1")
        .replace(/`[A-Za-z][\w+#.-]*`(?=[^\s`])(.*?)``/g, "$1")
        .replace(/(`+)(.+?)\1/g, "$2")
        .replace(/!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t: string, a?: string) =>
          (a ?? t).trim(),
        )
        .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
        .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, "$2")
        .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, "$1")
        .replace(/==(?=\S)(.+?)(?<=\S)==/g, "$1")
        .replace(/(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, "$1")
        .replace(/(?<!\w)_(?=\S)(.+?)(?<=\S)_(?!\w)/g, "$1")
        .replace(/\\([\\`*_{}[\]()#+\-.!=~|>])/g, "$1"),
    )
    .join("\n");
}
