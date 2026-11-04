import { type EditorState, Prec, type Range, StateField } from "@codemirror/state";
import {
  codeFolding,
  foldable,
  foldedRanges,
  foldEffect,
  unfoldEffect,
} from "@codemirror/language";
import { calloutBlocks, headingSectionAt, headingSections, TOGGLE_HEAD } from "./headingSections";
import { listFoldRange, listItemSpans } from "./outliner";
export { TOGGLE_HEAD } from "./headingSections";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { ChevronDown } from "lucide-react";
import { lucideSvg } from "./lucideSvg";

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
//
// Obsidian's own foldable callouts (`> [!note]- Title`) fold the same way, with a chevron
// after the title as in Obsidian (obsidianSyntax.ts draws the rest of the callout).

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
  /** End of the toggle's own quoted lines (a heading's section may go on past them). */
  quoteTo: number;
  /** A foldable Obsidian callout rather than a toggle. */
  callout: boolean;
}

/**
 * Every toggle and foldable callout in the note, from the shared outline (headingSections.ts),
 * which tracks fenced code itself rather than waiting for the syntax tree to be parsed.
 */
export function findToggles(state: EditorState): Toggle[] {
  const out: Toggle[] = [];
  const doc = state.doc;
  for (const { first, last, head } of calloutBlocks(state)) {
    const line = doc.line(first);
    const m = TOGGLE_HEAD.exec(line.text);
    // Other callouts fold only with a + or -, as in Obsidian.
    if (!m && (!head[2] || head[1]!.toLowerCase() === "toggle")) continue;
    out.push({
      from: line.from,
      to: line.to,
      markerTo: line.from + (m ?? head)[0].length,
      statePos: line.from + line.text.indexOf("]") + 1,
      hasState: (m ?? head)[2] !== "",
      level: m?.[1] ? Number(m[1]) : null,
      open: (m ?? head)[2] !== "-",
      bodyTo: m?.[1] ? headingSectionAt(state, first)!.bodyTo : doc.line(last).to,
      quoteTo: doc.line(last).to,
      callout: !m,
    });
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

/** The view folds that start at `from` (a heading's or list item's line end). */
function foldsAt(state: EditorState, from: number) {
  const found: { from: number; to: number }[] = [];
  foldedRanges(state).between(from, from, (a, b) => {
    if (a === from) found.push({ from: a, to: b });
  });
  return found;
}

/**
 * Fold or unfold `from..to` in the view only; the note's text never changes. Folds inside
 * it stay as they were, so unfolding a parent brings its children back as they were left.
 */
function flipViewFold(view: EditorView, from: number, to: number) {
  const open = foldsAt(view.state, from);
  view.dispatch({
    // Unfold what is folded there, even if the item has grown since it was folded.
    effects: open.length ? open.map((r) => unfoldEffect.of(r)) : foldEffect.of({ from, to }),
    selection:
      !open.length && view.state.selection.ranges.some((r) => r.to > from && r.from <= to)
        ? { anchor: from }
        : undefined,
  });
  return true;
}

export type FoldRange = { from: number; to: number };

/** The view folds (headings and list items), to bring back when the note is reopened. */
export function viewFolds(state: EditorState): FoldRange[] {
  const out: FoldRange[] = [];
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    out.push({ from, to });
  });
  return out;
}

/** Effects that fold `saved` again, skipping any the note no longer has as they were. */
export function restoreFolds(state: EditorState, saved: readonly FoldRange[]) {
  return saved
    .filter(({ from, to }) => {
      if (to > state.doc.length) return false;
      const line = state.doc.lineAt(from);
      const range = line.to === from ? foldable(state, line.from, line.to) : null;
      return range?.from === from && range.to === to;
    })
    .map((r) => foldEffect.of(r));
}

/** View-only folding for standard Markdown headings; never rewrites the note. */
export function flipHeading(view: EditorView, lineFrom: number) {
  const heading = headingSectionAt(view.state, view.state.doc.lineAt(lineFrom).number);
  if (!heading || heading.kind !== "markdown" || heading.bodyTo <= heading.to) return false;
  return flipViewFold(view, heading.to, heading.bodyTo);
}

/** View-only folding of a list item's children (bullets, numbers and tasks alike). */
export function flipListItem(view: EditorView, lineFrom: number) {
  const range = listFoldRange(view.state, view.state.doc.lineAt(lineFrom).number);
  return range ? flipViewFold(view, range.from, range.to) : false;
}

