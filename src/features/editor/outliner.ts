import { foldService } from "@codemirror/language";
import type { EditorState, Line, TransactionSpec } from "@codemirror/state";

// Outliner operations on plain Markdown: list items (with their nested children) and
// heading sections can be indented, outdented, moved among siblings, folded and dragged.
// Everything is computed from line text, so the file stays ordinary Markdown.

const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])([ \t]+|$)/;
const HEADING_RE = /^(#{1,6})[ \t]/;

/** Visual width of leading whitespace (tabs count as 4). */
function indentWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

export interface ListItem {
  kind: "list";
  /** Line numbers (1-based) of the item's first and last line (children included). */
  first: number;
  last: number;
  indent: number;
  /** Column where the item's text starts (children indent to at least this). */
  contentCol: number;
}

export interface Section {
  kind: "heading";
  first: number;
  last: number;
  level: number;
}

export type Block = ListItem | Section;

function isBlank(line: Line) {
  return line.text.trim() === "";
}

/** The list item that starts on `lineNo`, or null. */
export function listItemAt(state: EditorState, lineNo: number): ListItem | null {
  const line = state.doc.line(lineNo);
  const m = LIST_RE.exec(line.text);
  if (!m) return null;
  const indent = indentWidth(m[1]!);
  const contentCol = indent + m[2]!.length + Math.max(1, m[3]!.length);
  let last = lineNo;
  for (let n = lineNo + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (isBlank(l)) {
      // A blank line belongs to the item only if deeper content follows it.
      let next = n + 1;
      while (next <= state.doc.lines && isBlank(state.doc.line(next))) next++;
      if (next <= state.doc.lines && indentWidth(state.doc.line(next).text) > indent) {
        n = next - 1;
        continue;
      }
      break;
    }
    if (indentWidth(l.text) <= indent) break;
    last = n;
  }
  return { kind: "list", first: lineNo, last, indent, contentCol };
}

/** The list item whose first line is `lineNo`, or the item containing it. */
export function enclosingListItem(state: EditorState, lineNo: number): ListItem | null {
  for (let n = lineNo; n >= 1; n--) {
    const item = listItemAt(state, n);
    if (item && item.last >= lineNo) return item;
    const l = state.doc.line(n);
    if (!isBlank(l) && indentWidth(l.text) === 0 && !LIST_RE.test(l.text) && n !== lineNo)
      return null;
  }
  return null;
}

/** The heading section starting on `lineNo` (until the next heading of the same or higher level). */
export function sectionAt(state: EditorState, lineNo: number): Section | null {
  const m = HEADING_RE.exec(state.doc.line(lineNo).text);
  if (!m) return null;
  const level = m[1]!.length;
  let last = state.doc.lines;
  let inFence = false;
  for (let n = lineNo + 1; n <= state.doc.lines; n++) {
    const text = state.doc.line(n).text;
    if (/^\s*(```|~~~)/.test(text)) inFence = !inFence;
    const h = !inFence && HEADING_RE.exec(text);
    if (h && h[1]!.length <= level) {
      last = n - 1;
      break;
    }
  }
  // Trailing blank lines stay with the next section.
  while (last > lineNo && isBlank(state.doc.line(last))) last--;
  return { kind: "heading", first: lineNo, last, level };
}

export function blockAt(state: EditorState, lineNo: number): Block | null {
  return sectionAt(state, lineNo) ?? listItemAt(state, lineNo);
}

function blockText(state: EditorState, b: Block): string {
  return state.sliceDoc(state.doc.line(b.first).from, state.doc.line(b.last).to);
}

/** Re-indent every line of `text` by `delta` columns (spaces), never below 0. */
function reindent(text: string, delta: number): string {
  return text
    .split("\n")
    .map((l) => {
      if (l.trim() === "") return l;
      const cur = indentWidth(l);
      const lead = l.length - l.trimStart().length;
      return " ".repeat(Math.max(0, cur + delta)) + l.slice(lead);
    })
    .join("\n");
}

/** Previous sibling list item (same indent, same parent) of `item`, or null. */
function previousSibling(state: EditorState, item: ListItem): ListItem | null {
  for (let n = item.first - 1; n >= 1; n--) {
    const l = state.doc.line(n);
    if (isBlank(l)) continue;
    const w = indentWidth(l.text);
    if (w < item.indent) return null; // reached the parent
    if (w === item.indent) return listItemAt(state, n); // deeper lines were its children
  }
  return null;
}

function nextSibling(state: EditorState, item: ListItem): ListItem | null {
  for (let n = item.last + 1; n <= state.doc.lines; n++) {
    const l = state.doc.line(n);
    if (isBlank(l)) continue;
    const w = indentWidth(l.text);
    if (w < item.indent) return null;
    if (w === item.indent) return listItemAt(state, n);
    return null;
  }
  return null;
}

function parentItem(state: EditorState, item: ListItem): ListItem | null {
  for (let n = item.first - 1; n >= 1; n--) {
    const l = state.doc.line(n);
    if (isBlank(l)) continue;
    if (indentWidth(l.text) < item.indent) {
      const p = listItemAt(state, n);
      return p && p.last >= item.first ? p : null;
    }
  }
  return null;
}

function replaceLines(state: EditorState, first: number, last: number, text: string) {
  return { from: state.doc.line(first).from, to: state.doc.line(last).to, insert: text };
}

/**
 * Indent (dir = 1) the list item at the cursor under its previous sibling, or outdent
 * (dir = -1) it to its parent's level. Children move with it. Null if not applicable.
 */
export function indentListItem(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  const item = enclosingListItem(state, cursorLine);
  if (!item) return null;
  let delta: number;
  if (dir === 1) {
    const prev = previousSibling(state, item);
    if (!prev) return null;
    delta = prev.contentCol - item.indent;
  } else {
    if (item.indent === 0) return null;
    const parent = parentItem(state, item);
    delta = (parent ? parent.indent : 0) - item.indent;
  }
  if (delta === 0) return null;
  const text = reindent(blockText(state, item), delta);
  const change = replaceLines(state, item.first, item.last, text);
  const head = state.selection.main.head;
  const newHead = Math.max(state.doc.lineAt(head).from, head + delta);
  return { changes: change, selection: { anchor: newHead } };
}

/** Swap the item/section at the cursor with its previous (-1) or next (1) sibling. */
export function moveBlock(state: EditorState, dir: 1 | -1): TransactionSpec | null {
  const cursorLine = state.doc.lineAt(state.selection.main.head).number;
  const section = findEnclosingSection(state, cursorLine);
  const item = enclosingListItem(state, cursorLine);
  // Prefer the innermost structure: a list item inside a section moves as a list item.
  const block: Block | null = item && (!section || item.first >= section.first) ? item : section;
  if (!block) return null;
  const sibling =
    block.kind === "list"
      ? dir === -1
        ? previousSibling(state, block)
        : nextSibling(state, block)
      : siblingSection(state, block, dir);
  if (!sibling) return null;
  const [a, b] = dir === -1 ? [sibling, block] : [block, sibling];
  const between = state.sliceDoc(state.doc.line(a.last).to, state.doc.line(b.first).from);
  const text = blockText(state, b) + between + blockText(state, a);
  const change = replaceLines(state, a.first, b.last, text);
  // Where the moved block's first line lands.
  const offsetInBlock = state.selection.main.head - state.doc.line(block.first).from;
  const start = state.doc.line(a.first).from;
  const newStart = dir === -1 ? start : start + blockText(state, b).length + between.length;
  return { changes: change, selection: { anchor: newStart + offsetInBlock }, scrollIntoView: true };
}

function findEnclosingSection(state: EditorState, lineNo: number): Section | null {
  for (let n = lineNo; n >= 1; n--) {
    const s = sectionAt(state, n);
    if (s) return s.last >= lineNo ? s : null;
  }
  return null;
}

function siblingSection(state: EditorState, s: Section, dir: 1 | -1): Section | null {
  if (dir === 1) {
    let n = s.last + 1;
    while (n <= state.doc.lines && isBlank(state.doc.line(n))) n++;
    if (n > state.doc.lines) return null;
    const next = sectionAt(state, n);
    return next && next.level === s.level ? next : null;
  }
  for (let n = s.first - 1; n >= 1; n--) {
    const prev = sectionAt(state, n);
    if (!prev) continue;
    if (prev.level < s.level) return null;
    if (prev.level === s.level) return prev;
  }
  return null;
}

/**
 * Move the block starting at `fromLine` so it sits before `targetLine` (or after the
 * block at `targetLine` when `after`), re-indented to the target's level (drag & drop).
 */
export function moveBlockTo(
  state: EditorState,
  fromLine: number,
  targetLine: number,
  after: boolean,
): TransactionSpec | null {
  const block = blockAt(state, fromLine);
  if (!block) return null;
  const target = blockAt(state, targetLine) ?? { first: targetLine, last: targetLine };
  if (targetLine >= block.first && targetLine <= block.last) return null; // into itself
  let text = blockText(state, block);
  if (block.kind === "list") {
    const targetIndent = indentWidth(state.doc.line(target.first).text);
    text = reindent(text, targetIndent - block.indent);
  }
  const insertAt = after ? state.doc.line(target.last).to : state.doc.line(target.first).from;
  const remove = {
    from: state.doc.line(block.first).from,
    to:
      block.last < state.doc.lines
        ? state.doc.line(block.last + 1).from
        : state.doc.line(block.last).to,
  };
  if (block.last === state.doc.lines && block.first > 1)
    remove.from = state.doc.line(block.first - 1).to;
  const insert = after ? "\n" + text : text + "\n";
  return { changes: [remove, { from: insertAt, insert }] };
}

/** Folding: list items with children and heading sections. */
export const outlineFolding = foldService.of((state, lineStart) => {
  const line = state.doc.lineAt(lineStart);
  const block = blockAt(state, line.number);
  if (!block || block.last <= block.first) return null;
  return { from: line.to, to: state.doc.line(block.last).to };
});
