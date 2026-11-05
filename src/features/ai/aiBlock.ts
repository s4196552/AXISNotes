import { type EditorState, type Extension, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
} from "@codemirror/view";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { backend } from "../../ipc";
import { AiBlock } from "./AiBlockView";
import { useAiBlocks } from "./aiBlockStore";

// AI blocks: a prompt box placed in the note (from "AI" in the command menu's Basic
// blocks). The block is a CodeMirror widget, not text, so nothing is written to the
// file until the user inserts the answer. Its position follows edits around it.

export interface AiBlockSpec {
  id: string;
  /** A position on the line the block belongs to. */
  pos: number;
  /** The text selected when the block opened, if any. */
  selection?: { from: number; to: number; text: string };
  /** The skill the block runs (see src/features/skills), if any. */
  skill?: string;
}

export const openAiBlockEffect = StateEffect.define<AiBlockSpec>();
export const closeAiBlockEffect = StateEffect.define<string>();

export const aiBlockField = StateField.define<AiBlockSpec[]>({
  create: () => [],
  update(blocks, tr) {
    let next = blocks;
    if (tr.docChanged)
      next = blocks.map((b) => ({
        ...b,
        pos: tr.changes.mapPos(b.pos, -1),
        selection: b.selection && {
          ...b.selection,
          from: tr.changes.mapPos(b.selection.from, 1),
          to: tr.changes.mapPos(b.selection.to, -1),
        },
      }));
    for (const e of tr.effects) {
      if (e.is(openAiBlockEffect)) next = [...next.filter((b) => b.id !== e.value.id), e.value];
      else if (e.is(closeAiBlockEffect)) next = next.filter((b) => b.id !== e.value);
    }
    return next;
  },
});

/** Where an answer goes: in place of a blank line, else after the block's line. */
export function insertionFor(state: EditorState, pos: number, answer: string) {
  const line = state.doc.lineAt(pos);
  const text = answer.replace(/\s+$/, "");
  return line.text.trim() === ""
    ? { from: line.from, to: line.to, insert: text }
    : { from: line.to, to: line.to, insert: `\n\n${text}` };
}

export const aiBlockSpec = (state: EditorState, id: string) =>
  state.field(aiBlockField, false)?.find((b) => b.id === id);

const pathFacet = StateField.define<string>({ create: () => "", update: (v) => v });

const roots = new WeakMap<HTMLElement, Root>();

class AiBlockWidget extends WidgetType {
  constructor(
    readonly id: string,
    readonly path: string,
  ) {
    super();
  }
  eq(other: AiBlockWidget) {
    return other.id === this.id && other.path === this.path;
  }
  toDOM(view: EditorView) {
    const host = document.createElement("div");
    host.className = "cm-aiBlock";
    const root = createRoot(host);
    roots.set(host, root);
    root.render(createElement(AiBlock, { id: this.id, path: this.path, view }));
    return host;
  }
  destroy(dom: HTMLElement) {
    const root = roots.get(dom);
    if (!root) return;
    roots.delete(dom);
    // Not during CodeMirror's update (React warns about unmounting while rendering).
    queueMicrotask(() => root.unmount());
  }
  get estimatedHeight() {
    return 120;
  }
  // The block's own inputs and buttons handle their events, not the editor.
  ignoreEvent() {
    return true;
  }
}

function decorations(state: EditorState): DecorationSet {
  const path = state.field(pathFacet);
  const ranges = state.field(aiBlockField).map((b) => {
    const line = state.doc.lineAt(Math.min(b.pos, state.doc.length));
    const blank = line.text.trim() === "";
    return Decoration.widget({
      widget: new AiBlockWidget(b.id, path),
      block: true,
      side: blank ? -1 : 1,
    }).range(blank ? line.from : line.to);
  });
  return Decoration.set(ranges, true);
}

const aiBlockDecorations = StateField.define<DecorationSet>({
  create: decorations,
  update(deco, tr) {
    const changed =
      tr.docChanged || tr.effects.some((e) => e.is(openAiBlockEffect) || e.is(closeAiBlockEffect));
    return changed ? decorations(tr.state) : deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Stop the blocks' requests and forget their state when the editor closes. */
const cleanup = ViewPlugin.define((view) => ({
  destroy() {
    const store = useAiBlocks.getState();
    for (const b of view.state.field(aiBlockField, false) ?? []) {
      const phase = store.blocks[b.id]?.phase;
      if (phase?.kind === "running") void backend.aiCancel(phase.runId);
      store.remove(b.id);
    }
  },
}));

/** AI blocks for the note at `path`. */
export function aiBlocks(path: string): Extension {
  return [pathFacet.init(() => path), aiBlockField, aiBlockDecorations, cleanup];
}

/** Open an AI block on the cursor's line, with the selection (if any) as context. */
export function openAiBlock(view: EditorView, pos?: number, opts: { skill?: string } = {}) {
  const sel = view.state.selection.main;
  const id = crypto.randomUUID();
  view.dispatch({
    effects: openAiBlockEffect.of({
      id,
      pos: pos ?? sel.head,
      selection: sel.empty
        ? undefined
        : { from: sel.from, to: sel.to, text: view.state.sliceDoc(sel.from, sel.to) },
      ...(opts.skill ? { skill: opts.skill } : {}),
    }),
  });
  return id;
}

export function closeAiBlock(view: EditorView, id: string, focus = true) {
  view.dispatch({ effects: closeAiBlockEffect.of(id) });
  useAiBlocks.getState().remove(id);
  if (focus) view.focus();
}
