import { syntaxTree } from "@codemirror/language";
import { type EditorState, MapMode, type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { isDarkTheme, renderMermaid } from "./mermaid";
import { diagramWidth, isMermaidInfo, setDiagramWidth } from "./mermaidInfo";
import { resizeDiagram } from "./resizeDiagram";

// A click selects the rendered diagram for resizing. Double-click or move the caret
// into the block to edit its source.

const selectDiagram = StateEffect.define<number | null>();
const diagramSelection = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) if (effect.is(selectDiagram)) return effect.value;
    if (value === null || tr.selection) return null;
    return tr.changes.mapPos(value, 1, MapMode.TrackDel);
  },
});

const lineFrom = (view: EditorView, widget: HTMLElement) =>
  view.state.doc.lineAt(view.posAtDOM(widget)).from;

const selectionUI = ViewPlugin.fromClass(
  class {
    constructor(readonly view: EditorView) {}
    update(update: ViewUpdate) {
      const selected = this.view.state.field(diagramSelection);
      if (
        !update.docChanged &&
        !update.viewportChanged &&
        selected === update.startState.field(diagramSelection)
      )
        return;
      this.view.requestMeasure({
        key: this,
        read: () => null,
        write: () => {
          const current = this.view.state.field(diagramSelection);
          for (const widget of this.view.contentDOM.querySelectorAll<HTMLElement>(".cm-mermaid")) {
            if (widget.closest(".cm-editor") !== this.view.dom) continue;
            const active = current !== null && lineFrom(this.view, widget) === current;
            widget.classList.toggle("cm-mermaid-selected", active);
            widget.querySelector('[role="button"]')?.setAttribute("aria-pressed", String(active));
          }
        },
      });
    }
  },
  {
    eventHandlers: {
      mousedown(_event, view) {
        if (view.state.field(diagramSelection) !== null)
          view.dispatch({ effects: selectDiagram.of(null) });
        return false;
      },
      keydown(event, view) {
        if (event.key !== "Escape" || view.state.field(diagramSelection) === null) return false;
        view.dispatch({ effects: selectDiagram.of(null) });
        return true;
      },
    },
  },
);

const cache = new Map<string, string>();
const CACHE_SIZE = 40;

function remember(key: string, svg: string) {
  cache.delete(key);
  cache.set(key, svg);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
}

class MermaidWidget extends WidgetType {
  constructor(
    readonly code: string,
    readonly info: string,
    readonly infoOffset: number,
    readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: MermaidWidget) {
    return (
      other.code === this.code &&
      other.info === this.info &&
      other.infoOffset === this.infoOffset &&
      other.readOnly === this.readOnly
    );
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-mermaid";
    const frame = document.createElement("div");
    frame.className = "cm-mermaid-frame";
    const graphic = document.createElement("div");
    graphic.className = "cm-mermaid-graphic";
    graphic.title = this.readOnly
      ? "Double-click to view source"
      : "Click to resize. Double-click to edit source.";
    graphic.setAttribute("role", this.readOnly ? "img" : "button");
    graphic.setAttribute(
      "aria-label",
      this.readOnly ? "Mermaid diagram" : "Select diagram to resize",
    );
    if (!this.readOnly) {
      graphic.tabIndex = 0;
      graphic.setAttribute("aria-pressed", "false");
      graphic.setAttribute("aria-keyshortcuts", "F2");
    }
    frame.append(graphic);
    wrap.append(frame);
    let disposeResize: (() => void) | undefined;
    let disposed = false;
    cleanup.set(wrap, () => {
      disposed = true;
      disposeResize?.();
    });
    const width = diagramWidth(this.info);
    if (width !== null) {
      frame.style.width = `${width}px`;
      frame.dataset.sized = "";
    }
    const show = (svg: string) => {
      if (disposed) return;
      graphic.innerHTML = svg;
      if (!this.readOnly) {
        disposeResize = resizeDiagram(view, wrap, frame, width, (next) => {
          if (view.state.readOnly || !view.contentDOM.contains(wrap)) return false;
          const line = view.state.doc.lineAt(view.posAtDOM(wrap));
          const from = line.from + this.infoOffset;
          const to = from + this.info.length;
          if (to > line.to || view.state.sliceDoc(from, to) !== this.info) return false;
          view.dispatch({
            changes: { from, to, insert: setDiagramWidth(this.info, next) },
            userEvent: "input.resize",
          });
          return true;
        });
      }
      view.requestMeasure();
    };
    const dark = isDarkTheme();
    const key = `${dark}\n${this.code}`;
    const cached = cache.get(key);
    if (cached) show(cached);
    else {
      graphic.textContent = "Rendering diagram…";
      renderMermaid(this.code, dark).then(
        (svg) => {
          remember(key, svg);
          show(svg);
        },
        (e: unknown) => {
          if (disposed) return;
          wrap.classList.add("cm-mermaid-error");
          const msg = e instanceof Error ? e.message : String(e);
          graphic.textContent = `This diagram has an error: ${msg.split("\n").slice(0, 3).join(" ")}`;
          view.requestMeasure();
        },
      );
    }
    function showSource() {
      const pos = view.posAtDOM(wrap);
      const line = view.state.doc.lineAt(pos);
      const inside = Math.min(line.to + 1, view.state.doc.length);
      view.dispatch({ selection: { anchor: inside }, scrollIntoView: true });
      view.focus();
    }
    function select() {
      if (view.state.readOnly) return;
      view.dispatch({ effects: selectDiagram.of(lineFrom(view, wrap)) });
      view.focus();
    }
    wrap.addEventListener("mousedown", (event) => {
      if (event.button === 0) event.preventDefault();
    });
    graphic.addEventListener("pointerdown", (event) => {
      if (event.button === 0) select();
    });
    graphic.addEventListener("click", (event) => {
      if (event.button === 0 && event.detail === 0) select();
    });
    graphic.addEventListener("dblclick", (event) => {
      if (event.button === 0) showSource();
    });
    graphic.addEventListener("keydown", (event) => {
      if (event.key === "F2") {
        event.preventDefault();
        showSource();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    return wrap;
  }

  get estimatedHeight() {
    return 220;
  }

  destroy(dom: HTMLElement) {
    cleanup.get(dom)?.();
  }
}

const cleanup = new WeakMap<HTMLElement, () => void>();

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const info = node.node.getChild("CodeInfo");
      if (!info) return false;
      const lang = state.sliceDoc(info.from, info.to);
      if (!isMermaidInfo(lang)) return false;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      if (state.selection.ranges.some((sel) => sel.from <= last.to && sel.to >= first.from))
        return false; // being edited
      const closed = last.number > first.number && /^\s*(```|~~~)/.test(last.text);
      const codeEnd = closed ? last.from - 1 : last.to;
      const code = first.to < codeEnd ? state.sliceDoc(first.to + 1, codeEnd) : "";
      if (!code.trim()) return false;
      out.push(
        Decoration.replace({
          widget: new MermaidWidget(code, lang, info.from - first.from, state.readOnly),
          block: true,
        }).range(first.from, last.to),
      );
      return false;
    },
  });
  return Decoration.set(out, true);
}

/** Render ```mermaid blocks as diagrams (except the one being edited). */
const renderedDiagrams = StateField.define<DecorationSet>({
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

export const mermaidBlocks = [diagramSelection, renderedDiagrams, selectionUI];
