import { EditorSelection, type EditorState } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { headingSections } from "./headingSections";

// The heading indicator (Settings → Appearance → Theme & layout): a column of short lines
// at the note's right edge, one per heading. The note's biggest heading (fewest #, whether
// that is # or ####) gets the longest line and each smaller level a shorter one. The line
// of the section being read is highlighted. Pointing at it (or tabbing into it) shows the
// headings as a list; picking one scrolls there. Only a view: the note never changes.

export interface IndicatorHeading {
  /** Where the heading starts in the document. */
  from: number;
  title: string;
  /** 0 for the note's biggest heading level, 1 for the next smaller one, and so on. */
  depth: number;
}

/** Line lengths in px by depth; anything deeper uses the last. */
export const LINE_WIDTHS = [20, 15, 11, 8, 6] as const;
/** A note needs at least this many headings for the indicator to show. */
export const MIN_HEADINGS = 2;
/** Room the indicator needs beside the text, in px; with less it hides. */
const MARGIN = 56;

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

  constructor(readonly view: EditorView) {
    this.dom = document.createElement("nav");
    this.dom.className = "cm-heading-indicator";
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
        b.style.paddingInlineStart = `${8 + h.depth * 12}px`;
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

  schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.measure();
    });
  }

  /** Show or hide (by count and room) and highlight the section at the top of the view. */
  measure() {
    const { view } = this;
    const outer = view.dom.getBoundingClientRect();
    const text = view.contentDOM.getBoundingClientRect();
    const room = outer.right - text.right;
    const shown = this.headings.length >= MIN_HEADINGS && (room >= MARGIN || outer.width === 0);
    this.dom.hidden = !shown;
    if (!shown) return;
    const scroller = view.scrollDOM.getBoundingClientRect();
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

export const headingIndicator = ViewPlugin.fromClass(Indicator);
