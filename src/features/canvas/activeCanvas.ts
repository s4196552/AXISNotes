import type { CanvasElement } from "../../lib/canvas";
import type { Applied, ApplyOptions, DrawOp } from "./canvasOps";

// Open canvases, so the sidebar chat can read and draw on the one the user is looking at
// (T-295). Each mounted canvas registers a handle by path; with split panes the chat uses
// the focused pane's (the store's `activePath`).

/** One AI drawing on a canvas: previewed while the answer arrives, then kept or taken back. */
export interface CanvasDraw {
  /** Problems with these operations on the canvas as it was when drawing began. */
  check(ops: readonly DrawOp[]): string[];
  /** Show these operations (the whole answer so far); not an undo step of its own. */
  preview(ops: readonly DrawOp[]): void;
  /** Keep these operations as one undo step. Throws if they can't all be applied. */
  commit(ops: readonly DrawOp[]): Applied;
  /** Take the preview back (nothing happens after `commit`). */
  discard(): void;
}

export interface CanvasHandle {
  path: string;
  /** The live scene (null until the canvas has loaded). */
  elements(): readonly CanvasElement[] | null;
  /** Start drawing; null when the canvas can't be changed (read-only, still loading). */
  begin(opts: ApplyOptions): CanvasDraw | null;
}

const handles = new Map<string, CanvasHandle>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function registerCanvas(handle: CanvasHandle): () => void {
  handles.set(handle.path, handle);
  changed();
  return () => {
    if (handles.get(handle.path) === handle) {
      handles.delete(handle.path);
      changed();
    }
  };
}

export function getCanvas(path: string | null | undefined): CanvasHandle | undefined {
  return path ? handles.get(path) : undefined;
}

export function onCanvasesChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
