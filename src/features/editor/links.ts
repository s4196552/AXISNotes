import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { type EditorState, Facet, type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { NoteRef } from "../../ipc";
import { parseWikilinkInner, splitFrontmatter } from "../../lib/markdown";

// Wikilinks, #tags and frontmatter in the editor: live-preview rendering, click-to-open,
// and `[[` autocomplete. Host callbacks come in through the `linkHost` facet.

export interface LinkHost {
  /** Follow a wikilink (inner text, e.g. `Note#Heading|alias`). */
  openLink(inner: string): void;
  /** Show notes with this tag. */
  openTag(tag: string): void;
  /** Whether a link target resolves to an existing note (for "unresolved" styling). */
  isKnown(target: string): boolean;
  /** Notes offered by `[[` autocomplete. */
  notes(): NoteRef[];
}

export const linkHost = Facet.define<LinkHost, LinkHost>({
  combine: (values) =>
    values[0] ?? {
      openLink: () => {},
      openTag: () => {},
      isKnown: () => true,
      notes: () => [],
    },
});

/** Dispatch to re-render links after the set of known notes changed. */
export const refreshLinks = StateEffect.define<null>();

const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;
const BLOCK_ID_RE = /[ \t]\^[A-Za-z0-9-]+[ \t]*$/gm;
const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;

/** True if `pos` sits in code, a URL, or frontmatter — where links and tags don't apply. */
function inCodeOrMeta(state: EditorState, pos: number): boolean {
  for (
    let node: ReturnType<typeof syntaxTree>["topNode"] | null = syntaxTree(state).resolveInner(
      pos,
      1,
    );
    node;
    node = node.parent
  ) {
    const n = node.name;
    if (
      n === "InlineCode" ||
      n === "FencedCode" ||
      n === "CodeBlock" ||
      n === "URL" ||
      n === "Frontmatter"
    )
      return true;
  }
  return false;
}

function activeLineNumbers(state: EditorState): Set<number> {
  const out = new Set<number>();
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++)
      out.add(n);
  }
  return out;
}

const hide = Decoration.replace({});

/** Decorations for wikilinks and tags in `ranges` (pure; exported for tests). */
export function buildLinkDecorations(
  state: EditorState,
  ranges: readonly { from: number; to: number }[] = [{ from: 0, to: state.doc.length }],
  focused = true,
): DecorationSet {
  const host = state.facet(linkHost);
  // Make sure the tree covers the ranges, so code/frontmatter are recognized reliably.
  ensureSyntaxTree(state, Math.max(0, ...ranges.map((r) => r.to)), 200);
  const active = focused ? activeLineNumbers(state) : new Set<number>();
  const out: Range<Decoration>[] = [];
  for (const { from, to } of ranges) {
    const text = state.sliceDoc(from, to);
    for (const m of text.matchAll(WIKILINK_RE)) {
      const start = from + m.index;
      const end = start + m[0].length;
      if (inCodeOrMeta(state, start)) continue;
      const bang = m[1]!.length;
      const inner = m[2]!;
      const link = parseWikilinkInner(inner);
      const known = !link.target || host.isKnown(link.target);
      out.push(
        Decoration.mark({
          class: known ? "cm-lp-wikilink" : "cm-lp-wikilink cm-lp-unresolved",
          attributes: { "data-wikilink": inner },
        }).range(start + bang + 2, end - 2),
      );
      if (active.has(state.doc.lineAt(start).number)) continue;
      out.push(hide.range(start, start + bang + 2)); // `![[` / `[[`
      const pipe = inner.indexOf("|");
      if (pipe !== -1) out.push(hide.range(start + bang + 2, start + bang + 2 + pipe + 1)); // `target|`
      out.push(hide.range(end - 2, end)); // `]]`
    }
    for (const m of text.matchAll(BLOCK_ID_RE)) {
      const start = from + m.index;
      const line = state.doc.lineAt(start).number;
      if (active.has(line) || inCodeOrMeta(state, start + 1)) continue;
      out.push(hide.range(start, start + m[0].length));
    }
    for (const m of text.matchAll(TAG_RE)) {
      const tag = m[2]!.replace(/\/+$/, "");
      if (!tag || /^\d+$/.test(tag)) continue;
      const start = from + m.index + m[1]!.length;
      if (inCodeOrMeta(state, start)) continue;
      out.push(
        Decoration.mark({
          class: "cm-lp-tag",
          attributes: { "data-tag": tag.toLowerCase() },
        }).range(start, start + 1 + tag.length),
      );
    }
  }
  return Decoration.set(out, true);
}

const linkDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildLinkDecorations(view.state, view.visibleRanges, view.hasFocus);
    }
    update(u: ViewUpdate) {
      if (
        u.docChanged ||
        u.focusChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        syntaxTree(u.state) !== syntaxTree(u.startState) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)))
      ) {
        this.decorations = buildLinkDecorations(u.state, u.view.visibleRanges, u.view.hasFocus);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Click a rendered link/tag to follow it; on the line being edited, Ctrl/Cmd-click. */
const clickHandler = EditorView.domEventHandlers({
  mousedown(e, view) {
    if (e.button !== 0) return false;
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-wikilink], [data-tag]");
    if (!el) return false;
    const pos = view.posAtDOM(el);
    const lineActive =
      view.hasFocus && activeLineNumbers(view.state).has(view.state.doc.lineAt(pos).number);
    if (lineActive && !(e.ctrlKey || e.metaKey)) return false;
    e.preventDefault();
    const host = view.state.facet(linkHost);
    if (el.dataset.wikilink !== undefined) host.openLink(el.dataset.wikilink);
    else if (el.dataset.tag) host.openTag(el.dataset.tag);
    return true;
  },
});

/** `[[` autocomplete over note names and aliases. */
export function wikilinkCompletions(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/\[\[[^[\]|#\n]*$/);
  if (!m) return null;
  const from = m.from + 2;
  const after = context.state.sliceDoc(context.pos, context.pos + 2);
  const close = after === "]]" ? "" : "]]";
  const host = context.state.facet(linkHost);
  const options: Completion[] = [];
  for (const n of host.notes()) {
    const folder = n.path.includes("/") ? n.path.slice(0, n.path.lastIndexOf("/")) : "";
    options.push({
      label: n.name,
      detail: folder,
      type: "text",
      apply: (view, _c, f, t) => {
        const insert = n.name + close;
        view.dispatch({
          changes: { from: f, to: t, insert },
          selection: { anchor: f + insert.length + (close ? 0 : 2) },
        });
      },
    });
    for (const alias of n.aliases) {
      options.push({
        label: alias,
        detail: `→ ${n.name}`,
        type: "text",
        apply: (view, _c, f, t) => {
          const insert = `${n.name}|${alias}${close}`;
          view.dispatch({
            changes: { from: f, to: t, insert },
            selection: { anchor: f + insert.length + (close ? 0 : 2) },
          });
        },
      });
    }
  }
  return { from, options, validFor: /^[^[\]|#\n]*$/ };
}

// ---- Frontmatter: hidden behind a chip unless the cursor is inside it ----

class PropertiesChip extends WidgetType {
  eq() {
    return true;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("div");
    el.className = "cm-lp-props-chip";
    el.textContent = "Properties (edit above, or click to show YAML)";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: 4 } });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

/** Length of the frontmatter block without its final newline, or 0. */
export function frontmatterEnd(state: EditorState): number {
  const head = state.sliceDoc(0, Math.min(state.doc.length, 20_000));
  const fm = splitFrontmatter(head);
  if (!fm.length) return 0;
  return head.slice(0, fm.length).replace(/\r?\n$/, "").length;
}

function frontmatterDecorations(state: EditorState): DecorationSet {
  const end = frontmatterEnd(state);
  if (!end) return Decoration.none;
  const inside = state.selection.ranges.some((r) => r.from <= end);
  if (inside) return Decoration.none;
  return Decoration.set([
    Decoration.replace({ widget: new PropertiesChip(), block: true }).range(0, end),
  ]);
}

const frontmatterFold = StateField.define<DecorationSet>({
  create: frontmatterDecorations,
  update: (deco, tr) => (tr.docChanged || tr.selection ? frontmatterDecorations(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

export function links(host: LinkHost) {
  return [linkHost.of(host), linkDecorations, clickHandler, frontmatterFold];
}
