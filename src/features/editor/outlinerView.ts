import { indentWithTab } from "@codemirror/commands";
import { foldGutter, foldKeymap } from "@codemirror/language";
import { type Range, Prec } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  keymap,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { blockAt, indentListItem, moveBlock, moveBlockTo, outlineFolding } from "./outliner";

// Keyboard outlining is always on (Tab/Shift-Tab, Alt+↑/↓, fold keys). "Outline view"
// adds a fold gutter and drag handles on list items and headings.

const DRAG_TYPE = "application/x-axis-block";

export const outlinerKeys = [
  outlineFolding,
  Prec.high(
    keymap.of([
      {
        key: "Tab",
        run: (view) => {
          const spec = indentListItem(view.state, 1);
          if (spec) view.dispatch(spec);
          return spec !== null || (indentWithTab.run?.(view) ?? false);
        },
        shift: (view) => {
          const spec = indentListItem(view.state, -1);
          if (spec) view.dispatch(spec);
          return spec !== null || (indentWithTab.shift?.(view) ?? false);
        },
      },
      {
        key: "Alt-ArrowUp",
        run: (view) => {
          const spec = moveBlock(view.state, -1);
          if (spec) view.dispatch(spec);
          return spec !== null;
        },
      },
      {
        key: "Alt-ArrowDown",
        run: (view) => {
          const spec = moveBlock(view.state, 1);
          if (spec) view.dispatch(spec);
          return spec !== null;
        },
      },
    ]),
  ),
  keymap.of(foldKeymap),
];

class HandleWidget extends WidgetType {
  constructor(readonly line: number) {
    super();
  }
  eq(other: HandleWidget) {
    return other.line === this.line;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-outline-handle";
    el.textContent = "⠿";
    el.draggable = true;
    el.title = "Drag to move";
    el.setAttribute("aria-hidden", "true");
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer?.setData(DRAG_TYPE, String(this.line));
      e.dataTransfer?.setData("text/plain", "");
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function handles(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = view.state.doc.lineAt(pos);
      if (blockAt(view.state, line.number)) {
        out.push(
          Decoration.widget({ widget: new HandleWidget(line.number), side: -1 }).range(line.from),
        );
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out);
}

const handlePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = handles(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) this.decorations = handles(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const dropHandler = EditorView.domEventHandlers({
  dragover(e) {
    if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return false;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    return true;
  },
  drop(e, view) {
    const from = Number(e.dataTransfer?.getData(DRAG_TYPE));
    if (!from) return false;
    e.preventDefault();
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
    if (pos === null) return true;
    const line = view.state.doc.lineAt(pos);
    const box = view.coordsAtPos(line.from);
    const after = box ? e.clientY > (box.top + box.bottom) / 2 : false;
    const spec = moveBlockTo(view.state, from, line.number, after);
    if (spec) view.dispatch({ ...spec, userEvent: "move.drop" });
    return true;
  },
});

export const outlineView = [foldGutter({ markerDOM: undefined }), handlePlugin, dropHandler];
