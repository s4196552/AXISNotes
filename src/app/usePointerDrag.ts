import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// Dragging with pointer events. The desktop app's webview swallows HTML drag and drop on
// Windows (Tauri's own file-drop handling takes every drag), so in-app drags (tabs,
// dashboard widgets and cards) use this instead. The file tree has its own (T-121).

/** Pointer travel (px) before a press becomes a drag; less is a click. */
export const DRAG_START = 5;

/**
 * Drag `I`s onto `T`s. `targetAt` says what's under the pointer (null: nothing to drop
 * on); `onDrop` runs when a drag ends over a target. Returns the handler to put on each
 * draggable element's `onPointerDown`, and what is being dragged where, for drawing.
 * Escape cancels, and the click that ends a drag is swallowed.
 */
export function usePointerDrag<I, T>(
  targetAt: (x: number, y: number, item: I) => T | null,
  onDrop: (item: I, target: T) => void,
) {
  const [state, setState] = useState<{ item: I; target: T | null } | null>(null);
  const latest = useRef({ targetAt, onDrop });
  useLayoutEffect(() => {
    latest.current = { targetAt, onDrop };
  });
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const press = useCallback((e: ReactPointerEvent, item: I) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    stop.current?.();
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let target: T | null = null;
    let shown: string | null = null;
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < DRAG_START) return;
        started = true;
        document.body.classList.add("pointer-dragging");
      }
      ev.preventDefault();
      target = latest.current.targetAt(ev.clientX, ev.clientY, item);
      // Redraw only when the target changes.
      const key = JSON.stringify(target);
      if (key === shown) return;
      shown = key;
      setState({ item, target });
    };
    const finish = (drop: boolean) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      stop.current = null;
      if (!started) return;
      document.body.classList.remove("pointer-dragging");
      setState(null);
      // The click that ends a drag doesn't also act on what's under the pointer.
      const swallow = (ev: MouseEvent) => ev.stopPropagation();
      window.addEventListener("click", swallow, true);
      setTimeout(() => window.removeEventListener("click", swallow, true), 0);
      if (drop && target !== null) latest.current.onDrop(item, target);
    };
    const up = () => finish(true);
    const cancel = () => finish(false);
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || !started) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    stop.current = cancel;
  }, []);

  return { press, dragging: state?.item ?? null, target: state?.target ?? null };
}

/** Where a dragged item lands: before or after the item `target`, which runs vertically
 *  when it's much wider than tall (a full-width row). */
export interface DropBeside {
  target: string;
  after: boolean;
  vertical: boolean;
}

/**
 * The item under x, y among `root`'s elements carrying `attr` (e.g. `data-card-path`), and
 * which half the pointer is over. Null outside `root`, or over the dragged item itself.
 */
export function dropBeside(
  root: Element | null,
  attr: string,
  x: number,
  y: number,
  dragged: string,
): DropBeside | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${attr}]`);
  if (!root || !el || !root.contains(el)) return null;
  const target = el.getAttribute(attr);
  if (target === null || target === dragged) return null;
  const r = el.getBoundingClientRect();
  const vertical = r.width > r.height * 2.5;
  const after = vertical ? y > r.top + r.height / 2 : x > r.left + r.width / 2;
  return { target, after, vertical };
}
