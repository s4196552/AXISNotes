import { type EditorState, type Range, StateField } from "@codemirror/state";
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
// `+` is open and `-` closed. The arrow flips that character, so the state is saved in the
// note. While a toggle is closed its inside is hidden, unless the cursor is in it.

/** The toggle line's Markdown: the level and the `+`/`-` (absent counts as open). */
export const TOGGLE_HEAD = /^>\s*\[!toggle(?:\|h([1-6]))?\]([+-]?)[ \t]?/i;

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
  /** End of the last `>` line inside, or `to` when it's empty. */
  bodyTo: number;
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Every toggle in the note. Fenced code is tracked here rather than read from the syntax
 * tree, which may not be parsed that far yet (and nothing would redraw when it is).
 */
export function findToggles(state: EditorState): Toggle[] {
  const out: Toggle[] = [];
  const doc = state.doc;
  let fence: string | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    const f = FENCE.exec(line.text)?.[1];
    if (f && (fence === null || (f[0] === fence[0] && f.length >= fence.length))) {
      fence = fence === null ? f : null;
      continue;
    }
    if (fence !== null || line.text.charCodeAt(0) !== 62 /* > */) continue;
    const m = TOGGLE_HEAD.exec(line.text);
    if (!m) continue;
    let last = n;
    while (last < doc.lines && doc.line(last + 1).text.charCodeAt(0) === 62) {
      if (TOGGLE_HEAD.test(doc.line(last + 1).text)) break;
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
      bodyTo: doc.line(last).to,
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
    changes: {
      from: t.statePos,
      to: t.statePos + (t.hasState ? 1 : 0),
      insert: t.open ? "-" : "+",
    },
  });
  return true;
}

class ArrowWidget extends WidgetType {
  constructor(
    readonly open: boolean,
    readonly lineFrom: number,
  ) {
    super();
  }
  eq(other: ArrowWidget) {
    return other.open === this.open && other.lineFrom === this.lineFrom;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("span");
    button.className = `cm-toggle-arrow${this.open ? " cm-toggle-open" : ""}`;
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", this.open ? "Close toggle" : "Open toggle");
    button.setAttribute("aria-expanded", String(this.open));
    button.textContent = "▸";
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      flipToggle(view, this.lineFrom);
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
  const folded = toggles
    .filter((t) => !t.open && t.bodyTo > t.to)
    .filter((t) => !sel.some((r) => r.to > t.to && r.from <= t.bodyTo))
    .map((t) => hidden.range(t.to, t.bodyTo));
  return { toggles, folded: Decoration.set(folded) };
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
      if (u.docChanged || u.selectionSet || u.focusChanged) this.decorations = drawToggles(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

export const toggles = [toggleField, togglePlugin];
