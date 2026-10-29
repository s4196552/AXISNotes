import { EditorSelection, Prec, StateEffect, StateField } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { verbatim } from "./listAutoformat";

// Inline marks close as you type, with the cursor left between them:
//   `   → `|`          *   → *|*
//   a second ` or * in an empty pair grows it: ``|``, **|**, then ```|``` and ***|***;
//   ``` alone at the start of a line becomes a code block, the cursor after the fence:
//     ```|
//     ```
//   typing the mark at its closer steps over it (both `*`s of `**`);
//   a space in an empty `*` pair drops the closer, so `* ` still starts a bullet and
//   `2 * 3` stays as typed; Backspace in an empty pair removes one mark from each side.
// With text selected, ` or * wraps it and keeps it selected (again: `**bold**`).
// Never in code, frontmatter, raw HTML, comments or math, after a backslash, or touching
// a word (`2*3`, `don`t`), and only for one plain cursor.

/** A pair made here, while the cursor is inside it: `mark` at from.. and ..to. */
interface Pair {
  from: number;
  to: number;
  mark: string;
}

/** After stepping over a `**` closer: the `left` more `*`s typed at `pos` are absorbed. */
interface Absorb {
  pos: number;
  char: string;
  left: number;
}

const setPair = StateEffect.define<Pair | null>();
const setAbsorb = StateEffect.define<Absorb | null>();

/** Whether `pair` is still in the document, with the cursor between its marks. */
function holds(doc: string, head: number, pair: Pair): boolean {
  const n = pair.mark.length;
  return (
    pair.to - pair.from >= 2 * n &&
    doc.slice(pair.from, pair.from + n) === pair.mark &&
    doc.slice(pair.to - n, pair.to) === pair.mark &&
    head >= pair.from + n &&
    head <= pair.to - n &&
    !doc.slice(pair.from, pair.to).includes("\n")
  );
}

const pairField = StateField.define<Pair | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPair)) return e.value;
    if (!value || (!tr.docChanged && !tr.selection)) return value;
    const pair = tr.docChanged
      ? {
          ...value,
          from: tr.changes.mapPos(value.from, 1),
          to: tr.changes.mapPos(value.to, -1),
        }
      : value;
    const sel = tr.state.selection;
    if (sel.ranges.length > 1 || !sel.main.empty) return null;
    // The pair is a single line, so its line is enough to check it.
    const line = tr.state.doc.lineAt(Math.min(pair.from, tr.state.doc.length));
    const text = line.text;
    const shifted = { ...pair, from: pair.from - line.from, to: pair.to - line.from };
    return holds(text, sel.main.head - line.from, shifted) ? pair : null;
  },
});

const absorbField = StateField.define<Absorb | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAbsorb)) return e.value;
    return tr.docChanged || tr.selection ? null : value;
  },
});

function put(
  view: EditorView,
  from: number,
  to: number,
  insert: string,
  cursor: number,
  pair: Pair | null,
  absorb: Absorb | null = null,
) {
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: cursor },
    effects: [setPair.of(pair), setAbsorb.of(absorb)],
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return true;
}

const MAX = { "`": 3, "*": 3 } as const;
type MarkChar = keyof typeof MAX;
const isMarkChar = (c: string): c is MarkChar => c === "`" || c === "*";

/** A key typed inside a pair made here: grow it, step over its closer, or drop it. */
function inPair(view: EditorView, pair: Pair, pos: number, text: string): boolean {
  const n = pair.mark.length;
  const openEnd = pair.from + n;
  const closeStart = pair.to - n;
  const empty = pos === openEnd && pos === closeStart;
  const char = pair.mark[0]!;
  if (text === char && empty && n < MAX[char as MarkChar]) {
    const mark = pair.mark + char;
    const line = view.state.doc.lineAt(pos);
    // ``` alone on a line: a code block, with the cursor where its language goes.
    if (
      mark === "```" &&
      /^\s*$/.test(view.state.sliceDoc(line.from, pair.from)) &&
      pair.to === line.to
    )
      return put(view, pair.from, pair.to, "```\n```", pair.from + 3, null);
    return put(view, pair.from, pair.to, mark + mark, pair.from + mark.length, {
      from: pair.from,
      to: pair.from + 2 * mark.length,
      mark,
    });
  }
  if (text === char && pos === closeStart && !empty) {
    // Over the whole closer; a `**` closer typed in full absorbs its second `*`.
    view.dispatch({
      selection: { anchor: pair.to },
      effects: [setPair.of(null), setAbsorb.of(n > 1 ? { pos: pair.to, char, left: n - 1 } : null)],
      userEvent: "select",
    });
    return true;
  }
  // Emphasis can't start with a space: `* ` is a bullet, `a * b` arithmetic.
  if (text === " " && empty && char === "*") return put(view, pos, pair.to, " ", pos + 1, null);
  return false;
}

