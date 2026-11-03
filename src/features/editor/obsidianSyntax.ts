import { syntaxTree } from "@codemirror/language";
import type { EditorState, Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  type EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import {
  Bug,
  Check,
  CircleCheck,
  CircleHelp,
  ClipboardList,
  Flame,
  Info,
  List,
  type LucideIcon,
  Pencil,
  Quote,
  TriangleAlert,
  X,
  Zap,
} from "lucide-react";
import { type CalloutBlock, calloutBlocks } from "./headingSections";
import { lucideSvg } from "./lucideSvg";

// Obsidian Markdown extensions that plain CommonMark doesn't style, so imported vaults
// look right: ==highlights==, %%comments%% and > [!type] callouts. Like the rest of the
// live preview, the markers are hidden except on the lines being edited.

const hide = Decoration.replace({});
const highlight = Decoration.mark({ class: "cm-lp-highlight" });
const comment = Decoration.mark({ class: "cm-lp-comment" });
const calloutType = Decoration.mark({ class: "cm-callout-type" });

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

/** Obsidian's callout types, their other names and icons. Colours are in editor.css. */
const KINDS: Record<string, { names: string[]; icon: LucideIcon }> = {
  note: { names: [], icon: Pencil },
  abstract: { names: ["summary", "tldr"], icon: ClipboardList },
  info: { names: [], icon: Info },
  todo: { names: [], icon: CircleCheck },
  tip: { names: ["hint", "important"], icon: Flame },
  success: { names: ["check", "done"], icon: Check },
  question: { names: ["help", "faq"], icon: CircleHelp },
  warning: { names: ["caution", "attention"], icon: TriangleAlert },
  failure: { names: ["fail", "missing"], icon: X },
  danger: { names: ["error"], icon: Zap },
  bug: { names: [], icon: Bug },
  example: { names: [], icon: List },
  quote: { names: ["cite"], icon: Quote },
};

/** Normalize a callout's type to Obsidian's kinds; unknown types look like a note. */
export function calloutKind(type: string): string {
  const t = type.toLowerCase();
  for (const [kind, { names }] of Object.entries(KINDS))
    if (kind === t || names.includes(t)) return kind;
  return "note";
}

/** A callout title's icon, and the type's name when the title is left empty. */
class CalloutIconWidget extends WidgetType {
  constructor(
    readonly kind: string,
    readonly label: string,
  ) {
    super();
  }
  eq(other: CalloutIconWidget) {
    return other.kind === this.kind && other.label === this.label;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-callout-head";
    const icon = document.createElement("span");
    icon.className = "cm-callout-icon";
    icon.append(lucideSvg(KINDS[this.kind]!.icon, 16));
    span.append(icon);
    if (this.label) span.append(this.label);
    return span;
  }
}

const calloutLine = (kind: string, ...extra: string[]) =>
  Decoration.line({ class: ["cm-callout", `cm-callout-${kind}`, ...extra].join(" ") });

export function buildObsidian(
  state: EditorState,
  ranges: readonly { from: number; to: number }[],
  /** Raw Markdown is shown on the cursor's lines only while the editor has focus. */
  focused = true,
) {
  const out: Range<Decoration>[] = [];
  const active = new Set<number>();
  if (focused)
    for (const r of state.selection.ranges)
      for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++)
        active.add(n);
  const callouts = calloutBlocks(state);

  for (const { from, to } of ranges) {
    // The callouts on screen; toggles are drawn by toggles.ts.
    const top = state.doc.lineAt(from).number;
    const bottom = state.doc.lineAt(to).number;
    for (const c of callouts) {
      if (c.last < top || c.head[1]!.toLowerCase() === "toggle") continue;
      if (c.first > bottom) break;
      drawCallout(state, c, Math.max(top, c.first), Math.min(bottom, c.last), active, out);
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

/**
 * A callout as Obsidian draws it: a tinted box with the type's icon and a coloured title,
 * then the inside. Off the title line, `[!type]±` gives way to the icon (and the type's
 * name, if there's no title). Folding is in toggles.ts.
 */
function drawCallout(
  state: EditorState,
  { first, last, head }: CalloutBlock,
  /** The visible lines of it. */
  top: number,
  bottom: number,
  active: Set<number>,
  out: Range<Decoration>[],
) {
  const kind = calloutKind(head[1]!);
  for (let n = top; n <= bottom; n++) {
    const cls = [n === first ? "cm-callout-title" : n === first + 1 ? "cm-callout-body-first" : ""];
    if (n === last) cls.push("cm-callout-last");
    out.push(calloutLine(kind, ...cls.filter(Boolean)).range(state.doc.line(n).from));
  }
  if (top > first) return;
  const title = state.doc.line(first);
  const start = title.from + title.text.indexOf("[");
  if (active.has(first)) {
    out.push(calloutType.range(start, title.from + title.text.indexOf("]") + 1));
    return;
  }
  const end = title.from + head[0].length;
  const name = head[1]!;
  const label = end < title.to ? "" : name[0]!.toUpperCase() + name.slice(1).toLowerCase();
  out.push(Decoration.replace({ widget: new CalloutIconWidget(kind, label) }).range(start, end));
}

export const obsidianSyntax = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildObsidian(view.state, view.visibleRanges, view.hasFocus);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged)
        this.decorations = buildObsidian(u.state, u.view.visibleRanges, u.view.hasFocus);
    }
  },
  { decorations: (p) => p.decorations },
);
