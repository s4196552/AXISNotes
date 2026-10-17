import { useEffect, useRef } from "react";
import {
  maxWidth,
  PANEL_WIDTH,
  panelWidth,
  resetPanelWidth,
  type Side,
  useLayout,
} from "../../app/layout";

// The drag handle on a side panel's inner edge. Drag to resize, double-click to go
// back to the default width, or focus it and use the arrow keys (Shift for bigger
// steps, Home/End for the narrowest/widest). The width is saved once a drag ends.

const STEP = 16;
const BIG_STEP = 64;

type Drag = { x: number; width: number; max: number };

/** End a drag in progress: clear the dragging styles and save the width once. */
function finish(drag: { current: Drag | null }, handle: HTMLElement | null, side: Side) {
  if (!drag.current) return;
  drag.current = null;
  handle?.removeAttribute("data-dragging");
  document.documentElement.classList.remove("panel-resizing");
  useLayout.getState().setWidth(side, panelWidth(side));
}

export function PanelResizer({ side }: { side: Side }) {
  const width = useLayout((s) => (side === "left" ? s.leftWidth : s.rightWidth));
  const shown = useLayout((s) => s[side]);
  const setWidth = useLayout((s) => s.setWidth);
  const drag = useRef<Drag | null>(null);
  const handle = useRef<HTMLDivElement>(null);
  // Moving the pointer right widens the left panel and narrows the right one.
  const dir = side === "left" ? 1 : -1;
  const end = () => finish(drag, handle.current, side);

  // Hidden mid-drag (e.g. Ctrl+\), or unmounted: finish the drag so the cursor and the
  // no-select style don't stay stuck.
  useEffect(() => {
    const state = drag;
    const el = handle.current;
    if (!shown) finish(state, el, side);
    return () => finish(state, el, side);
  }, [shown, side]);

  return (
    <div
      ref={handle}
      className={`panel-resizer ${side}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${side} panel`}
      aria-valuenow={width}
      aria-valuemin={PANEL_WIDTH.min}
      aria-valuemax={PANEL_WIDTH.max}
      title="Drag to resize, double-click to reset"
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.clientX, width, max: maxWidth(side) };
        e.currentTarget.setAttribute("data-dragging", "");
        document.documentElement.classList.add("panel-resizing");
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const next = d.width + dir * (e.clientX - d.x);
        setWidth(side, Math.min(d.max, next), { save: false });
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onDoubleClick={() => resetPanelWidth(side)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? BIG_STEP : STEP;
        let next: number | null = null;
        if (e.key === "ArrowRight") next = width + dir * step;
        else if (e.key === "ArrowLeft") next = width - dir * step;
        else if (e.key === "Home") next = PANEL_WIDTH.min;
        else if (e.key === "End") next = maxWidth(side);
        if (next === null) return;
        e.preventDefault();
        setWidth(side, Math.min(maxWidth(side), next));
      }}
    />
  );
}
