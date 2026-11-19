import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { headingSections } from "./headingSections";

// The heading indicator (Settings → Appearance → Theme & layout): a column of short lines
// at the note's right or left edge (Settings → "Heading indicator side"), one per heading.
// The note's biggest heading (fewest #, whether that is # or ####) gets the longest line and
// each smaller level a shorter one. The line of the section being read is highlighted.
// Pointing at it (or tabbing into it) shows the headings as a compact list that opens at the
// current section; picking one scrolls there. Only a view: the note never changes.

export interface IndicatorHeading {
  /** Where the heading starts in the document. */
  from: number;
  title: string;
  /** 0 for the note's biggest heading level, 1 for the next smaller one, and so on. */
  depth: number;
}

/** Line lengths in px by depth; anything deeper uses the last. */
export const LINE_WIDTHS = [16, 12, 9, 6, 4] as const;
/** A note needs at least this many headings for the indicator to show. */
export const MIN_HEADINGS = 2;
/** The column's width (longest line plus padding), in px. */
const RAIL = LINE_WIDTHS[0] + 8;
/** Room the indicator needs between the text and the note's edge, in px; with less it hides. */
export const MIN_ROOM = LINE_WIDTHS[0] + 4;

/** Which edge of the note the indicator sits at. */
export type IndicatorSide = "right" | "left";

/**
 * Where the indicator goes, from the free room between the text column and the note's edge
 * on its side: hidden when there's too little, otherwise centred in that margin. Returns
 * its offset from the edge (`right`, or `left` on the left side); `edge` is what lies
 * between the editor's edge and that margin (the scrollbar on the right).
 * The text column is narrower than CodeMirror's content box (Settings → editor width), so
 * the room is measured from the text lines, not the content element.
 */
export function placement(room: number, edge: number): number | null {
  if (room < MIN_ROOM) return null;
  return Math.round(edge + Math.max(0, (room - RAIL) / 2));
}

/** The note's Markdown headings, with depth counted from its biggest one. */
export function indicatorHeadings(state: EditorState): IndicatorHeading[] {
  const found = headingSections(state).filter((h) => h.kind === "markdown");
  if (!found.length) return [];
  const top = Math.min(...found.map((h) => h.level));
  return found.map((h) => ({
    from: h.from,
    title: h.title.trim() || "Untitled heading",
    depth: h.level - top,
  }));
}

export const lineWidth = (depth: number) => LINE_WIDTHS[Math.min(depth, LINE_WIDTHS.length - 1)]!;

/** The heading whose section holds `pos`: the last one starting at or before it. */
export function activeHeading(headings: readonly IndicatorHeading[], pos: number): number {
  let active = headings.length ? 0 : -1;
  for (let i = 0; i < headings.length; i++) if (headings[i]!.from <= pos) active = i;
  return active;
}

const sameHeadings = (a: IndicatorHeading[], b: IndicatorHeading[]) =>
  a.length === b.length &&
  a.every((h, i) => h.title === b[i]!.title && h.depth === b[i]!.depth && h.from === b[i]!.from);

class Indicator {
  dom: HTMLElement;
  rail: HTMLElement;
  list: HTMLElement;
  headings: IndicatorHeading[] = [];
  active = -1;
  frame = 0;
  onScroll = () => this.schedule();

  constructor(
    readonly view: EditorView,
    readonly side: IndicatorSide,
  ) {
    this.dom = document.createElement("nav");
    this.dom.className = `cm-heading-indicator cm-heading-indicator-${side}`;
    this.dom.setAttribute("aria-label", "Headings in this note");
    this.rail = document.createElement("div");
    this.rail.className = "cm-heading-rail";
    this.rail.setAttribute("aria-hidden", "true");
    this.list = document.createElement("ol");
    this.list.className = "cm-heading-list";
    this.dom.append(this.rail, this.list);
    // Keep clicks off the editor (it would move the cursor or steal focus first).
    this.dom.addEventListener("mousedown", (e) => {
      if ((e.target as HTMLElement).closest("button")) e.preventDefault();
    });
    // The list is short and scrolls: open it at the section being read.
    this.dom.addEventListener("pointerenter", () => this.revealActive());
    view.dom.appendChild(this.dom);
    view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
    this.rebuild();
  }

  update(u: ViewUpdate) {
    if (u.docChanged) this.rebuild();
    else if (u.viewportChanged || u.geometryChanged) this.schedule();
  }

