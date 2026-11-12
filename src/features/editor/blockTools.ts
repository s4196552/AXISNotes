import { foldedRanges, unfoldEffect } from "@codemirror/language";
import { EditorSelection, type Range } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { GripVertical, Plus } from "lucide-react";
import { DRAG_START } from "../../app/usePointerDrag";
import { headingTitleAt, structuralLine } from "./headingSections";
import { dropTarget } from "./imageEditor";
import { lucideSvg } from "./lucideSvg";
import { handledBlockAt, moveLinesToBoundary } from "./outliner";
import { openCommandMenu } from "./quickCommands";

function addBelow(view: EditorView, n: number) {
  if (view.state.readOnly) return;
  const block = handledBlockAt(view.state, n);
  if (!block) return;
  const { doc, lineBreak } = view.state;
  const at = doc.line(block.insertAfter).to;
  const effects: ReturnType<typeof unfoldEffect.of>[] = [];
  // The new line must be visible even when it opens a folded heading's body.
  foldedRanges(view.state).between(at, at, (from, to) => {
    if (from <= at && at < to) effects.push(unfoldEffect.of({ from, to }));
  });
  if (effects.length) view.dispatch({ effects });
  view.dispatch({
    changes: { from: at, insert: lineBreak },
    selection: { anchor: at + 1 },
    scrollIntoView: true,
    userEvent: "input",
  });
  openCommandMenu(view);
}

function selectBlock(view: EditorView, n: number) {
  const block = handledBlockAt(view.state, n);
  if (!block) return;
  const { doc } = view.state;
  view.dispatch({
    selection: EditorSelection.range(doc.line(block.last).to, doc.line(block.first).from),
    userEvent: "select.pointer",
  });
  view.focus();
}

function targetBoundary(view: EditorView, x: number, y: number) {
  const rect = view.scrollDOM.getBoundingClientRect();
  if (y < Math.max(rect.top, view.documentTop) || y > rect.bottom) return null;
  const target = dropTarget(view, x, y);
  if (!target) return null;
  const { state } = view;
  const { doc } = state;
  const after =
    target.after === doc.lines && doc.line(doc.lines).length === 0
      ? target.after - 1
      : target.after;
  const before = after + 1;
  // Keep the YAML at the top and avoid dropping into an opaque region or
  // splitting a multi-line Setext heading from its underline.
  if (after === 0 && /^\uFEFF?---[ \t]*$/.test(doc.line(1).text) && !structuralLine(state, 1))
    return null;
  if (!structuralLine(state, after) && !structuralLine(state, before)) return null;
  const heading = headingTitleAt(state, after);
  if (heading && heading === headingTitleAt(state, before)) return null;
  return { ...target, after };
}

class LineToolsWidget extends WidgetType {
  toDOM(view: EditorView) {
    const doc = view.dom.ownerDocument;
    const controls = doc.createElement("span");
    controls.className = "cm-line-tools";
    controls.contentEditable = "false";
    const line = () => view.state.doc.lineAt(view.posAtDOM(controls)).number;
    const button = (label: string, icon: typeof Plus, className: string) => {
      const el = doc.createElement("button");
      el.type = "button";
      el.className = className;
      el.title = label;
      el.setAttribute("aria-label", label);
      el.append(lucideSvg(icon, 13));
      el.addEventListener("mousedown", (e) => e.preventDefault());
      controls.append(el);
      return el;
    };
    const add = button("Add line below and open command menu", Plus, "cm-line-add");
    const grip = button(
      "Drag to move · Double-click to select block",
      GripVertical,
      "cm-line-grip",
    );
    add.addEventListener("click", () => addBelow(view, line()));
    grip.addEventListener("pointerdown", (e) => view.plugin(blockTools)?.start(e, line()));
    grip.addEventListener("dblclick", () => selectBlock(view, line()));
    grip.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      selectBlock(view, line());
    });
    return controls;
  }
}

const toolLine = Decoration.line({ class: "cm-has-line-tools" });
const activeLine = Decoration.line({ class: "cm-line-tools-active" });
const toolsWidget = Decoration.widget({ widget: new LineToolsWidget(), side: -1 });

