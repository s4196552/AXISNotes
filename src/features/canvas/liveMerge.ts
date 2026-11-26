import type { CanvasElement } from "../../lib/canvas";
import type { Lib } from "./loadExcalidraw";

// Outside changes to an open canvas (Claude's canvas tools, another app, a sync tool) are
// merged into the scene in place: no reload, so the view, selection and undo history stay.
// With no unsaved local edits the file's version is taken as it is; with some, each element
// keeps whichever side changed it last (Excalidraw's element versions), and elements the
// file no longer has are removed unless they were edited here since.
//
// Text written outside the app (`customData.axisRemeasure`, see src-tauri/src/mcp/canvas.rs)
// only has an estimated size; it is measured with the real font and re-centred in its
// shape or arrow.

export const REMEASURE = "axisRemeasure";

type El = CanvasElement & {
  id: string;
  version?: number;
  versionNonce?: number;
  isDeleted?: boolean;
  containerId?: string | null;
  customData?: Record<string, unknown>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  points?: [number, number][];
};

const PADDING = 5;

const flagged = (e: El) => e.customData?.[REMEASURE] === true;

const bump = (e: El): El => ({
  ...e,
  version: (e.version ?? 1) + 1,
  versionNonce: Math.floor(Math.random() * 2 ** 31),
});

export function needsRemeasure(elements: readonly CanvasElement[]): boolean {
  return (elements as readonly El[]).some((e) => !e.isDeleted && flagged(e));
}

/** Measure flagged text with the real font, centre labels and grow shapes that are too small. */
export function remeasure(lib: Lib, elements: readonly CanvasElement[]): CanvasElement[] {
  const els = elements as readonly El[];
  if (!needsRemeasure(els)) return [...els];
  const refreshed = new Map(
    (
      lib.restoreElements(els as never, null, {
        repairBindings: true,
        refreshDimensions: true,
      }) as unknown as El[]
    ).map((e) => [e.id, e]),
  );
  const out = new Map(els.map((e) => [e.id, e]));
  for (const e of els) {
    if (e.isDeleted || !flagged(e)) continue;
    const r = refreshed.get(e.id) ?? e;
    const customData = { ...e.customData };
    delete customData[REMEASURE];
    const text: El = bump({
      ...e,
      width: r.width,
      height: r.height,
      x: r.x,
      y: r.y,
      ...("text" in r ? { text: r.text } : {}),
      customData,
    });
    const container = e.containerId ? out.get(e.containerId) : undefined;
    if (container && !container.isDeleted) {
      let box = container;
      const w = text.width ?? 0;
      const h = text.height ?? 0;
      if (container.type === "arrow" || container.type === "line") {
        const pts = container.points ?? [[0, 0]];
        const [a, b] = [pts[0]!, pts.at(-1)!];
        const cx = (container.x ?? 0) + (a[0] + b[0]) / 2;
        const cy = (container.y ?? 0) + (a[1] + b[1]) / 2;
        text.x = cx - w / 2;
        text.y = cy - h / 2;
      } else {
        // The height the text needs inside this kind of shape.
        const grow =
          container.type === "ellipse" ? Math.SQRT2 : container.type === "diamond" ? 2 : 1;
        const needed = Math.ceil((h + PADDING * 2) * grow);
        if ((container.height ?? 0) < needed) {
          box = bump({ ...container, height: needed });
          out.set(box.id, box);
        }
        text.x = (box.x ?? 0) + (box.width ?? 0) / 2 - w / 2;
        text.y = (box.y ?? 0) + (box.height ?? 0) / 2 - h / 2;
      }
    }
    out.set(e.id, text);
  }
  return [...out.values()];
}

/**
 * The scene after the file changed outside the app. `previous` is the file's elements as
 * last loaded or saved; `dirty` says whether the scene has edits not yet saved.
 */
export function mergeOutside(
  lib: Lib,
  local: readonly CanvasElement[],
  previous: readonly CanvasElement[],
  incoming: readonly CanvasElement[],
  appState: unknown,
  dirty: boolean,
): CanvasElement[] {
  const restored = lib.restoreElements(incoming as never, null, {
    repairBindings: true,
  }) as unknown as El[];
  if (!dirty) return remeasure(lib, restored);
  const now = new Set(restored.map((e) => e.id));
  const before = new Map((previous as readonly El[]).map((e) => [e.id, e.version ?? 1]));
  // Removed in the file and not edited here since: remove it here too.
  const kept = (local as readonly El[]).map((e) => {
    const was = before.get(e.id);
    return was !== undefined && !now.has(e.id) && !e.isDeleted && (e.version ?? 1) <= was
      ? bump({ ...e, isDeleted: true })
      : e;
  });
  const merged = lib.reconcileElements(
    kept as never,
    restored as never,
    appState as never,
  ) as unknown as El[];
  return remeasure(lib, merged);
}
