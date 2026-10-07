import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { maskCode } from "../../lib/markdown";

// `$$…$$` math, rendered with KaTeX when the cursor is elsewhere (like Obsidian's live
// preview). On a line of its own it's display math; inside a sentence it's inline.
// Typing `$$` adds the closing `$$`. KaTeX and its fonts load on first use.

type Katex = typeof import("katex").default;
let katex: Katex | null = null;
let loading: Promise<Katex> | null = null;

export function loadKatex(): Promise<Katex> {
  if (katex) return Promise.resolve(katex);
  loading ??= Promise.all([import("katex"), import("katex/dist/katex.min.css")]).then(
    ([m]) => (katex = m.default),
  );
  return loading;
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }

  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }

  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "cm-math cm-math-display" : "cm-math";
    el.setAttribute("role", "math");
    el.setAttribute("aria-label", this.tex);
    el.title = "Click to edit the math";
    const render = (k: Katex) => {
      k.render(this.tex, el, {
        displayMode: this.display,
        throwOnError: false,
        output: "htmlAndMathml",
      });
      view.requestMeasure();
    };
    if (katex) render(katex);
    else {
      el.textContent = this.tex;
      void loadKatex().then(render, () => el.classList.add("cm-math-error"));
    }
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: { anchor: Math.min(pos + 2, view.state.doc.length) } });
      view.focus();
    });
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

const CODE_NODES = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "Frontmatter"]);

type Node = ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]>;

function inCode(state: EditorState, pos: number): boolean {
  for (let n: Node | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (CODE_NODES.has(n.name)) return true;
  }
  return false;
}

/**
 * `$$…$$` spans in `text` (non-empty, not escaped). Code (fenced and inline) is blanked
 * out first, so a `$$` inside code can't pair with a real one outside it.
 */
export function findMath(text: string): { from: number; to: number; tex: string }[] {
  const out: { from: number; to: number; tex: string }[] = [];
  const re = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g;
  for (const m of maskCode(text).matchAll(re)) {
    const tex = text.slice(m.index + 2, m.index + m[0].length - 2).trim();
    if (tex) out.push({ from: m.index, to: m.index + m[0].length, tex });
  }
  return out;
}

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  if (!text.includes("$$")) return Decoration.none;
  const out: Range<Decoration>[] = [];
  const sel = state.selection.main;
  for (const { from, to, tex } of findMath(text)) {
    if (inCode(state, from)) continue;
    if (sel.from <= to && sel.to >= from) continue; // being edited: show the source
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to);
    const ownLines =
      state.sliceDoc(first.from, from).trim() === "" && state.sliceDoc(to, last.to).trim() === "";
    if (ownLines) {
      out.push(
        Decoration.replace({ widget: new MathWidget(tex, true), block: true }).range(
          first.from,
          last.to,
        ),
      );
    } else if (first.number === last.number) {
      out.push(Decoration.replace({ widget: new MathWidget(tex, false) }).range(from, to));
    }
  }
  return Decoration.set(out, true);
}

const mathField = StateField.define<DecorationSet>({
  create: build,
  update: (value, tr) =>
    tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)
      ? build(tr.state)
      : value,
  provide: (f) => EditorView.decorations.from(f),
});

/** Typing the second `$` of `$$` adds the closing `$$` with the cursor between. */
const closeMath = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "$" || from !== to) return false;
  const { state } = view;
  if (state.sliceDoc(from - 1, from) !== "$" || state.sliceDoc(from - 2, from - 1) === "$")
    return false;
  if (state.sliceDoc(to, to + 2) === "$$" || inCode(state, from)) return false;
  view.dispatch({ changes: { from, insert: "$$$" }, selection: { anchor: from + 1 } });
  return true;
});

export const math = [mathField, closeMath];
