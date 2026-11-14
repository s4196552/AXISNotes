import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// Bionic Reading (Settings → Appearance → Typography): the start of each word is drawn bold
// so the eye can skim along the bold parts. It is only a decoration in rendered (live
// preview) text: the Markdown file never changes, and lines being edited stay plain.

/** How many letters of a word of `length` letters are bold. */
export function bionicPrefix(length: number): number {
  if (length <= 3) return 1;
  if (length === 4) return 2;
  return Math.ceil(length * 0.45);
}

/** Words: letters, with joined apostrophes and hyphens (`don't`, `well-known`). */
const WORD = /\p{L}[\p{L}\p{M}]*(?:['’-]\p{L}[\p{L}\p{M}]*)*/gu;

/** The bold start of every word in `text`, as [from, to) offsets. */
export function bionicRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(WORD)) {
    // Count letters (code points), not UTF-16 units, but return string offsets.
    const letters = [...m[0]];
    const bold = letters.slice(0, bionicPrefix(letters.length)).join("").length;
    out.push([m.index, m.index + bold]);
  }
  return out;
}

/** Syntax that isn't prose: code, URLs, HTML, comments, math and frontmatter. */
const SKIP = /Code|URL|HTML|Comment|Math|Frontmatter|YAML|LinkLabel|Autolink/;
const bold = Decoration.mark({ class: "cm-bionic" });

/** Bold word starts in `ranges` of the document, skipping lines being edited and non-prose. */
export function bionicDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
): DecorationSet {
  const editing = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) editing.add(n);
  }
  const tree = syntaxTree(state);
  const marks: Range<Decoration>[] = [];
  for (const { from, to } of ranges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos);
      pos = line.to + 1;
      if (editing.has(line.number) || !line.text.trim()) continue;
      for (const [a, b] of bionicRanges(line.text)) {
        const start = line.from + a;
        let skip = false;
        // The innermost node at the word decides (a word inside `code` stays plain).
        for (
          let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(start, 1);
          node;
          node = node.parent
        )
          if (SKIP.test(node.name)) {
            skip = true;
            break;
          }
        if (!skip) marks.push(bold.range(start, line.from + b));
      }
    }
  }
  return Decoration.set(marks, true);
}

const build = (view: EditorView) => bionicDecorations(view.state, view.visibleRanges);

/** The Bionic Reading decoration; add it only while the setting is on. */
export const bionicReading = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.state) !== syntaxTree(u.startState)
      )
        this.decorations = build(u.view);
    }
  },
  { decorations: (p) => p.decorations },
);
