import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { isDarkTheme, renderMermaid } from "./mermaid";
import { diagramWidth, isMermaidInfo, setDiagramWidth } from "./mermaidInfo";
import { resizeDiagram } from "./resizeDiagram";

// ```mermaid code blocks render as diagrams in the editor. Putting the cursor in the
// block (or clicking the diagram) shows the code again for editing.

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
    wrap.title = "Click to edit the diagram's code";
    const frame = document.createElement("div");
    frame.className = "cm-mermaid-frame cm-image-box";
    const graphic = document.createElement("div");
    graphic.className = "cm-mermaid-graphic";
    graphic.setAttribute("role", "img");
    graphic.setAttribute("aria-label", "Mermaid diagram (click to edit)");
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
    wrap.addEventListener("mousedown", (e) => {
      if (e.button !== 0 || isResizeHandle(e)) return;
      e.preventDefault();
      const pos = view.posAtDOM(wrap);
      const line = view.state.doc.lineAt(pos);
      const inside = Math.min(line.to + 1, view.state.doc.length);
      view.dispatch({ selection: { anchor: inside }, scrollIntoView: true });
      view.focus();
    });
    return wrap;
  }

  get estimatedHeight() {
    return 220;
  }

  destroy(dom: HTMLElement) {
    cleanup.get(dom)?.();
  }

  ignoreEvent(event: Event) {
    return isResizeHandle(event);
  }
}

const cleanup = new WeakMap<HTMLElement, () => void>();

function isResizeHandle(event: Event) {
  return event.target instanceof Element && event.target.closest(".cm-image-handle") !== null;
}

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
export const mermaidBlocks = StateField.define<DecorationSet>({
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