/** Whether a new pair may start at `pos`: prose, and not touching a word or an escape. */
function canPair(view: EditorView, pos: number, char: MarkChar): boolean {
  const { state } = view;
  const before = state.sliceDoc(pos - 1, pos);
  const after = state.sliceDoc(pos, pos + 1);
  if (before === "\\" || /[\p{L}\p{N}_]/u.test(before) || before === char) return false;
  if (/[\p{L}\p{N}_]/u.test(after) || after === char) return false;
  return !verbatim(state, pos);
}

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (view.composing || state.selection.ranges.length > 1) return false;
  if (from !== to) {
    // A selection: wrap it, keeping it selected.
    if (!isMarkChar(text) || verbatim(state, from) || state.sliceDoc(from, to).includes("\n"))
      return false;
    view.dispatch({
      changes: [
        { from, insert: text },
        { from: to, insert: text },
      ],
      selection: EditorSelection.range(from + 1, to + 1),
      effects: [setPair.of(null), setAbsorb.of(null)],
      userEvent: "input.type",
    });
    return true;
  }
  const absorb = state.field(absorbField, false);
  if (absorb && absorb.pos === from && absorb.char === text) {
    view.dispatch({
      effects: setAbsorb.of(absorb.left > 1 ? { ...absorb, left: absorb.left - 1 } : null),
    });
    return true;
  }
  const pair = state.field(pairField, false);
  if (pair && inPair(view, pair, from, text)) return true;
  if (!isMarkChar(text) || !canPair(view, from, text)) return false;
  return put(view, from, from, text + text, from + 1, { from, to: from + 2, mark: text });
});

/** Backspace in an empty pair takes a mark off each side; Enter on a lone one keeps it. */
const pairKeys = Prec.highest(
  keymap.of([
    {
      key: "Backspace",
      run(view) {
        const pair = view.state.field(pairField, false);
        const sel = view.state.selection;
        if (!pair || sel.ranges.length > 1 || !sel.main.empty) return false;
        const n = pair.mark.length;
        if (sel.main.head !== pair.from + n || pair.to - pair.from !== 2 * n) return false;
        const mark = pair.mark.slice(1);
        return put(
          view,
          pair.from,
          pair.to,
          mark + mark,
          pair.from + mark.length,
          mark ? { from: pair.from, to: pair.from + 2 * mark.length, mark } : null,
        );
      },
    },
    {
      // `***` or `**` alone then Enter: a rule or plain text, not an empty pair.
      key: "Enter",
      run(view) {
        const pair = view.state.field(pairField, false);
        const head = view.state.selection.main.head;
        if (
          !pair ||
          head !== pair.from + pair.mark.length ||
          pair.to - pair.from !== 2 * (head - pair.from)
        )
          return false;
        const line = view.state.doc.lineAt(head);
        if (line.from !== pair.from || line.to !== pair.to) return false;
        view.dispatch({
          changes: { from: head, to: pair.to },
          effects: setPair.of(null),
        });
        return false; // and Enter as usual
      },
    },
  ]),
);

/**
 * Bold, italic, strikethrough (or any symmetric mark) for each selection: wrap it, or
 * unwrap it when the mark is already there, inside or just around it. An empty cursor
 * gets an empty pair to type into, or leaves one it's inside.
 */
export function toggleMark(view: EditorView, mark: string): boolean {
  const { state } = view;
  const char = mark[0]!;
  const n = mark.length;
  /** How many `char`s run back from `pos` (or forward, with dir 1). */
  const run = (pos: number, dir: -1 | 1) => {
    let k = 0;
    while (k < 6) {
      const at = dir < 0 ? pos - k - 1 : pos + k;
      if (at < 0 || at >= state.doc.length || state.sliceDoc(at, at + 1) !== char) break;
      k++;
    }
    return k;
  };
  // `*` marks share a character: in `***x***` both bold and italic are there.
  const has = (k: number) => (char === "*" && n === 1 ? k % 2 === 1 : k >= n);
  const single = state.selection.ranges.length === 1;
  let pair: Pair | null = null;
  view.dispatch(
    state.changeByRange((range) => {
      let { from, to } = range;
      if (from === to) {
        if (has(Math.min(run(from, -1), run(from, 1))) && run(from, -1) === run(from, 1))
          return {
            changes: { from: from - n, to: to + n },
            range: EditorSelection.cursor(from - n),
          };
        if (single) pair = { from, to: from + 2 * n, mark };
        return {
          changes: { from, insert: mark + mark },
          range: EditorSelection.cursor(from + n),
        };
      }
      // Leave the spaces a double-click can take with a word outside the marks.
      const text = state.sliceDoc(from, to);
      from += text.length - text.trimStart().length;
      to -= text.length - text.trimEnd().length;
      if (from >= to) return { range };
      const inner = state.sliceDoc(from, to);
      if (inner.length > 2 * n && inner.startsWith(mark) && inner.endsWith(mark))
        return {
          changes: [
            { from, to: from + n },
            { from: to - n, to },
          ],
          range: EditorSelection.range(from, to - 2 * n),
        };
      if (has(Math.min(run(from, -1), run(to, 1))))
        return {
          changes: [
            { from: from - n, to: from },
            { from: to, to: to + n },
          ],
          range: EditorSelection.range(from - n, to - n),
        };
      return {
        changes: [
          { from, insert: mark },
          { from: to, insert: mark },
        ],
        range: EditorSelection.range(from + n, to + n),
      };
    }),
    { userEvent: "input.format" },
  );
  if (pair) view.dispatch({ effects: setPair.of(pair) });
  view.focus();
  return true;
}

export const inlineMarks = [pairField, absorbField, typing, pairKeys];
