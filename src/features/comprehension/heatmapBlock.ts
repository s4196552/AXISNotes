import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { Root } from "react-dom/client";
import { BLOCK_LANG, blockText, parseBlock, type UnitMode } from "./model";

// A comprehension heatmap in a note (T-261): a ```heatmap block with `title:`, `unit:`
// and `source:` lines renders as the card while the cursor is outside it. Moving the
// cursor in (or "Edit source") shows the text; the Markdown is all that's saved. The card
// itself loads the first time a note has one.

export const isHeatmapInfo = (info: string) => info.trim().toLowerCase() === BLOCK_LANG;

const roots = new WeakMap<HTMLElement, { root?: Root; gone?: boolean }>();

/** The ```heatmap block starting on the line at `pos`, if it still has `body`. */
function blockAt(state: EditorState, pos: number, body: string) {
  const line = state.doc.lineAt(pos);
  const hits: { from: number; to: number }[] = [];
  syntaxTree(state).iterate({
    from: line.from,
    to: line.to,
    enter: (n) => {
      if (n.name === "FencedCode" && n.from >= line.from && n.from <= line.to)
        hits.push({ from: n.from, to: n.to });
      return !hits.length;
    },
  });
  const found = hits[0];
  if (!found) return null;
  const first = state.doc.lineAt(found.from);
  return state.sliceDoc(first.to + 1, found.to).includes(body) ? found : null;
}

class HeatmapWidget extends WidgetType {
  constructor(readonly body: string) {
    super();
  }

  eq(other: HeatmapWidget) {
    return other.body === this.body;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-heatmap";
    const entry: { root?: Root; gone?: boolean } = {};
    roots.set(wrap, entry);
    const spec = parseBlock(this.body);
    const body = this.body;
    const editSource = () => {
      const line = view.state.doc.lineAt(view.posAtDOM(wrap));
      view.dispatch({ selection: { anchor: Math.min(line.to + 1, view.state.doc.length) } });
      view.focus();
    };
    const setUnit = (unit: UnitMode) => {
      const block = blockAt(view.state, view.posAtDOM(wrap), body);
      if (!block || view.state.readOnly) return;
      view.dispatch({
        changes: { ...block, insert: blockText({ ...spec, unit }) },
        userEvent: "input.heatmap",
      });
    };
    void import("./HeatmapBlockCard").then(({ mountBlockCard }) => {
      if (entry.gone) return;
      entry.root = mountBlockCard(wrap, {
        spec,
        readOnly: view.state.readOnly,
        onEditSource: editSource,
        onUnitChange: setUnit,
      });
      view.requestMeasure();
    });
    return wrap;
  }

  // The card handles its own clicks and keys.
  ignoreEvent() {
    return true;
  }

  get estimatedHeight() {
    return 360;
  }

  destroy(dom: HTMLElement) {
    const entry = roots.get(dom);
    roots.delete(dom);
    if (!entry) return;
    entry.gone = true;
    // Unmount after CodeMirror's update (React can't unmount while rendering).
    const root = entry.root;
    if (root) queueMicrotask(() => root.unmount());
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const info = node.node.getChild("CodeInfo");
      if (!info || !isHeatmapInfo(state.sliceDoc(info.from, info.to))) return false;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      if (state.selection.ranges.some((sel) => sel.from <= last.to && sel.to >= first.from))
        return false; // being edited
      const closed = last.number > first.number && /^\s*(```|~~~)/.test(last.text);
      const end = closed ? last.from - 1 : last.to;
      const body = first.to < end ? state.sliceDoc(first.to + 1, end) : "";
      out.push(
        Decoration.replace({ widget: new HeatmapWidget(body), block: true }).range(
          first.from,
          last.to,
        ),
      );
      return false;
    },
  });
  return Decoration.set(out, true);
}

/** Render ```heatmap blocks as comprehension heatmaps (except the one being edited). */
export const heatmapBlocks = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) =>
    tr.docChanged ||
    tr.selection ||
    tr.reconfigured ||
    syntaxTree(tr.state) !== syntaxTree(tr.startState)
      ? build(tr.state)
      : value,
  provide: (f) => EditorView.decorations.from(f),
});
