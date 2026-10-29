import { ensureSyntaxTree, LanguageDescription, syntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { mathRanges } from "./math";
import { VERBATIM } from "./listAutoformat";

type SyntaxNode = ReturnType<typeof syntaxTree>["topNode"];

// Obsidian-style live preview: Markdown syntax marks are hidden on lines that don't
// hold the cursor/selection, and the text is styled as rendered Markdown. Everything is
// derived from the Lezer Markdown syntax tree, only for the requested (visible) ranges.

/** The language of a code block, shown in its top-right corner (like Obsidian). */
class CodeLanguageWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  eq(other: CodeLanguageWidget) {
    return other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-code-lang";
    span.textContent = this.label;
    return span;
  }
}

/** `python`, `PY` or `js` → the language's name ("Python", "JavaScript"); else as typed. */
export function codeLanguageLabel(info: string): string {
  const name = info.trim().split(/\s/)[0] ?? "";
  if (!name) return "";
  const lower = name.toLowerCase();
  const found =
    LanguageDescription.matchLanguageName(languages, lower, true) ??
    LanguageDescription.matchFilename(languages, `code.${lower}`);
  return found?.name ?? name;
}

/** The width of one indent level in a code block's lines: a tab, or its smallest indent. */
function indentUnit(lines: string[]): string {
  let unit = 0;
  for (const text of lines) {
    const m = /^( +)\S/.exec(text);
    if (m && (unit === 0 || m[1]!.length < unit)) unit = m[1]!.length;
  }
  return " ".repeat(Math.max(2, Math.min(unit || 4, 8)));
}

const indentGuide = Decoration.mark({ class: "cm-code-indent" });

class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-lp-bullet";
    span.textContent = "•";
    return span;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const hr = document.createElement("span");
    hr.className = "cm-lp-hr";
    return hr;
  }
}

export class CheckboxWidget extends WidgetType {
  /** `markerFrom` is the position of the `[` in `[ ]` / `[x]`. */
  constructor(
    readonly checked: boolean,
    readonly markerFrom: number,
  ) {
    super();
  }
  eq(other: CheckboxWidget) {
    return other.checked === this.checked && other.markerFrom === this.markerFrom;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-lp-task";
    box.checked = this.checked;
    box.setAttribute("aria-label", this.checked ? "Completed task" : "Task");
    box.addEventListener("mousedown", (e) => {
      e.preventDefault();
      toggleTask(view, this.markerFrom);
    });
    return box;
  }
  ignoreEvent() {
    return true;
  }
}

