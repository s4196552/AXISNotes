import { useRef, useState } from "react";
import { type RibbonItem } from "./registry";
import { useRibbon, useRibbonDrag } from "./useRibbon";
import "./builtin";
import "./ribbon.css";

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
