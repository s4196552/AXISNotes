import { type EditorState, type Range, StateField } from "@codemirror/state";
import { codeFolding, foldedRanges, foldEffect, unfoldEffect } from "@codemirror/language";
import { headingSectionAt, headingSections, structuralLine, TOGGLE_HEAD } from "./headingSections";
export { TOGGLE_HEAD } from "./headingSections";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";

// Toggles, like Notion's toggle lists and toggle headings. They're stored as Obsidian
// foldable callouts, so other apps fold them too:
//
//   > [!toggle|h2]- Title      (`|h1`–`|h6` makes the title a heading; none is a toggle list)
//   > what's inside
//
// AXIS also gives |hN toggles the same section boundaries as Markdown headings, including
// unquoted content and smaller headings. Plain toggle lists keep their quoted body.
// `+` is open and `-` closed. The arrow flips that character, so the state is saved in the
// note. While a toggle is closed its inside is hidden, unless the cursor is in it.

export interface Toggle {
  /** The title line. */
  from: number;
  to: number;
  /** End of the `> [!toggle|hN]± ` Markdown. */
  markerTo: number;
  /** Where the `+`/`-` is (or would go, after the `]`). */
  statePos: number;
  hasState: boolean;
  level: number | null;
  open: boolean;
  /** End of the heading section, or the quoted body for a plain toggle list. */
  bodyTo: number;
}

/**
 * Every toggle in the note. Fenced code is tracked here rather than read from the syntax
 * tree, which may not be parsed that far yet (and nothing would redraw when it is).
 */
export function findToggles(state: EditorState): Toggle[] {
  const out: Toggle[] = [];
  const doc = state.doc;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!structuralLine(state, n) || line.text.charCodeAt(0) !== 62 /* > */) continue;
    const m = TOGGLE_HEAD.exec(line.text);
    if (!m) continue;
    let last = n;
    while (last < doc.lines && doc.line(last + 1).text.charCodeAt(0) === 62) {
      if (structuralLine(state, last + 1) && TOGGLE_HEAD.test(doc.line(last + 1).text)) break;
      last++;
    }
    const close = line.text.indexOf("]");
    out.push({
      from: line.from,
      to: line.to,
      markerTo: line.from + m[0].length,
      statePos: line.from + close + 1,
      hasState: m[2] !== "",
      level: m[1] ? Number(m[1]) : null,
      open: m[2] !== "-",
      bodyTo: m[1] ? headingSectionAt(state, n)!.bodyTo : doc.line(last).to,
    });
    n = last;
  }
  return out;
}

/** Open or close the toggle whose title line starts at `lineFrom`. */
export function flipToggle(view: EditorView, lineFrom: number) {
  const t = findToggles(view.state).find((x) => x.from === lineFrom);
  if (!t) return false;
  view.dispatch({
    selection:
      t.open && view.state.selection.ranges.some((r) => r.to > t.to && r.from <= t.bodyTo)
        ? { anchor: t.to }
        : undefined,
    changes: {
      from: t.statePos,
      to: t.statePos + (t.hasState ? 1 : 0),
      insert: t.open ? "-" : "+",
    },
  });
  return true;
}

/** View-only folding for standard Markdown headings; never rewrites the note. */
export function flipHeading(view: EditorView, lineFrom: number) {
  const heading = headingSectionAt(view.state, view.state.doc.lineAt(lineFrom).number);
  if (!heading || heading.kind !== "markdown" || heading.bodyTo <= heading.to) return false;
  let closed = false;
  foldedRanges(view.state).between(heading.to, heading.bodyTo, (from) => {
    if (from === heading.to) closed = true;
  });
  const range = { from: heading.to, to: heading.bodyTo };
  view.dispatch({
    effects: closed ? unfoldEffect.of(range) : foldEffect.of(range),
    selection:
      !closed &&
      view.state.selection.ranges.some((r) => r.to > heading.to && r.from <= heading.bodyTo)
        ? { anchor: heading.to }
        : undefined,
  });
  return true;
}

