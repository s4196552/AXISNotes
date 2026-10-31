import { type EditorState, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { pendingBullet, verbatim } from "./listAutoformat";

// Arrows and comparison signs as you type:
//   `->` → `→`    `<-` → `←`    `<->` → `↔` (`>` after an auto `←`)
//   `>=` → `≥`    `<=` → `≤`    `!=` → `≠`    `~=` → `≈`
// The next keystroke can take it back, so other syntax still comes out as typed:
//   `-` after an auto `←` gives `<--` (so `<-->` stays ASCII);
//   `=` after an auto `≠`, `≥`, `≤` or `≈` gives `!==`, `>==`, `<==`, `~==`;
//   Backspace right after puts back the characters that were typed.
// `-->` stays as typed, and so does a sign after a backslash (`\->`). Never in code,
// frontmatter, raw HTML, comments or math, in an open `` ` `` span, a wikilink or a URL,
// and only for one plain cursor. A file's text is never changed except by typing.

/** Typed after `before`, the pair becomes `symbol`. */
const RULES: readonly { before: string; typed: string; symbol: string }[] = [
  { before: "-", typed: ">", symbol: "→" },
  { before: "<", typed: "-", symbol: "←" },
  { before: ">", typed: "=", symbol: "≥" },
  { before: "<", typed: "=", symbol: "≤" },
  { before: "!", typed: "=", symbol: "≠" },
  { before: "~", typed: "=", symbol: "≈" },
];

/** A symbol just made, while the cursor is still right after it. */
interface Auto {
  from: number;
  pos: number;
  /** What was typed for it, put back by Backspace (`->`, or `<->` for `↔`). */
  ascii: string;
}

const setAuto = StateEffect.define<Auto | null>();

const autoField = StateField.define<Auto | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAuto)) return e.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

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

/** Whether `pos` is in text where a sign is meant literally: an open code span, link or URL. */
function literal(state: EditorState, pos: number): boolean {
  if (verbatim(state, pos)) return true;
  const line = state.doc.lineAt(pos);
  const before = state.sliceDoc(line.from, pos);
  // An inline code span still being typed (inline marks usually close it at once).
  if ((before.replace(/\\`/g, "").match(/`/g)?.length ?? 0) % 2 === 1) return true;
  // Inside `[[…` on this line: link targets and aliases keep their own spelling.
  if (before.lastIndexOf("[[") > before.lastIndexOf("]]")) return true;
  // A URL, up to the cursor.
  return /\S*:\/\/\S*$/.test(before) || /<[a-z][\w+.-]*:\S*$/i.test(before);
}

/** The keystroke right after a symbol: put the ASCII back with it, or neither. */
function followUp(view: EditorView, auto: Auto, text: string): boolean {
  const { from, pos, ascii } = auto;
  if (ascii === "<-" && text === "-") return replace(view, from, pos, "<--", null);
  if (ascii.endsWith("=") && text === "=") return replace(view, from, pos, ascii + "=", null);
  if (ascii === "<-" && text === ">") {
    if (literal(view.state, from)) return false;
    return replace(view, from, pos, "↔", { from, pos: from + 1, ascii: "<->" });
  }
  return false;
}

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (view.composing || from !== to || state.selection.ranges.length > 1) return false;
  const auto = state.field(autoField, false);
  if (auto && auto.pos === from && followUp(view, auto, text)) return true;

  // `->` at the start of a line, where list autoformat already made `-` a bullet `- `.
  const bullet = pendingBullet(state);
  if (text === ">" && bullet && bullet.pos === from && !literal(state, bullet.from))
    return replace(view, bullet.from, from, "→", {
      from: bullet.from,
      pos: bullet.from + 1,
      ascii: "->",
    });

  const rule = RULES.find((r) => r.typed === text && state.sliceDoc(from - 1, from) === r.before);
  if (!rule) return false;
  const start = from - 1;
  const prev = state.sliceDoc(start - 1, start);
  if (prev === "\\" || (rule.symbol === "→" && prev === "-")) return false;
  if (literal(state, start)) return false;
  return replace(view, start, from, rule.symbol, {
    from: start,
    pos: start + 1,
    ascii: rule.before + rule.typed,
  });
});

/** Backspace right after a symbol puts back what was typed for it. */
const undoKey = Prec.highest(
  keymap.of([
    {
      key: "Backspace",
      run(view) {
        const auto = view.state.field(autoField, false);
        const sel = view.state.selection;
        if (!auto || sel.ranges.length > 1 || !sel.main.empty || sel.main.head !== auto.pos)
          return false;
        return replace(view, auto.from, auto.pos, auto.ascii, null);
      },
    },
  ]),
);

/** Goes before `listAutoformat`, so `->` at a line start can take back its bullet. */
export const symbolAutoformat = [autoField, typing, undoKey];
