import { create } from "zustand";
import { backend } from "../ipc";
import { useAppStore } from "./store";

// Zoom for the whole app (Ctrl + = / − / 0, Ctrl + mouse wheel, Settings → Appearance).
// It's a per-device preference, so it lives in local storage rather than the vault.

const KEY = "axisnotes.zoom";
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];

function stored(): number {
  try {
    const z = Number(localStorage.getItem(KEY));
    return z >= ZOOM_STEPS[0]! && z <= ZOOM_STEPS.at(-1)! ? z : 1;
  } catch {
    return 1;
  }
}

interface ZoomState {
  zoom: number;
  setZoom(z: number): void;
}

export const useZoom = create<ZoomState>((set) => ({
  zoom: stored(),
  setZoom(z) {
    const zoom = Math.min(ZOOM_STEPS.at(-1)!, Math.max(ZOOM_STEPS[0]!, Math.round(z * 100) / 100));
    set({ zoom });
    try {
      localStorage.setItem(KEY, String(zoom));
    } catch {
      // Not saved; it still applies for this session.
    }
    void backend.setZoom(zoom).catch(() => {});
  },
}));

/** The next zoom step up (`dir` = 1) or down (-1) from `z`. */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 0.001) ?? ZOOM_STEPS.at(-1)!;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? ZOOM_STEPS[0]!;
}

export const zoomIn = () => useZoom.getState().setZoom(stepZoom(useZoom.getState().zoom, 1));
export const zoomOut = () => useZoom.getState().setZoom(stepZoom(useZoom.getState().zoom, -1));
export const zoomReset = () => useZoom.getState().setZoom(1);

/** Places with their own zoom (the canvas and the graph), where Ctrl + wheel/keys stay theirs. */
export const OWN_ZOOM =
  ".excalidraw, .graph-canvas, [data-testid='graph-canvas'], .local-graph-canvas";

/**
 * Apply the saved zoom, and handle the zoom gestures the command shortcuts don't cover:
 * Ctrl + mouse wheel, "+" (number pad, or Shift + =), and on the welcome screen, where
 * the command shortcuts aren't active, Ctrl + = / − / 0 too. Returns a cleanup function.
 */
export function installZoom(): () => void {
  void backend.setZoom(useZoom.getState().zoom).catch(() => {});
  const inOwnZoom = (t: EventTarget | null) => t instanceof Element && t.closest(OWN_ZOOM) !== null;
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey) || inOwnZoom(e.target) || e.deltaY === 0) return;
    e.preventDefault();
    if (e.deltaY < 0) zoomIn();
    else zoomOut();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || inOwnZoom(e.target)) return;
    // With a vault open, Ctrl + = / − / 0 are (remappable) commands, handled before this.
    const noVault = useAppStore.getState().vault === null;
    const action =
      e.key === "+"
        ? zoomIn
        : !noVault
          ? null
          : e.key === "="
            ? zoomIn
            : e.key === "-"
              ? zoomOut
              : e.key === "0"
                ? zoomReset
                : null;
    if (!action) return;
    e.preventDefault();
    action();
  };
  window.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKey);
  };
}