  rebuild() {
    const next = indicatorHeadings(this.view.state);
    if (!sameHeadings(next, this.headings)) {
      this.headings = next;
      this.render();
    }
    this.schedule();
  }

  render() {
    this.rail.replaceChildren(
      ...this.headings.map((h) => {
        const line = document.createElement("span");
        line.className = "cm-heading-line";
        line.style.width = `${lineWidth(h.depth)}px`;
        return line;
      }),
    );
    this.list.replaceChildren(
      ...this.headings.map((h, i) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cm-heading-item";
        b.textContent = h.title;
        b.title = h.title;
        b.style.paddingInlineStart = `${8 + h.depth * 10}px`;
        b.dataset.depth = String(h.depth);
        b.addEventListener("click", () => this.jump(i));
        li.appendChild(b);
        return li;
      }),
    );
    this.active = -1;
  }

  jump(i: number) {
    const h = this.headings[i];
    if (!h) return;
    const pos = Math.min(h.from, this.view.state.doc.length);
    this.view.dispatch({
      selection: EditorSelection.cursor(pos),
      effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: 24 }),
    });
    this.view.focus();
  }

  /** Scroll the list so the current section's heading is in the middle of it. */
  revealActive() {
    const item = this.list.querySelectorAll("button")[this.active];
    if (!item) return;
    const top = item.offsetTop - (this.list.clientHeight - item.offsetHeight) / 2;
    this.list.scrollTop = Math.max(0, top);
  }

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  /** Where the indicator goes on its side (null: no room), from the editor's layout. */
  offset(): number | null {
    const { view } = this;
    const outer = view.dom.getBoundingClientRect();
    // No layout (hidden, or a test without one): keep it in the default place.
    if (outer.width === 0) return 10;
    const scroller = view.scrollDOM.getBoundingClientRect();
    const line = (
      view.contentDOM.querySelector(".cm-line") ?? view.contentDOM
    ).getBoundingClientRect();
    if (this.side === "left") {
      // The content's start padding holds the line controls (+ and the grip) and the fold
      // arrows, plus the LEFT_ROOM strip editor.css adds for the rail; only that strip is free.
      const pad = parseFloat(getComputedStyle(view.contentDOM).paddingInlineStart) || 0;
      const room = line.left - (pad - LEFT_ROOM) - scroller.left;
      return placement(room, scroller.left - outer.left);
    }
    const scrollbar = view.scrollDOM.offsetWidth - view.scrollDOM.clientWidth;
    const room = scroller.right - scrollbar - line.right;
    return placement(room, outer.right - scroller.right + scrollbar);
  }

  /** Show or hide (by count and room) and highlight the section at the top of the view. */
  measure() {
    const { view } = this;
    const scroller = view.scrollDOM.getBoundingClientRect();
    const offset = this.offset();
    const shown = this.headings.length >= MIN_HEADINGS && offset !== null;
    this.dom.hidden = !shown;
    if (!shown) return;
    this.dom.style[this.side] = `${offset}px`;
    // The section being read: the one holding the line a little below the top edge.
    const block = view.lineBlockAtHeight(scroller.top + 48 - view.documentTop);
    const active = activeHeading(this.headings, block.from);
    if (active === this.active) return;
    this.active = active;
    const lines = this.rail.children;
    const items = this.list.querySelectorAll("button");
    for (let i = 0; i < this.headings.length; i++) {
      lines[i]?.classList.toggle("active", i === active);
      const item = items[i];
      if (!item) continue;
      item.classList.toggle("active", i === active);
      if (i === active) item.setAttribute("aria-current", "location");
      else item.removeAttribute("aria-current");
    }
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    this.dom.remove();
  }
}

/** Extra start margin for the note on the left side: room for the rail beside the + / grip. */
export const LEFT_ROOM = RAIL + 4;

const plugins = {
  right: ViewPlugin.define((view) => new Indicator(view, "right")),
  // The note's start padding already holds the line controls, so on the left the editor
  // gets a wider margin (editor.css, `cm-heading-side-left`) for the rail to sit in.
  left: [
    ViewPlugin.define((view) => new Indicator(view, "left")),
    EditorView.editorAttributes.of({ class: "cm-heading-side-left" }),
  ],
};

/** The heading indicator on the given side of the note (anything but "left" is the right). */
export const headingIndicator = (side: IndicatorSide = "right") =>
  side === "left" ? plugins.left : plugins.right;