class ArrowWidget extends WidgetType {
  constructor(
    readonly open: boolean,
    readonly lineFrom: number,
    readonly heading?: { title: string; level: number },
  ) {
    super();
  }
  eq(other: ArrowWidget) {
    return (
      other.open === this.open &&
      other.lineFrom === this.lineFrom &&
      other.heading?.title === this.heading?.title &&
      other.heading?.level === this.heading?.level
    );
  }
  toDOM(view: EditorView) {
    const button = document.createElement("span");
    button.className = `cm-toggle-arrow${this.open ? " cm-toggle-open" : ""}${this.heading ? " cm-heading-arrow" : ""}`;
    button.tabIndex = 0;
    button.setAttribute("role", "button");
    button.setAttribute(
      "aria-label",
      this.heading
        ? `${this.open ? "Collapse" : "Expand"} heading: ${this.heading.title}`
        : this.open
          ? "Close toggle"
          : "Open toggle",
    );
    button.setAttribute("aria-expanded", String(this.open));
    if (this.heading) button.dataset.headingLevel = String(this.heading.level);
    button.textContent = "▸";
    const flip = () =>
      this.heading ? flipHeading(view, this.lineFrom) : flipToggle(view, this.lineFrom);
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      flip();
    });
    button.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      flip();
    });
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

const bodyLine = Decoration.line({ class: "cm-toggle-body" });
const hidden = Decoration.replace({});

interface ToggleState {
  toggles: Toggle[];
  /** Hidden insides of closed toggles; the cursor skips over them. */
  folded: DecorationSet;
}

/** Closed toggles hide their inside, unless the selection is in it (e.g. after a search). */
function fold(state: EditorState, toggles: Toggle[]): ToggleState {
  const sel = state.selection.ranges;
  const ranges = toggles
    .filter((t) => !t.open && t.bodyTo > t.to)
    .filter((t) => !sel.some((r) => r.to > t.to && r.from <= t.bodyTo))
    .map((t) => ({ from: t.to, to: t.bodyTo }));
  // Keep only outer ranges when persisted toggle headings are nested.
  const merged: { from: number; to: number }[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push(range);
  }
  return { toggles, folded: Decoration.set(merged.map((r) => hidden.range(r.from, r.to))) };
}

// Hiding whole lines spans line breaks, which only a state field may do.
const toggleField = StateField.define<ToggleState>({
  create: (state) => fold(state, findToggles(state)),
  update(value, tr) {
    if (tr.docChanged) return fold(tr.state, findToggles(tr.state));
    if (tr.selection) return fold(tr.state, value.toggles);
    return value;
  },
  provide: (f) => [
    EditorView.decorations.from(f, (v) => v.folded),
    EditorView.atomicRanges.of((view) => view.state.field(f).folded),
  ],
});

/**
 * The arrow, the title's heading size and the indented inside. Like the live preview, the
 * Markdown shows on the title line only while it's being edited (focused, cursor on it).
 * The arrow replaces the Markdown after the `> `, which the live preview hides itself.
 */
function drawToggles(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const sel = state.selection.ranges;
  for (const heading of headingSections(state)) {
    if (heading.kind !== "markdown" || heading.bodyTo <= heading.to) continue;
    let open = true;
    foldedRanges(state).between(heading.to, heading.bodyTo, (from) => {
      if (from === heading.to) open = false;
    });
    out.push(
      Decoration.widget({
        widget: new ArrowWidget(open, heading.from, heading),
        side: -1,
      }).range(heading.from),
    );
  }
  for (const t of state.field(toggleField).toggles) {
    const title = `cm-toggle-title${t.level ? ` cm-lp-h cm-lp-h${t.level}` : ""}`;
    out.push(Decoration.line({ class: title }).range(t.from));
    const arrow = new ArrowWidget(t.open, t.from);
    const editing = view.hasFocus && sel.some((r) => r.to >= t.from && r.from <= t.to);
    const text = state.sliceDoc(t.from, t.from + 2);
    const quoteTo = t.from + (text === "> " ? 2 : 1);
    if (editing) out.push(Decoration.widget({ widget: arrow, side: -1 }).range(t.from));
    else out.push(Decoration.replace({ widget: arrow }).range(quoteTo, t.markerTo));
    for (let pos = t.to + 1; pos <= t.bodyTo;) {
      const line = state.doc.lineAt(pos);
      out.push(bodyLine.range(line.from));
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

const togglePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = drawToggles(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.focusChanged ||
        foldedRanges(u.startState) !== foldedRanges(u.state)
      )
        this.decorations = drawToggles(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

export const toggles = [codeFolding(), toggleField, togglePlugin];