class ArrowWidget extends WidgetType {
  constructor(
    readonly open: boolean,
    readonly lineFrom: number,
    readonly heading?: { title: string; level: number },
    /** A toggle heading's arrow hangs in the margin like a heading's. */
    readonly hang = false,
    /** A list item's arrow, hanging left of its bullet, number or checkbox. */
    readonly list = false,
  ) {
    super();
  }
  eq(other: ArrowWidget) {
    return (
      other.open === this.open &&
      other.lineFrom === this.lineFrom &&
      other.hang === this.hang &&
      other.list === this.list &&
      other.heading?.title === this.heading?.title &&
      other.heading?.level === this.heading?.level
    );
  }
  toDOM(view: EditorView) {
    const button = document.createElement("span");
    button.className = `cm-toggle-arrow${this.open ? " cm-toggle-open" : ""}${this.heading ? " cm-heading-arrow" : ""}${this.hang ? " cm-toggle-hang" : ""}${this.list ? " cm-list-arrow" : ""}`;
    button.tabIndex = 0;
    button.setAttribute("role", "button");
    button.setAttribute(
      "aria-label",
      this.heading
        ? `${this.open ? "Collapse" : "Expand"} heading: ${this.heading.title}`
        : this.list
          ? `${this.open ? "Collapse" : "Expand"} list item`
          : this.open
            ? "Close toggle"
            : "Open toggle",
    );
    button.setAttribute("aria-expanded", String(this.open));
    if (this.heading) button.dataset.headingLevel = String(this.heading.level);
    // The icon is drawn by CSS from the fold arrow style in Settings → Appearance.
    const flip = () =>
      this.heading
        ? flipHeading(view, this.lineFrom)
        : this.list
          ? flipListItem(view, this.lineFrom)
          : flipToggle(view, this.lineFrom);
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

/** A foldable callout's chevron, after its title as in Obsidian; turned when closed. */
class CalloutFoldWidget extends WidgetType {
  constructor(
    readonly open: boolean,
    readonly lineFrom: number,
  ) {
    super();
  }
  eq(other: CalloutFoldWidget) {
    return other.open === this.open && other.lineFrom === this.lineFrom;
  }
  toDOM(view: EditorView) {
    const button = document.createElement("span");
    button.className = `cm-callout-fold${this.open ? "" : " cm-callout-fold-closed"}`;
    button.tabIndex = 0;
    button.setAttribute("role", "button");
    button.setAttribute("aria-label", this.open ? "Collapse callout" : "Expand callout");
    button.setAttribute("aria-expanded", String(this.open));
    button.append(lucideSvg(ChevronDown, 16));
    button.addEventListener("mousedown", (e) => {
      e.preventDefault();
      flipToggle(view, this.lineFrom);
    });
    button.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      flipToggle(view, this.lineFrom);
    });
    return button;
  }
  ignoreEvent() {
    return true;
  }
}

const bodyLine = Decoration.line({ class: "cm-toggle-body cm-toggle-inside" });
/** A closed callout's title is the whole box. */
const closedCallout = Decoration.line({ class: "cm-callout-closed" });
const sectionLine = Decoration.line({ class: "cm-toggle-body cm-toggle-section" });
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
    out.push(
      Decoration.widget({
        widget: new ArrowWidget(!foldsAt(state, heading.to).length, heading.from, heading),
        side: -1,
      }).range(heading.from),
    );
  }
  for (const t of state.field(toggleField).toggles) {
    if (t.callout) {
      // Like the rest of the callout (obsidianSyntax.ts), raw while its title is edited.
      const inside = sel.some((r) => r.to > t.to && r.from <= t.bodyTo);
      if (!t.open && t.bodyTo > t.to && !inside) out.push(closedCallout.range(t.from));
      if (!view.hasFocus || !sel.some((r) => r.to >= t.from && r.from <= t.to))
        out.push(
          Decoration.widget({ widget: new CalloutFoldWidget(t.open, t.from), side: -1 }).range(
            t.to,
          ),
        );
      continue;
    }
    const title = `cm-toggle-title${t.level ? ` cm-lp-h cm-lp-h${t.level}` : ""}`;
    out.push(Decoration.line({ class: title }).range(t.from));
    const arrow = new ArrowWidget(t.open, t.from, undefined, t.level !== null);
    const editing = view.hasFocus && sel.some((r) => r.to >= t.from && r.from <= t.to);
    const text = state.sliceDoc(t.from, t.from + 2);
    const quoteTo = t.from + (text === "> " ? 2 : 1);
    if (editing) out.push(Decoration.widget({ widget: arrow, side: -1 }).range(t.from));
    else out.push(Decoration.replace({ widget: arrow }).range(quoteTo, t.markerTo));
    // Only the toggle's own quoted lines: callouts and quotes later in a heading's section
    // are drawn as they would be anywhere else.
    for (let pos = t.to + 1; pos <= t.quoteTo;) {
      const line = state.doc.lineAt(pos);
      out.push((t.level ? sectionLine : bodyLine).range(line.from));
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

const closedItem = Decoration.line({ class: "cm-li-folded" });

/**
 * A fold arrow on every list item with children, in the visible part of the note: shown
 * while the line is hovered, and kept (with a ring round the bullet) while it is folded.
 * It sits at the start of the line and CSS hangs it left of the marker by `--li-depth`.
 */
function drawListArrows(view: EditorView): DecorationSet {
  const { state } = view;
  const out: Range<Decoration>[] = [];
  const spans = listItemSpans(state);
  for (const { from, to } of view.visibleRanges) {
    for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) {
      const last = spans.get(n);
      if (!last || last <= n) continue;
      const line = state.doc.line(n);
      const open = !foldsAt(state, line.to).length;
      out.push(
        Decoration.widget({
          widget: new ArrowWidget(open, line.from, undefined, false, true),
          side: -1,
        }).range(line.from),
      );
      if (!open) out.push(closedItem.range(line.from));
    }
  }
  return Decoration.set(out, true);
}

const listArrowPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = drawListArrows(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || foldedRanges(u.startState) !== foldedRanges(u.state))
        this.decorations = drawListArrows(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);

/**
 * Ctrl+Shift+[ and ] (Cmd+Alt+[ and ] on a Mac) fold and unfold headings and list items
 * through the fold keymap (outlinerView.ts). On a toggle's or foldable callout's title they
 * close and open it with its arrow instead.
 */
function foldToggleKey(wantOpen: boolean) {
  return (view: EditorView) => {
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const t = view.state.field(toggleField).toggles.find((x) => x.from === line.from);
    if (!t) return false;
    if (t.open !== wantOpen) flipToggle(view, t.from);
    return true;
  };
}

const toggleKeys = Prec.high(
  keymap.of([
    { key: "Ctrl-Shift-[", mac: "Cmd-Alt-[", run: foldToggleKey(false) },
    { key: "Ctrl-Shift-]", mac: "Cmd-Alt-]", run: foldToggleKey(true) },
  ]),
);

export const toggles = [codeFolding(), toggleField, togglePlugin, listArrowPlugin, toggleKeys];