/** Flip `[ ]` <-> `[x]` for the task marker starting at `markerFrom`. */
export function toggleTask(view: EditorView, markerFrom: number) {
  const inner = view.state.sliceDoc(markerFrom + 1, markerFrom + 2);
  const next = inner === " " ? "x" : " ";
  view.dispatch({ changes: { from: markerFrom + 1, to: markerFrom + 2, insert: next } });
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const rule = Decoration.replace({ widget: new RuleWidget() });
const mark = (cls: string) => Decoration.mark({ class: cls });
const line = (cls: string) => Decoration.line({ class: cls });

const MARKS = {
  StrongEmphasis: mark("cm-lp-strong"),
  Emphasis: mark("cm-lp-em"),
  Strikethrough: mark("cm-lp-strike"),
  InlineCode: mark("cm-lp-code"),
} as const;
const linkMark = mark("cm-lp-link");

/** Line numbers (1-based) touched by any selection range. */
function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** Extend a hidden mark over one following space, e.g. `# ` or `> `. */
function withSpace(state: EditorState, to: number): number {
  return state.sliceDoc(to, to + 1) === " " ? to + 1 : to;
}

/**
 * Build live-preview decorations for `ranges` (default: the whole document).
 * Pure over the EditorState, so it can be unit-tested without a view.
 */
export function buildDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
  /** Raw Markdown is shown on the cursor's lines only while the editor has focus. */
  focused = true,
): DecorationSet {
  const tree =
    ensureSyntaxTree(state, Math.max(...ranges.map((r) => r.to), 0), 200) ?? syntaxTree(state);
  const active = focused ? activeLines(state) : new Set<number>();
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number);
  const out: Range<Decoration>[] = [];
  const lineClass = (pos: number, cls: string) =>
    out.push(line(cls).range(state.doc.lineAt(pos).from));
  const hideRange = (from: number, to: number) => {
    if (to > from && !isActive(from)) out.push(hide.range(from, to));
  };
  /** A selection on `from..to` (inclusive): a list marker shows raw only then. */
  const touched = (from: number, to: number) =>
    focused && state.selection.ranges.some((r) => r.from <= to && r.to >= from);
  // A `-` in an equation is a minus sign, shown as typed while the equation is edited.
  const maths = mathRanges(state);
  const inMath = (pos: number) => maths.some((m) => pos > m.from && pos < m.to);

  for (const { from, to } of ranges) {
    tree.iterate({
      from,
      to,
      enter(ref) {
        const node = ref.node;
        const name = node.name;

        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          lineClass(node.from, `cm-lp-h cm-lp-h${heading[1]}`);
          return;
        }
        if (name in MARKS && node.to > node.from) {
          out.push(MARKS[name as keyof typeof MARKS].range(node.from, node.to));
        }

        switch (name) {
          case "HeaderMark":
            // Only the leading #'s (a closing "###" sequence is left visible).
            if (node.parent?.name.startsWith("ATXHeading") && node.from === node.parent.from) {
              hideRange(node.from, withSpace(state, node.to));
            }
            break;
          case "EmphasisMark":
          case "StrikethroughMark":
            hideRange(node.from, node.to);
            break;
          case "CodeMark":
            // Inline code backticks only; fenced-code fences are styled as lines instead.
            if (node.parent?.name === "InlineCode") hideRange(node.from, node.to);
            break;
          case "Link":
            // Only inline links `[text](url)`. Bare `[text]` (e.g. inside `[[wikilinks]]`)
            // is left alone; wikilinks get their own handling in Phase 1.
            if (node.getChild("URL")) {
              out.push(linkMark.range(node.from, node.to));
              hideLinkSyntax(node, hideRange);
            }
            return false;
          case "Blockquote":
            for (let pos = node.from; pos <= node.to;) {
              const l = state.doc.lineAt(pos);
              lineClass(l.from, "cm-lp-quote");
              pos = l.to + 1;
            }
            break;
          case "QuoteMark":
            hideRange(node.from, withSpace(state, node.to));
            break;
          case "ListMark":
            if (node.parent?.parent?.name === "BulletList" && !hasTask(node.parent)) {
              if (!touched(node.from, node.to) && !inMath(node.from))
                out.push(bullet.range(node.from, node.to));
            }
            break;
          case "Task":
            taskDecoration(state, node, isActive, out);
            break;
          case "HorizontalRule":
            if (!isActive(node.from)) out.push(rule.range(node.from, node.to));
            break;
          case "FencedCode": {
            const first = state.doc.lineAt(node.from).number;
            const last = state.doc.lineAt(node.to).number;
            const info = node.getChild("CodeInfo");
            const language = info ? state.sliceDoc(info.from, info.to) : "";
            const closed = last > first && /^\s*(`{3,}|~{3,})\s*$/.test(state.doc.line(last).text);
            // The fences show as typed while a selection is in the block; else the block is
            // a box with its language in the corner. Mermaid blocks draw as diagrams.
            const editing = touched(node.from, node.to) || /^mermaid$/i.test(language.trim());
            const body: { from: number; text: string }[] = [];
            for (let n = first; n <= last; n++) {
              const l = state.doc.line(n);
              const fence = n === first || (n === last && closed);
              const cls = ["cm-lp-codeblock"];
              if (n === first) cls.push("cm-lp-code-first");
              if (n === last) cls.push("cm-lp-code-last");
              if (fence) cls.push(editing ? "cm-lp-fence" : "cm-lp-fence cm-lp-fence-hidden");
              out.push(line(cls.join(" ")).range(l.from));
              if (!fence) body.push({ from: l.from, text: l.text });
            }
            if (!editing) {
              const open = state.doc.line(first);
              const label = codeLanguageLabel(language);
              out.push(
                (label
                  ? Decoration.replace({ widget: new CodeLanguageWidget(label) })
                  : hide
                ).range(open.from, open.to),
              );
              if (closed) {
                const end = state.doc.line(last);
                if (end.to > end.from) out.push(hide.range(end.from, end.to));
              }
            }
            // Indent guides: a thin line at each indent level of the code.
            const unit = indentUnit(body.map((b) => b.text));
            for (const { from: lineFrom, text } of body) {
              for (let i = 0; i < text.length;) {
                const step = text[i] === "\t" ? 1 : text.startsWith(unit, i) ? unit.length : 0;
                if (!step || !/\S/.test(text.slice(i + step))) break;
                out.push(indentGuide.range(lineFrom + i, lineFrom + i + step));
                i += step;
              }
            }
            return false;
          }
        }
        return undefined;
      },
    });
  }
  // A bullet just started (`- ` with nothing after it yet) is still paragraph text to the
  // parser when it follows a paragraph; show it as a bullet anyway while it's typed.
  for (const n of active) {
    const l = state.doc.line(n);
    const m = /^(\s*)[-*+] $/.exec(l.text);
    if (!m) continue;
    const at = l.from + m[1]!.length;
    if (!ranges.some((r) => at >= r.from && at <= r.to) || touched(at, at + 1) || inMath(at))
      continue;
    let plain = true;
    for (let node: SyntaxNode | null = tree.resolveInner(at, 1); node; node = node.parent) {
      if (node.name === "ListMark" || VERBATIM.test(node.name)) plain = false;
    }
    if (plain) out.push(bullet.range(at, at + 1));
  }
  return Decoration.set(out, true);
}

function hasTask(listItem: SyntaxNode): boolean {
  return listItem.getChild("Task") !== null;
}

/** `[text](url)` shows only `text`: hide `[`, and everything from `]` to the end. */
function hideLinkSyntax(link: SyntaxNode, hideRange: (from: number, to: number) => void) {
  const marks = link.getChildren("LinkMark");
  if (marks.length < 2) return;
  const open = marks[0]!;
  const close = marks[1]!;
  hideRange(open.from, open.to);
  hideRange(close.from, link.to);
}

function taskDecoration(
  state: EditorState,
  task: SyntaxNode,
  isActive: (pos: number) => boolean,
  out: Range<Decoration>[],
) {
  const marker = task.getChild("TaskMarker");
  if (!marker) return;
  const checked = /x/i.test(state.sliceDoc(marker.from, marker.to));
  const textFrom = withSpace(state, marker.to);
  if (checked && task.to > textFrom) out.push(mark("cm-lp-done").range(textFrom, task.to));
  if (isActive(marker.from)) return;
  // Replace "- [ ]" (list mark through task marker) with a checkbox.
  const listMark = task.parent?.getChild("ListMark");
  const from = listMark ? listMark.from : marker.from;
  out.push(
    Decoration.replace({ widget: new CheckboxWidget(checked, marker.from) }).range(
      from,
      withSpace(state, marker.to),
    ),
  );
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state, view.visibleRanges, view.hasFocus);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.focusChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState)
      ) {
        this.decorations = buildDecorations(u.state, u.view.visibleRanges, u.view.hasFocus);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
