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
 * `$$…$$` spans in `text` (non-empty, not escaped). Code is blanked out first (`masked`
 * is `text` with code replaced by spaces; fenced and inline code by default), so a `$$`
 * inside code can't pair with a real one outside it.
 */
export function findMath(
  text: string,
  masked = maskCode(text),
): { from: number; to: number; tex: string }[] {
  const out: { from: number; to: number; tex: string }[] = [];
  const re = /(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g;
  for (const m of masked.matchAll(re)) {
    const tex = text.slice(m.index + 2, m.index + m[0].length - 2).trim();
    if (tex) out.push({ from: m.index, to: m.index + m[0].length, tex });
  }
  return out;
}

interface MathSpan {
  /** The `$$…$$` source. */
  from: number;
  to: number;
  tex: string;
  display: boolean;
  /** What the widget replaces: whole lines for display math, the span for inline. */
  rFrom: number;
  rTo: number;
}

/** Renderable math spans (outside code). Scans the document, so only on edits. */
function mathSpans(state: EditorState): MathSpan[] {
  const text = state.doc.toString();
  if (!text.includes("$$")) return [];
  // Blank out every code node the parser knows (indented code too), on top of fenced and
  // inline code anywhere (covering any part not parsed yet).
  const chars = maskCode(text).split("");
  syntaxTree(state).iterate({
    enter: (n) => {
      if (!CODE_NODES.has(n.name)) return;
      for (let i = n.from; i < n.to; i++) if (chars[i] !== "\n") chars[i] = " ";
      return false;
    },
  });
  const out: MathSpan[] = [];
  for (const { from, to, tex } of findMath(text, chars.join(""))) {
    if (inCode(state, from)) continue;
    const first = state.doc.lineAt(from);
    const last = state.doc.lineAt(to);
    const ownLines =
      state.sliceDoc(first.from, from).trim() === "" && state.sliceDoc(to, last.to).trim() === "";
    if (ownLines) out.push({ from, to, tex, display: true, rFrom: first.from, rTo: last.to });
    else if (first.number === last.number)
      out.push({ from, to, tex, display: false, rFrom: from, rTo: to });
  }
  return out;
}

interface MathState {
  spans: MathSpan[];
  /** Which spans the selection touches (shown as source), e.g. "0,3". */
  editing: string;
  deco: DecorationSet;
}

function decorate(spans: MathSpan[], state: EditorState): MathState {
  const sel = state.selection.main;
  const shown: Range<Decoration>[] = [];
  const editing: number[] = [];
  spans.forEach((s, i) => {
    if (sel.from <= s.to && sel.to >= s.from) {
      editing.push(i); // being edited: show the source
      return;
    }
    const widget = new MathWidget(s.tex, s.display);
    shown.push(
      Decoration.replace(s.display ? { widget, block: true } : { widget }).range(s.rFrom, s.rTo),
    );
  });
  return { spans, editing: editing.join(","), deco: Decoration.set(shown, true) };
}

const mathField = StateField.define<MathState>({
  create: (state) => decorate(mathSpans(state), state),
  update(value, tr) {
    // Rescan only when the text or its parse changed; a cursor move just re-checks which
    // spans it touches, and keeps the decorations if that didn't change.
    if (tr.docChanged || syntaxTree(tr.state) !== syntaxTree(tr.startState)) {
      return decorate(mathSpans(tr.state), tr.state);
    }
    if (!tr.selection) return value;
    const next = decorate(value.spans, tr.state);
    return next.editing === value.editing ? value : next;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

/**
 * Typing the second `$` of `$$` adds the closing `$$` with the cursor between. Typing a
 * `$` just before a closing `$` steps over it instead, so typing the closing `$$` by
 * hand doesn't leave an extra one.
 */
const closeMath = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== "$" || from !== to) return false;
  const { state } = view;
  if (inCode(state, from)) return false;
  const next2 = state.sliceDoc(to, to + 2);
  const stepOver =
    next2 === "$$" || (next2.startsWith("$") && state.sliceDoc(from - 1, from) === "$");
  if (stepOver) {
    view.dispatch({ selection: { anchor: to + 1 } });
    return true;
  }
  // Only after a single, unescaped `$` (`\$$` is a literal dollar and a `$`).
  const before = state.sliceDoc(from - 2, from - 1);
  if (state.sliceDoc(from - 1, from) !== "$" || before === "$" || before === "\\") return false;
  if (next2 === "$$") return false;
  view.dispatch({ changes: { from, insert: "$$$" }, selection: { anchor: from + 1 } });
  return true;
});

export const math = [mathField, closeMath];
