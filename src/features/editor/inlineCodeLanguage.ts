import { ensureSyntaxTree, LanguageDescription, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { type EditorState, type Range, StateEffect } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { highlightTree } from "@lezer/highlight";
import { insideMath } from "./math";
import { axisHighlight } from "./theme";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

// Inline code in a language: `Java`String greeting = "Hello, World!";``
// A code span holding a language name, then the code with no space before it, then two
// closing backticks (so the code may hold a single one, as in `js`a = `b`;``). The code is
// coloured like a fenced block in that language, and off the cursor's line the `Java` span
// and the closing backticks are hidden. Any language the code blocks know works, by name,
// alias or file extension (`python`, `js`, `py`, `C++`).
// The file keeps exactly what was typed; other Markdown apps show `Java` as inline code
// followed by plain text and two backticks.

/** A language span and the code after it: `from` `Java` codeFrom code codeTo `` to. */
export interface TaggedCode {
  from: number;
  codeFrom: number;
  codeTo: number;
  to: number;
  language: LanguageDescription;
}

/** `Java` at the start of the text, and what follows it. */
const TAG = /^`([A-Za-z][\w+#.-]*)`/;
/** Code never starts with a space or prose punctuation: "`python`, `java`", "`npm`'s". */
const CODE_START = /[^\s`,.;:!?)\]}'’]/;
/** Where a tagged span ends: two backticks, the last two of a longer run. */
const CLOSE = /``(?!`)/g;
/** Blocks whose lines are kept as written, so a tagged span there is only text. */
const BLOCKS =
  /^(FencedCode|CodeBlock|Frontmatter|HTMLBlock|CommentBlock|ProcessingInstructionBlock)$/;

/** `java`, `JS`, `py` or `C++` → its language; null for anything else. */
export function findLanguage(name: string): LanguageDescription | null {
  const lower = name.toLowerCase();
  return (
    LanguageDescription.matchLanguageName(languages, lower, false) ??
    LanguageDescription.matchFilename(languages, `code.${lower}`)
  );
}

interface Scan {
  /** Tagged spans, with offsets in the scanned text. */
  spans: TaggedCode[];
  /** How the text ends: inside a tagged span, after a backtick run not closed yet, or neither. */
  open: "tagged" | "code" | null;
}

/**
 * Backtick runs on one line, left to right. A single backtick starting `lang`code`` opens a
 * tagged span that runs to the next pair of backticks (the last two of a longer run); any
 * other run is a code span up to the next run of the same length, as in Markdown.
 * Backslash-escaped backticks are text.
 */
function scan(text: string): Scan {
  const spans: Scan["spans"] = [];
  let open: Scan["open"] = null;
  for (let i = 0; i < text.length;) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch !== "`") {
      i++;
      continue;
    }
    let run = 1;
    while (text[i + run] === "`") run++;
    const tag = run === 1 ? TAG.exec(text.slice(i)) : null;
    const codeFrom = tag ? i + tag[0].length : 0;
    const language = tag && CODE_START.test(text[codeFrom] ?? "") ? findLanguage(tag[1]!) : null;
    if (language) {
      CLOSE.lastIndex = codeFrom;
      const close = CLOSE.exec(text)?.index ?? -1;
      if (close < 0) return { spans, open: "tagged" };
      spans.push({ from: i, codeFrom, codeTo: close, to: close + 2, language });
      i = close + 2;
      continue;
    }
    // An ordinary code span: its closer is the next run of exactly the same length.
    const closer = new RegExp(`(?<!\`)\`{${run}}(?!\`)`, "g");
    closer.lastIndex = i + run;
    const m = closer.exec(text);
    if (m) i = m.index + run;
    else {
      open = "code";
      i += run;
    }
  }
  return { spans, open };
}

/** Whether `pos` is in a code block, frontmatter, raw HTML, a comment or `$$` math. */
function inBlock(state: EditorState, pos: number): boolean {
  const tree = ensureSyntaxTree(state, pos, 50) ?? syntaxTree(state);
  for (let n: SyntaxNode | null = tree.resolveInner(pos, 1); n; n = n.parent)
    if (BLOCKS.test(n.name)) return true;
  return insideMath(state, pos);
}

