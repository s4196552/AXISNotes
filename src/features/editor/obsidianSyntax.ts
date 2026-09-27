import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";

// Obsidian Markdown extensions that plain CommonMark doesn't style, so imported vaults
// look right: ==highlights==, %%comments%% and > [!type] callouts. Like the rest of the
// live preview, the markers are hidden except on the lines being edited.

const hide = Decoration.replace({});
const highlight = Decoration.mark({ class: "cm-lp-highlight" });
const comment = Decoration.mark({ class: "cm-lp-comment" });
const calloutType = Decoration.mark({ class: "cm-callout-type" });
const calloutLine = (type: string, first: boolean) =>
  Decoration.line({
    class: `cm-callout cm-callout-${type}${first ? " cm-callout-first" : ""}`,
  });

const CODE = new Set(["FencedCode", "CodeBlock", "InlineCode", "CodeText"]);

function inCode(state: EditorState, pos: number): boolean {
  for (
    let n: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(pos, 1);
    n;
    n = n.parent
  )
    if (CODE.has(n.name)) return true;
  return false;
}

/** Normalize Obsidian's callout names to a few styles. */
export function calloutKind(type: string): string {
  const t = type.toLowerCase();
  if (["tip", "hint", "important", "success", "check", "done"].includes(t)) return "tip";
  if (
    [
      "warning",
      "caution",
      "attention",
      "danger",
      "error",
      "bug",
      "failure",
      "fail",
      "missing",
    ].includes(t)
  )
    return "warning";
  if (["question", "help", "faq"].includes(t)) return "question";
  if (["quote", "cite", "example"].includes(t)) return "quote";
  return "note";
}

export function buildObsidian(state: EditorState, ranges: readonly { from: number; to: number }[]) {
  const out: Range<Decoration>[] = [];
  const active = new Set<number>();
  for (const r of state.selection.ranges)
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++)
      active.add(n);

  for (const { from, to } of ranges) {
    // Callouts: find the start of a blockquote that begins before the visible range.
    let lineNo = state.doc.lineAt(from).number;
    while (lineNo > 1 && /^>/.test(state.doc.line(lineNo - 1).text)) lineNo--;
    let callout: string | null = null;
    for (; lineNo <= state.doc.lines; lineNo++) {
      const line = state.doc.line(lineNo);
      if (line.from > to && !callout) break;
      if (line.from > to) break;
      const head = /^>\s*\[!([\w-]+)\]([+-]?)/.exec(line.text);
      if (head && !inCode(state, line.from)) {
        callout = calloutKind(head[1]!);
        if (line.from >= from) {
          out.push(calloutLine(callout, true).range(line.from));
          const start = line.from + line.text.indexOf("[");
          const end = start + head[1]!.length + 3;
          out.push(calloutType.range(start, end));
        }
      } else if (callout && /^>/.test(line.text)) {
        if (line.from >= from) out.push(calloutLine(callout, false).range(line.from));
      } else {
        callout = null;
      }
    }

    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(/==(?=\S)([^=\n]*?\S)==/g)) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (inCode(state, start)) continue;
      const editing = active.has(state.doc.lineAt(start).number);
      if (!editing) out.push(hide.range(start, start + 2));
      out.push(highlight.range(start + 2, end - 2));
      if (!editing) out.push(hide.range(end - 2, end));
    }
    for (const m of text.matchAll(/%%[\s\S]*?%%/g)) {
      const start = from + m.index;
      if (inCode(state, start)) continue;
      out.push(comment.range(start, start + m[0].length));
    }
  }
  return Decoration.set(out, true);
}

export const obsidianSyntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildObsidian(view.state, view.visibleRanges);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet)
        this.decorations = buildObsidian(u.state, u.view.visibleRanges);
    }
  },
  { decorations: (p) => p.decorations },
);
