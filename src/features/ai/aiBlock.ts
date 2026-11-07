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
import { useAppStore } from "../../app/store";

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
  /** The notes the block reads instead of its own (a skill run on files picked in the tree). */
  sources?: string[];
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

// A note's editor closes whenever another tab is shown. Its blocks aren't lost: they're
// parked here by note path, their requests keep running (they write to the block store,
// not to the editor), and the next editor for that note shows them again, answer and all.
const parked = new Map<string, AiBlockSpec[]>();
/** New blocks waiting for their note to open (see `queueAiBlock`). */
const queued = new Map<string, AiBlockSpec[]>();

/** Open a new block in the note at `path` when its editor next opens. */
export function queueAiBlock(path: string, spec: Omit<AiBlockSpec, "id">): string {
  const id = crypto.randomUUID();
  queued.set(path, [...(queued.get(path) ?? []), { ...spec, id }]);
  return id;
}

/** Park the blocks when the editor closes; they come back with the note. */
const keep = ViewPlugin.define((view) => {
  const path = view.state.field(pathFacet);
  let blocks = view.state.field(aiBlockField, false) ?? [];
  return {
    update(u) {
      blocks = u.state.field(aiBlockField, false) ?? [];
    },
    destroy() {
      if (blocks.length) parked.set(path, blocks);
    },
  };
});

/** The parked blocks of `path` (taken, so they come back in one editor only). */
function unpark(path: string, state: EditorState): AiBlockSpec[] {
  const blocks = parked.get(path) ?? [];
  const fresh = queued.get(path) ?? [];
  parked.delete(path);
  queued.delete(path);
  const max = state.doc.length;
  const store = useAiBlocks.getState();
  return [...blocks.filter((b) => store.blocks[b.id]), ...fresh] // parked ones closed meanwhile go
    .map((b) => ({
      ...b,
      pos: Math.min(b.pos, max),
      selection: b.selection && {
        ...b.selection,
        from: Math.min(b.selection.from, max),
        to: Math.min(b.selection.to, max),
      },
    }));
}

/** Close every block of `path` that's parked: stop its request and forget it. */
export function discardParkedBlocks(path?: string) {
  const store = useAiBlocks.getState();
  for (const [p, blocks] of parked) {
    if (path !== undefined && p !== path) continue;
    for (const b of blocks) {
      const phase = store.blocks[b.id]?.phase;
      if (phase?.kind === "running") void backend.aiCancel(phase.runId);
      store.remove(b.id);
    }
    parked.delete(p);
  }
}

// Parked blocks belong to the vault they were opened in.
useAppStore.subscribe((s, prev) => {
  if (s.vault?.root !== prev.vault?.root) discardParkedBlocks();
});

/** AI blocks for the note at `path`, with any it had when it was last open. */
export function aiBlocks(path: string): Extension {
  return [
    pathFacet.init(() => path),
    aiBlockField.init((state) => unpark(path, state)),
    aiBlockDecorations,
    keep,
  ];
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
