import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { insideMath } from "./math";

// Lists start as you type, without the space Markdown needs:
//   `-` at the start of a line            → `- `   (a bullet, shown at once)
//   `.` after a number at the line's start → `3. `  (a numbered list)
// A number on its own stays text (`1`, `10 apples`, and the command menu's `1` for Heading 1).
// The next keystroke can take it back, so ordinary text still comes out as typed:
//   a space is absorbed, since the formatting already added it;
//   `-` after an auto `- ` gives `--` (so `---` still makes a rule or frontmatter);
//   a digit after an auto `3. ` gives `3.5`;
//   Backspace right after puts back just the character that was typed.
// Never in code, frontmatter, raw HTML, comments or math, and only for one plain cursor.

interface Auto {
  /** Where the typed character went, and the cursor after the formatting. */
  from: number;
  pos: number;
  /** The character that was typed (`-` or `.`). */
  typed: string;
}

const setAuto = StateEffect.define<Auto | null>();

/** The formatting just made, while the cursor is still right after it. */
const autoField = StateField.define<Auto | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAuto)) return e.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

/** Syntax nodes whose text is kept as written: code, frontmatter, raw HTML, comments. */
export const VERBATIM =
  /^(InlineCode|FencedCode|CodeBlock|CodeText|Frontmatter|FrontmatterContent|HTMLBlock|CommentBlock|ProcessingInstructionBlock)$/;

function inVerbatim(state: EditorState, pos: number, upTo = pos): boolean {
  const tree = ensureSyntaxTree(state, upTo, 50) ?? syntaxTree(state);
  for (
    let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
    n;
    n = n.parent
  )
    if (VERBATIM.test(n.name)) return true;
  return false;
}

/** Text that isn't Markdown prose: code, frontmatter, raw HTML, comments or `$$` math. */
function verbatim(state: EditorState, pos: number): boolean {
  // The character before only counts on the same line: the newline ending a frontmatter
  // or fence belongs to it, but the line after is prose (and where notes open).
  const lineStart = state.doc.lineAt(pos).from;
  return (
    inVerbatim(state, pos) ||
    (pos > lineStart && inVerbatim(state, pos - 1)) ||
    insideMath(state, pos)
  );
}

/**
 * Whether `insert` at `pos` would be verbatim once typed: a blank line only joins an
 * indented code block (`    code` then `    |`) or an HTML block (`<div>` then `|`) when
 * text arrives, and four spaces of indent after a blank line start a code block.
 */
function becomesVerbatim(state: EditorState, pos: number, insert: string): boolean {
  const next = state.update({ changes: { from: pos, insert } }).state;
  return inVerbatim(next, pos, pos + insert.length);
}

function replace(view: EditorView, from: number, to: number, insert: string, auto: Auto | null) {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    effects: setAuto.of(auto),
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return true;
}

/** The keystroke right after a formatting: absorb it, undo the formatting, or neither. */
function followUp(view: EditorView, auto: Auto, text: string): boolean {
  if (text === " ") {
    view.dispatch({ effects: setAuto.of(null) }); // already has its space
    return true;
  }
  const { from, pos, typed } = auto;
  if (typed === "-" && text === "-") return replace(view, from, pos, "--", null);
  if (typed === "." && /^\d$/.test(text)) return replace(view, from, pos, "." + text, null);
  return false;
}

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (view.composing || from !== to || state.selection.ranges.length > 1) return false;
  const auto = state.field(autoField, false);
  if (auto && auto.pos === from && followUp(view, auto, text)) return true;
  if (text !== "-" && text !== ".") return false;

  const line = state.doc.lineAt(from);
  const before = state.sliceDoc(line.from, from);
  const after = state.sliceDoc(from, line.to);
  let insert: string;
  if (text === "-" && /^\s*$/.test(before) && !/^[\s*+-]/.test(after)) insert = "- ";
  else if (text === "." && /^\s*\d{1,9}$/.test(before) && after === "") insert = ". ";
  else return false;
  if (verbatim(state, from) || becomesVerbatim(state, from, insert)) return false;
  return replace(view, from, from, insert, { from, pos: from + insert.length, typed: text });
});

/** Backspace right after a formatting leaves just the character that was typed. */
const undoKey = Prec.highest(
  keymap.of([
    {
      key: "Backspace",
      run(view) {
        const auto = view.state.field(autoField, false);
        const sel = view.state.selection;
        if (!auto || sel.ranges.length > 1 || !sel.main.empty || sel.main.head !== auto.pos)
          return false;
        return replace(view, auto.from, auto.pos, auto.typed, null);
      },
    },
  ]),
);

export const listAutoformat = [autoField, typing, undoKey];
