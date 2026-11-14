import { useRef, useState } from "react";
import { useConfig } from "../../app/config";
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

const DRAG_TYPE = "application/x-axis-ribbon";

/**
 * Drag-and-drop between the items of a list (the ribbon, or its list in Settings): drop
 * before the item under the pointer, or after the last one.
 */
export function useRibbonDrag(ids: string[], move: (id: string, before: string | null) => void) {
  const [over, setOver] = useState<string | null>(null);
  const dragging = useRef<string | null>(null);
  const props = (id: string) => ({
    draggable: true,
    "data-drop": over === id ? "" : undefined,
    onDragStart: (e: React.DragEvent) => {
      dragging.current = id;
      e.dataTransfer.setData(DRAG_TYPE, id);
      e.dataTransfer.effectAllowed = "move";
    },
    onDragOver: (e: React.DragEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setOver(id);
    },
    onDragLeave: () => setOver((o) => (o === id ? null : o)),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const from = dragging.current ?? e.dataTransfer.getData(DRAG_TYPE);
      setOver(null);
      dragging.current = null;
      if (!from || from === id) return;
      // Dropping on a later item puts the dragged one after it; on an earlier one, before.
      const a = ids.indexOf(from);
      const b = ids.indexOf(id);
      move(from, a < b ? (ids[b + 1] ?? null) : id);
    },
    onDragEnd: () => {
      dragging.current = null;
      setOver(null);
    },
  });
  return props;
}

/**
 * The ribbon: a column of buttons beside the left panel. Drag a button to reorder it, or
 * focus it and press Alt+↑ / Alt+↓; ↑ / ↓ move between buttons.
 */
export function Ribbon() {
  const { arranged, hidden, move } = useRibbon();
  const shown = arranged.filter((i) => !hidden.includes(i.id));
  const ids = shown.map((i) => i.id);
  const drag = useRibbonDrag(ids, move);
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
      <div role="toolbar" aria-orientation="vertical" aria-label="Ribbon buttons">
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
