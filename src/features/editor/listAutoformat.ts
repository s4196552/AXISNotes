import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { inCode, insideMath } from "./math";

// Lists start as you type, without the space Markdown needs:
//   `-` at the start of a line            → `- `   (a bullet, shown at once)
//   `1` on an empty line                   → `1. `  (a numbered list)
//   `.` after a number at the line's start → `3. `
// The next keystroke can take it back, so ordinary text still comes out as typed:
//   a space (or the `.` of `1.`) is absorbed, since the formatting already added it;
//   `-` after an auto `- ` gives `--` (so `---` still makes a rule or frontmatter);
//   a digit (or `,` `:` `/` `)` `-`) after an auto `1. ` gives plain `10`, `1:30`, `1/2`…,
//   and a digit after an auto `3. ` gives `3.5`;
//   Backspace right after puts back just the character that was typed.
// Never in code, frontmatter or math, and only for a single plain cursor.

interface Auto {
  /** Where the typed character went, and the cursor after the formatting. */
  from: number;
  pos: number;
  /** The character that was typed (`-`, `1` or `.`). */
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

const CODE = /^(InlineCode|FencedCode|CodeBlock|CodeText|Frontmatter|FrontmatterContent)$/;

/** Text that isn't Markdown prose: code, frontmatter or `$$` math. */
function verbatim(state: EditorState, pos: number): boolean {
  return inCode(state, pos) || inCode(state, Math.max(0, pos - 1)) || insideMath(state, pos);
}

/**
 * Whether `insert` at `pos` would be code once typed: a blank line only joins an
 * indented code block when text arrives (`    code` then `    |`), and four spaces of
 * indent after a blank line start one.
 */
function becomesCode(state: EditorState, pos: number, insert: string): boolean {
  const next = state.update({ changes: { from: pos, insert } }).state;
  const tree = ensureSyntaxTree(next, pos + insert.length, 50) ?? syntaxTree(next);
  for (
    let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1);
    n;
    n = n.parent
  )
    if (CODE.test(n.name)) return true;
  return false;
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
  if (typed === "1" && text === ".") {
    // Absorbed, but still "just formatted": a space may follow, or a digit (`1.5`).
    view.dispatch({ effects: setAuto.of({ ...auto, typed: "1." }) });
    return true;
  }
  if (typed === "1" && /^[\d,:/)-]$/.test(text)) return replace(view, from, pos, "1" + text, null);
  if (typed.endsWith(".") && /^\d$/.test(text)) return replace(view, from, pos, typed + text, null);
  return false;
}

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (view.composing || from !== to || state.selection.ranges.length > 1) return false;
  const auto = state.field(autoField, false);
  if (auto && auto.pos === from && followUp(view, auto, text)) return true;
  if (text !== "-" && text !== "1" && text !== ".") return false;

  const line = state.doc.lineAt(from);
  const before = state.sliceDoc(line.from, from);
  const after = state.sliceDoc(from, line.to);
  let insert: string;
  if (text === "-" && /^\s*$/.test(before) && !/^[\s*+-]/.test(after)) insert = "- ";
  else if (text === "1" && /^\s*$/.test(before) && after === "") insert = "1. ";
  else if (text === "." && /^\s*\d{1,9}$/.test(before) && after === "") insert = ". ";
  else return false;
  if (verbatim(state, from) || becomesCode(state, from, insert)) return false;
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