/** The tagged code spans on the lines of `ranges`. */
export function taggedCode(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
): TaggedCode[] {
  const found: TaggedCode[] = [];
  for (const range of ranges) {
    for (let pos = range.from; pos <= range.to;) {
      const line = state.doc.lineAt(pos);
      if (line.text.includes("`"))
        for (const t of scan(line.text).spans)
          if (!inBlock(state, line.from + t.from))
            found.push({
              from: line.from + t.from,
              codeFrom: line.from + t.codeFrom,
              codeTo: line.from + t.codeTo,
              to: line.from + t.to,
              language: t.language,
            });
      pos = line.to + 1;
    }
  }
  return found;
}

/**
 * How a line up to the cursor ends: inside a tagged span still being typed, after a
 * backtick that may yet open inline code, or in plain text (null).
 */
export function openCode(before: string): "tagged" | "code" | null {
  return before.includes("`") ? scan(before).open : null;
}

/** Inside an open span, characters go in as typed: no paired marks, lists or symbols. */
const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  if (view.composing || from !== to || state.selection.ranges.length > 1) return false;
  if (text.length !== 1 || text === "\n") return false;
  const before = state.sliceDoc(state.doc.lineAt(from).from, from);
  if (openCode(before) !== "tagged" || inBlock(state, from)) return false;
  view.dispatch({
    changes: { from, insert: text },
    selection: { anchor: from + 1 },
    userEvent: "input.type",
    scrollIntoView: true,
  });
  return true;
});

const languageLoaded = StateEffect.define<null>();
const hide = Decoration.replace({});
const codeMark = Decoration.mark({ class: "cm-lp-code" });
const tokenMarks = new Map<string, Decoration>();
const tokenMark = (cls: string) => {
  let mark = tokenMarks.get(cls);
  if (!mark) tokenMarks.set(cls, (mark = Decoration.mark({ class: cls })));
  return mark;
};

/** Decorations for the tagged spans; `load` is called for languages not loaded yet. */
export function buildTaggedDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  focused: boolean,
  load: (language: LanguageDescription) => void = () => {},
): DecorationSet {
  const active = new Set<number>();
  if (focused)
    for (const r of state.selection.ranges)
      for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++)
        active.add(n);
  const out: Range<Decoration>[] = [];
  for (const t of taggedCode(state, ranges)) {
    const raw = active.has(state.doc.lineAt(t.from).number);
    if (raw) out.push(codeMark.range(t.from, t.to));
    else {
      out.push(hide.range(t.from, t.codeFrom), codeMark.range(t.codeFrom, t.codeTo));
      out.push(hide.range(t.codeTo, t.to));
    }
    const support = t.language.support;
    if (!support) {
      load(t.language);
      continue;
    }
    const code = state.sliceDoc(t.codeFrom, t.codeTo);
    highlightTree(support.language.parser.parse(code), axisHighlight, (from, to, cls) =>
      out.push(tokenMark(cls).range(t.codeFrom + from, t.codeFrom + to)),
    );
  }
  return Decoration.set(out, true);
}

const render = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    loading = new Set<LanguageDescription>();
    destroyed = false;
    constructor(readonly view: EditorView) {
      this.decorations = this.build(view);
    }
    build(view: EditorView) {
      return buildTaggedDecorations(view.state, view.visibleRanges, view.hasFocus, (lang) => {
        if (this.loading.has(lang)) return;
        this.loading.add(lang);
        void lang.load().then(
          () => {
            if (!this.destroyed) this.view.dispatch({ effects: languageLoaded.of(null) });
          },
          () => {}, // An unloadable language just stays uncoloured.
        );
      });
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.selectionSet ||
        u.focusChanged ||
        u.viewportChanged ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(languageLoaded)))
      )
        this.decorations = this.build(u.view);
    }
    destroy() {
      this.destroyed = true;
    }
  },
  { decorations: (v) => v.decorations },
);

/** Goes before the other typing rules, so code inside a span is kept as typed. */
export const inlineCodeLanguage = [typing, render];
