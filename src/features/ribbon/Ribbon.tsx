import { useRef, useState } from "react";
import { useConfig } from "../../app/config";
import { usePointerDrag } from "../../app/usePointerDrag";
import { arrange, moveInOrder, type RibbonItem, useRibbonItems } from "./registry";
import "./builtin";
import "./ribbon.css";

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

/**
 * The ribbon: a column of buttons beside the left panel. Drag a button to reorder it, or
 * focus it and press Alt+↑ / Alt+↓; ↑ / ↓ move between buttons.
 */
export function Ribbon() {
  const { arranged, hidden, move } = useRibbon();
  const shown = arranged.filter((i) => !hidden.includes(i.id));
  const ids = shown.map((i) => i.id);
  const toolbar = useRef<HTMLDivElement>(null);
  const drag = useRibbonDrag(toolbar, ids, move);
  const [focusId, setFocusId] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const current = focusId && ids.includes(focusId) ? focusId : ids[0];

  const onKeyDown = (e: React.KeyboardEvent, item: RibbonItem) => {
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const at = ids.indexOf(item.id);
    if (e.altKey) {
      const to = at + step;
      if (to < 0 || to >= ids.length) return;
      move(item.id, step > 0 ? (ids[to + 1] ?? null) : ids[to]!);
      return;
    }
    const next = ids[(at + step + ids.length) % ids.length]!;
    setFocusId(next);
    refs.current.get(next)?.focus();
  };

  return (
    <nav className="ribbon" aria-label="Ribbon">
      <div ref={toolbar} role="toolbar" aria-orientation="vertical" aria-label="Ribbon buttons">
        {shown.map((item) => (
          <button
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
              else refs.current.delete(item.id);
            }}
            className="ribbon-button"
            aria-label={item.label}
            title={`${item.label}${item.source === "AXISNotes" ? "" : ` (${item.source})`} — drag to reorder`}
            tabIndex={item.id === current ? 0 : -1}
            onFocus={() => setFocusId(item.id)}
            onClick={() => item.run()}
            onKeyDown={(e) => onKeyDown(e, item)}
            {...drag(item.id)}
          >
            <item.Icon size={17} aria-hidden="true" />
          </button>
        ))}
      </div>
    </nav>
  );
}
