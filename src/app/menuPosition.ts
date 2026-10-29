import { type RefObject, useLayoutEffect } from "react";

// Context menus open at the pointer. Near the bottom or right edge of the window they
// would run off it, so they open above or to the left of the pointer instead, like the
// OS's own menus; one taller than the window starts at the top and scrolls.

/** Space kept between a menu and the window's edge, in CSS pixels. */
const MARGIN = 8;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a menu opened at `box` goes to stay inside a `vw`×`vh` window. */
export function fitMenu(
  box: Box,
  vw: number,
  vh: number,
  margin = MARGIN,
): { left: number; top: number; maxHeight?: number } {
  let { left, top } = box;
  if (box.height > vh - 2 * margin)
    return { left: fitAxis(left, box.width, vw, margin), top: margin, maxHeight: vh - 2 * margin };
  top = fitAxis(top, box.height, vh, margin);
  left = fitAxis(left, box.width, vw, margin);
  return { left, top };
}

/** Open towards the far edge if it fits, else back from the pointer, else against the edge. */
function fitAxis(start: number, size: number, limit: number, margin: number): number {
  if (start + size <= limit - margin) return start;
  const flipped = start - size;
  if (flipped >= margin) return flipped;
  return Math.max(margin, limit - margin - size);
}

/** Move `el` (`position: fixed` at x, y) so all of it is on screen. */
export function fitToViewport(el: HTMLElement, x: number, y: number) {
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.maxHeight = "";
  el.style.overflowY = "";
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // A zoomed panel scales the menu: style pixels are its own, the box is on screen.
  const scale = el.offsetHeight ? r.height / el.offsetHeight : 1;
  const fit = fitMenu(r, window.innerWidth, window.innerHeight);
  el.style.left = `${x + (fit.left - r.left) / scale}px`;
  el.style.top = `${y + (fit.top - r.top) / scale}px`;
  if (fit.maxHeight !== undefined) {
    el.style.maxHeight = `${fit.maxHeight / scale}px`;
    el.style.overflowY = "auto";
  }
}

/**
 * Keep the menu in `ref`, opened at x, y, inside the window (before it is painted).
 * `opened` changes each time the menu opens, so a menu reopened at the same point is
 * fitted again.
 */
export function useFitToViewport(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
  opened?: unknown,
) {
  useLayoutEffect(() => {
    if (ref.current) fitToViewport(ref.current, x, y);
  }, [ref, x, y, opened]);
}
