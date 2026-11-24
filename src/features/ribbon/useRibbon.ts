import { useConfig } from "../../app/config";
import { usePointerDrag } from "../../app/usePointerDrag";
import { arrange, moveInOrder, useRibbonItems } from "./registry";

// The ribbon's order and drag-to-reorder, shared by the ribbon and its list in Settings
// (kept out of Ribbon.tsx so that file only exports components, T-284).

/** The ribbon's buttons in the user's order, and a way to move one (saved in the config). */
export function useRibbon() {
  const config = useConfig((s) => s.config);
  const all = useRibbonItems();
  const arranged = arrange(all, config.ribbon.order, config);
  const move = (id: string, before: string | null) =>
    void useConfig.getState().update((c) => ({
      ...c,
      ribbon: {
        ...c.ribbon,
        order: moveInOrder(
          arrange(all, c.ribbon.order, c).map((i) => i.id),
          c.ribbon.order,
          id,
          before,
        ),
      },
    }));
  return { arranged, hidden: config.ribbon.hidden, move };
}

/**
 * Dragging buttons within a list (the ribbon, or its list in Settings) to reorder them,
 * with pointer events like the app's other drags (the desktop webview swallows HTML drag
 * and drop). Items carry `data-ribbon-id`; the drop goes before or after the item under the
 * pointer, by which half of it the pointer is over.
 */
export function useRibbonDrag(
  root: React.RefObject<HTMLElement | null>,
  ids: string[],
  move: (id: string, before: string | null) => void,
) {
  const { press, dragging, target } = usePointerDrag<string, { id: string; after: boolean }>(
    (x, y, dragged) => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-ribbon-id]");
      if (!el || !root.current?.contains(el)) return null;
      const id = el.dataset.ribbonId!;
      if (id === dragged) return null;
      const r = el.getBoundingClientRect();
      return { id, after: y > r.top + r.height / 2 };
    },
    (dragged, at) => {
      const before = at.after ? (ids[ids.indexOf(at.id) + 1] ?? null) : at.id;
      if (before !== dragged) move(dragged, before);
    },
  );
  /** Props for each item: start a drag on press, and show where it would land. */
  return (id: string) => ({
    "data-ribbon-id": id,
    "data-dragging": dragging === id ? "" : undefined,
    "data-drop": target?.id === id ? (target.after ? "after" : "before") : undefined,
    onPointerDown: (e: React.PointerEvent) => press(e, id),
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  });
}
