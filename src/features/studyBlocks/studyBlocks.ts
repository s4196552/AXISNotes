import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import type { Root } from "react-dom/client";
import { notePath } from "../editor/embeds";
import { studyKind, type StudyKind } from "./model";

// ```flashcards, ```quiz and ```mindmap blocks (T-267) render as study cards while the
// cursor is outside them, like ```heatmap blocks. Moving the cursor in (or "Edit source")
// shows the text, which is all the note saves. Finding a block is one string check per
// fence; each kind's card (and its parser) is imported the first time a note shows one.

export interface StudyCardHost {
  kind: StudyKind;
  body: string;
  /** The note the block is in, for [[links]] and heatmap results. */
  path: string;
  /** The note's text and the block's first line now (for the section it's under). */
  where(): { text: string; line: number } | null;
  onEditSource(): void;
}

type Mount = (host: HTMLElement, props: StudyCardHost) => Root;

const loaders: Record<StudyKind, () => Promise<{ mount: Mount }>> = {
  flashcards: () => import("./FlashcardsCard"),
  quiz: () => import("./QuizCard"),
  mindmap: () => import("./MindmapCard"),
};

const roots = new WeakMap<HTMLElement, { root?: Root; gone?: boolean }>();

class StudyWidget extends WidgetType {
  constructor(
    readonly kind: StudyKind,
    readonly body: string,
    readonly path: string,
  ) {
    super();
  }

  eq(other: StudyWidget) {
    return other.kind === this.kind && other.body === this.body && other.path === this.path;
  }

  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = `cm-study cm-study-${this.kind}`;
    wrap.textContent = "Loading…";
    const entry: { root?: Root; gone?: boolean } = {};
    roots.set(wrap, entry);
    const onEditSource = () => {
      const line = view.state.doc.lineAt(view.posAtDOM(wrap));
      view.dispatch({
        selection: { anchor: Math.min(line.to + 1, view.state.doc.length) },
        scrollIntoView: true,
      });
      view.focus();
    };
    const props: StudyCardHost = {
      kind: this.kind,
      body: this.body,
      path: this.path,
      where: () =>
        view.contentDOM.contains(wrap)
          ? {
              text: view.state.doc.toString(),
              line: view.state.doc.lineAt(view.posAtDOM(wrap)).number,
            }
          : null,
      onEditSource,
    };
    void loaders[this.kind]().then(
      ({ mount }) => {
        if (entry.gone) return;
        wrap.textContent = "";
        entry.root = mount(wrap, props);
        view.requestMeasure();
      },
      () => {
        if (!entry.gone) wrap.textContent = "This study block couldn't be loaded.";
      },
    );
    return wrap;
  }

  // The card handles its own clicks and keys.
  ignoreEvent() {
    return true;
  }

  get estimatedHeight() {
    return this.kind === "mindmap" ? 320 : 260;
  }

  destroy(dom: HTMLElement) {
    const entry = roots.get(dom);
    roots.delete(dom);
    if (!entry) return;
    entry.gone = true;
    // Unmount after CodeMirror's update (React can't unmount while rendering).
    const root = entry.root;
    if (root) queueMicrotask(() => root.unmount());
  }
}

function build(state: EditorState): DecorationSet {
  const out: Range<Decoration>[] = [];
  const path = state.facet(notePath);
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "FencedCode") return;
      const info = node.node.getChild("CodeInfo");
      const kind = info && studyKind(state.sliceDoc(info.from, info.to));
      if (!kind) return false;
      const first = state.doc.lineAt(node.from);
      const last = state.doc.lineAt(node.to);
      if (state.selection.ranges.some((sel) => sel.from <= last.to && sel.to >= first.from))
        return false; // being edited
      const closed = last.number > first.number && /^\s*(```|~~~)/.test(last.text);
      if (!closed) return false; // still being typed
      const body = first.to < last.from - 1 ? state.sliceDoc(first.to + 1, last.from - 1) : "";
      out.push(
        Decoration.replace({
          widget: new StudyWidget(kind, body, path),
          block: true,
        }).range(first.from, last.to),
      );
      return false;
    },
  });
  return Decoration.set(out, true);
}

/** Render ```flashcards, ```quiz and ```mindmap blocks as study cards. */
export const studyBlocks = StateField.define<DecorationSet>({
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
