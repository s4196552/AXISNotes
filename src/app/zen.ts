import { useEffect } from "react";
import { backend, type WindowFrame } from "../ipc";
import { useLayout, type ZenEdge } from "./layout";

// Zen mode, like Zen Browser's compact mode: the window goes full screen and only the
// note shows. Pointing at the left or right edge of the window slides that side panel
// in; pointing at the top brings back the tab row and the window buttons. Each hides
// again shortly after the pointer leaves it.

/** How close to a window edge (CSS px) the pointer must come to reveal it. */
export const ZEN_EDGE = 6;
/** How far outside a revealed part the pointer may stray before it hides. */
const SLACK = 32;
/** How long a revealed part waits after the pointer leaves it. */
const HIDE_MS = 350;

/** The element each edge reveals, whose box keeps it showing. */
const REVEALED: Record<ZenEdge, string> = {
  left: ".sidebar-slot.left",
  right: ".sidebar-slot.right",
  top: ".shell.zen .tabbar-row",
};

/** The edge the pointer at x, y is touching in a window `width` wide, if any. */
export function zenEdgeAt(x: number, y: number, width: number): ZenEdge | null {
  if (y <= ZEN_EDGE) return "top";
  if (x <= ZEN_EDGE) return "left";
  if (x >= width - 1 - ZEN_EDGE) return "right";
  return null;
}

/** Full screen on or off: the desktop window, or the page in a browser. */
async function setFullscreen(on: boolean) {
  try {
    const frame = backend.windowFrame;
    if (frame) return await frame.setFullscreen(on);
    if (on) await document.documentElement.requestFullscreen?.();
    else if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // Zen mode still hides the panels and bars without full screen.
  }
}

export function setZen(on: boolean) {
  if (useLayout.getState().zen === on) return;
  useLayout.setState({ zen: on, zenReveal: null });
  void setFullscreen(on);
}

export const toggleZen = () => setZen(!useLayout.getState().zen);

// Moving the window in Zen mode, so Windows Snap can put it beside another (split view).
// The top edge reveals a thin grab strip over the tab row (`.zen-drag-bar` in App.tsx); it
// and the other title bar areas (`data-tauri-drag-region`) move the window. A full screen
// window can't be moved or snapped, so the drag first returns it to a maximized window and
// then hands the press to the system, which restores it under the pointer and snaps it
// where it's dropped, as a maximized window's title bar does. Zen mode stays on.

/** How far (CSS px) the pointer must move with the button held before the window moves. */
export const DRAG_START = 4;

/** Whether a press on `target` is on a title bar area itself (not a tab or button on it). */
export function isDragArea(target: EventTarget | null) {
  return target instanceof HTMLElement && target.hasAttribute("data-tauri-drag-region");
}

/** Out of full screen into a maximized window, which the system can drag and snap. */
async function leaveFullscreen(frame: WindowFrame) {
  if (!(await frame.isFullscreen())) return false;
  await frame.setFullscreen(false);
  return true;
}

/** Move the window by the press under way (see above). */
export async function startZenDrag(frame: WindowFrame) {
  try {
    if ((await leaveFullscreen(frame)) && !(await frame.isMaximized())) {
      await frame.toggleMaximize();
    }
    await frame.startDragging();
  } catch {
    // The window stays where it is.
  }
}

/** A title bar's double-click: full screen and maximized both restore; else maximize. */
export async function zenToggleMaximize(frame: WindowFrame) {
  try {
    if ((await leaveFullscreen(frame)) && !(await frame.isMaximized())) return;
    await frame.toggleMaximize();
  } catch {
    // Nothing to change.
  }
}

/** Whether a revealed part must stay: a menu or dialog is open, or text is typed in it. */
function holding(el: Element | null) {
  if (document.querySelector(".filetree-menu, .modal-backdrop")) return true;
  const active = document.activeElement;
  return !!el && !!active && el.contains(active) && active.matches("input, textarea, select");
}

/** Whether the revealed part should stay for a pointer at x, y: near its box, or held. */
function stays(edge: ZenEdge, x: number, y: number) {
  // Split panes each have a tab row: any of them keeps the top showing.
  const els = Array.from(document.querySelectorAll(REVEALED[edge]));
  if (!els.length) return holding(null);
  return els.some((el) => {
    const r = el.getBoundingClientRect();
    const inside =
      x >= r.left - SLACK && x <= r.right + SLACK && y >= r.top - SLACK && y <= r.bottom + SLACK;
    return inside || holding(el);
  });
}

/** While in Zen mode, reveal the panels and tab row from the window's edges. */
export function useZenEdges() {
  const zen = useLayout((s) => s.zen);
  useEffect(() => {
    if (!zen) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    /** Where a press on a title bar area began, until it moves the window or ends. */
    let pressed: { x: number; y: number } | null = null;
    /**
     * Set once the window has been moved: the system keeps the pointer while it drags,
     * so the next pointer move here is after the drop. That hides the bar, and edges
     * reveal nothing until the pointer has left them, since a snap drops it on one.
     */
    let settling = false;
    const onDown = (e: MouseEvent) => {
      const frame = backend.windowFrame;
      if (!frame || e.button !== 0 || !isDragArea(e.target)) return;
      // Ours instead of Tauri's own drag (which can't move a full screen window), and no
      // text selection from the press.
      e.preventDefault();
      e.stopImmediatePropagation();
      pressed = null;
      if (e.detail === 2) {
        settling = true;
        void zenToggleMaximize(frame);
      } else if (e.detail === 1) {
        pressed = { x: e.clientX, y: e.clientY };
      }
    };
    const onUp = () => {
      pressed = null;
    };
    const onMove = (e: MouseEvent) => {
      const s = useLayout.getState();
      const frame = backend.windowFrame;
      if (pressed && frame) {
        if (!(e.buttons & 1)) pressed = null;
        else if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) >= DRAG_START) {
          pressed = null;
          settling = true;
          void startZenDrag(frame);
          return;
        } else return;
      }
      const edge = zenEdgeAt(e.clientX, e.clientY, window.innerWidth);
      if (settling) {
        cancel();
        s.setZenReveal(null);
        if (edge) return;
        settling = false;
      }
      if (edge) {
        cancel();
        s.setZenReveal(edge);
        return;
      }
      if (!s.zenReveal) return;
      if (stays(s.zenReveal, e.clientX, e.clientY)) return cancel();
      const { clientX: x, clientY: y } = e;
      timer ??= setTimeout(() => {
        timer = undefined;
        const shown = useLayout.getState().zenReveal;
        // Measured again: the part may have been mid-slide when the pointer passed, and has
        // since come to rest under a pointer that stopped there.
        if (shown && !stays(shown, x, y)) useLayout.getState().setZenReveal(null);
      }, HIDE_MS);
    };
    // Leaving full screen another way (Esc in a browser) leaves Zen mode too.
    const onFullscreen = () => {
      if (!backend.windowFrame && !document.fullscreenElement) setZen(false);
    };
    // Capture on the window: before Tauri's drag handler on the document.
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("mousemove", onMove);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      cancel();
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("mouseup", onUp, true);
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [zen]);
}
