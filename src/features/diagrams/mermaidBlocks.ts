import "./diagrams.css";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { isDarkTheme, renderMermaid } from "./mermaid";

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
  constructor(readonly code: string) {
    super();
  }

  eq(other: MermaidWidget) {
    return other.code === this.code;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-mermaid";
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "Mermaid diagram (click to edit)");
    wrap.title = "Click to edit the diagram's code";
    const dark = isDarkTheme();
    const key = `${dark}\n${this.code}`;
    const cached = cache.get(key);
    if (cached) wrap.innerHTML = cached;
    else {
      wrap.textContent = "Rendering diagram…";
      renderMermaid(this.code, dark).then(
        (svg) => {
          remember(key, svg);
          wrap.innerHTML = svg;
          view.requestMeasure();
        },
        (e: unknown) => {
          wrap.classList.add("cm-mermaid-error");
          const msg = e instanceof Error ? e.message : String(e);
          wrap.textContent = `This diagram has an error: ${msg.split("\n").slice(0, 3).join(" ")}`;
        },
      );
    }
    wrap.addEventListener("mousedown", (e) => {
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

  ignoreEvent() {
    return false;
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const sel = state.selection.main;
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const info = node.node.getChild("CodeInfo");
      const lang = info ? state.sliceDoc(info.from, info.to).trim().toLowerCase() : "";
      if (lang !== "mermaid") return false;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      if (sel.from <= last.to && sel.to >= first.from) return false; // being edited
      const closed = last.number > first.number && /^\s*(```|~~~)/.test(last.text);
      const codeEnd = closed ? last.from - 1 : last.to;
      const code = first.to < codeEnd ? state.sliceDoc(first.to + 1, codeEnd) : "";
      if (!code.trim()) return false;
      out.push(
        Decoration.replace({ widget: new MermaidWidget(code), block: true }).range(
          first.from,
          last.to,
        ),
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
    tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)
      ? build(tr.state)
      : value,
  provide: (f) => EditorView.decorations.from(f),
});
