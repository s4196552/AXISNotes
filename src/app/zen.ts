import { useEffect } from "react";
import { backend } from "../ipc";
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

/** Whether a revealed part must stay: a menu or dialog is open, or text is typed in it. */
function holding(el: Element | null) {
  if (document.querySelector(".filetree-menu, .modal-backdrop")) return true;
  const active = document.activeElement;
  return !!el && !!active && el.contains(active) && active.matches("input, textarea, select");
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
    const onMove = (e: MouseEvent) => {
      const s = useLayout.getState();
      const edge = zenEdgeAt(e.clientX, e.clientY, window.innerWidth);
      if (edge) {
        cancel();
        s.setZenReveal(edge);
        return;
      }
      if (!s.zenReveal) return;
      const el = document.querySelector(REVEALED[s.zenReveal]);
      const r = el?.getBoundingClientRect();
      const inside =
        !!r &&
        e.clientX >= r.left - SLACK &&
        e.clientX <= r.right + SLACK &&
        e.clientY >= r.top - SLACK &&
        e.clientY <= r.bottom + SLACK;
      if (inside || holding(el)) return cancel();
      timer ??= setTimeout(() => {
        timer = undefined;
        useLayout.getState().setZenReveal(null);
      }, HIDE_MS);
    };
    // Leaving full screen another way (Esc in a browser) leaves Zen mode too.
    const onFullscreen = () => {
      if (!backend.windowFrame && !document.fullscreenElement) setZen(false);
    };
    window.addEventListener("mousemove", onMove);
    document.addEventListener("fullscreenchange", onFullscreen);
    return () => {
      cancel();
      window.removeEventListener("mousemove", onMove);
      document.removeEventListener("fullscreenchange", onFullscreen);
    };
  }, [zen]);
}