function decorations(view: EditorView) {
  const out: Range<Decoration>[] = [];
  const { state } = view;
  if (state.readOnly) return Decoration.none;
  const active = state.doc.lineAt(state.selection.main.head).number;
  let last = 0;
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      if (line.from >= from && line.number > last && handledBlockAt(state, line.number)) {
        out.push(toolLine.range(line.from), toolsWidget.range(line.from));
        if (line.number === active) out.push(activeLine.range(line.from));
        last = line.number;
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

export const blockTools = ViewPlugin.fromClass(
  class {
    decorations: ReturnType<typeof decorations>;
    private stopDrag?: () => void;

    constructor(readonly view: EditorView) {
      this.decorations = decorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.state.readOnly) this.stopDrag?.();
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        update.transactions.some((tr) => tr.reconfigured)
      )
        this.decorations = decorations(update.view);
    }

    destroy() {
      this.stopDrag?.();
    }

    start(event: PointerEvent, n: number) {
      const { view } = this;
      if (event.button !== 0 || view.state.readOnly || this.stopDrag) return;
      const block = handledBlockAt(view.state, n);
      if (!block) return;
      const doc = view.dom.ownerDocument;
      const win = doc.defaultView!;
      const marker = doc.createElement("div");
      marker.className = "cm-line-drop-marker";
      marker.hidden = true;
      const origin = view.state.doc;
      const { clientX: startX, clientY: startY, pointerId } = event;
      let x = startX;
      let y = startY;
      let dragging = false;
      let frame = 0;

      const boundary = () => {
        const hit = targetBoundary(view, x, y);
        return hit && (hit.after < block.first - 1 || hit.after > block.last) ? hit : null;
      };
      const paint = () => {
        const hit = boundary();
        marker.hidden = !hit;
        if (!hit) return;
        const bounds = view.contentDOM.getBoundingClientRect();
        marker.style.left = `${bounds.left}px`;
        marker.style.width = `${bounds.width}px`;
        marker.style.top = `${hit.y}px`;
      };
      const scroll = () => {
        const rect = view.scrollDOM.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
          const step = y < rect.top + 30 ? -12 : y > rect.bottom - 30 ? 12 : 0;
          if (step) {
            view.scrollDOM.scrollTop += step;
            paint();
          }
        }
        frame = win.requestAnimationFrame(scroll);
      };
      const move = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        x = e.clientX;
        y = e.clientY;
        if (!dragging) {
          if (Math.hypot(x - startX, y - startY) < DRAG_START) return;
          dragging = true;
          view.dom.classList.add("cm-line-dragging");
          doc.body.append(marker);
          frame = win.requestAnimationFrame(scroll);
        }
        e.preventDefault();
        paint();
      };
      const stop = () => {
        this.stopDrag = undefined;
        win.cancelAnimationFrame(frame);
        marker.remove();
        view.dom.classList.remove("cm-line-dragging");
        win.removeEventListener("pointermove", move);
        win.removeEventListener("pointerup", up);
        win.removeEventListener("pointercancel", cancel);
        win.removeEventListener("blur", stop);
        win.removeEventListener("keydown", key, true);
        view.scrollDOM.removeEventListener("scroll", paint);
      };
      const up = (e: PointerEvent) => {
        if (e.pointerId !== pointerId) return;
        x = e.clientX;
        y = e.clientY;
        const hit = dragging ? boundary() : null;
        stop();
        if (!hit || view.state.doc !== origin || view.state.readOnly) return;
        const spec = moveLinesToBoundary(view.state, block, hit.after);
        if (spec) {
          view.dispatch({ ...spec, userEvent: "move.drop" });
          view.focus();
        }
      };
      const cancel = (e: PointerEvent) => {
        if (e.pointerId === pointerId) stop();
      };
      const key = (e: KeyboardEvent) => {
        if (e.key !== "Escape" || !dragging) return;
        e.preventDefault();
        e.stopPropagation();
        stop();
      };
      this.stopDrag = stop;
      win.addEventListener("pointermove", move);
      win.addEventListener("pointerup", up);
      win.addEventListener("pointercancel", cancel);
      win.addEventListener("blur", stop);
      win.addEventListener("keydown", key, true);
      view.scrollDOM.addEventListener("scroll", paint);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
