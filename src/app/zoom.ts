import type { CSSProperties } from "react";
import { create } from "zustand";
import { backend } from "../ipc";
import { useAppStore } from "./store";

// Zoom for the whole app (Ctrl + = / − / 0, Settings → Appearance), and for each part of
// the window on its own (Ctrl + mouse wheel zooms only the part under the pointer).
// Both are per-device preferences, so they live in local storage rather than the vault.

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
/** Back to 100%: the whole app and every part of it. */
export const zoomReset = () => {
  useZoom.getState().setZoom(1);
  useAreaZoom.getState().resetAll();
};

// ---- Parts of the window, zoomed on their own ----

/** The parts Ctrl + mouse wheel zooms on their own (`data-zoom-area` on each). */
export const ZOOM_AREAS = {
  left: "Left panel",
  tabs: "Tab bar",
  main: "Main view",
  right: "Right panel",
} as const;
export type ZoomArea = keyof typeof ZOOM_AREAS;

const AREA_KEY = "axisnotes.areaZoom";

function storedAreas(): Partial<Record<ZoomArea, number>> {
  try {
    const v = JSON.parse(localStorage.getItem(AREA_KEY) ?? "{}") as Record<string, unknown>;
    const out: Partial<Record<ZoomArea, number>> = {};
    for (const area of Object.keys(ZOOM_AREAS) as ZoomArea[]) {
      const z = v[area];
      if (typeof z === "number" && z >= ZOOM_STEPS[0]! && z <= ZOOM_STEPS.at(-1)! && z !== 1)
        out[area] = z;
    }
    return out;
  } catch {
    return {};
  }
}

interface AreaZoomState {
  /** Only the zoomed parts; a missing one is at 100%. */
  areas: Partial<Record<ZoomArea, number>>;
  setArea(area: ZoomArea, z: number): void;
  resetAll(): void;
}

export const useAreaZoom = create<AreaZoomState>((set, get) => {
  const save = (areas: Partial<Record<ZoomArea, number>>) => {
    set({ areas });
    try {
      localStorage.setItem(AREA_KEY, JSON.stringify(areas));
    } catch {
      // Not saved; it still applies for this session.
    }
  };
  return {
    areas: storedAreas(),
    setArea(area, z) {
      const zoom = Math.min(
        ZOOM_STEPS.at(-1)!,
        Math.max(ZOOM_STEPS[0]!, Math.round(z * 100) / 100),
      );
      const areas = { ...get().areas, [area]: zoom };
      if (zoom === 1) delete areas[area];
      save(areas);
    },
    resetAll: () => save({}),
  };
});

/**
 * Props for a part of the window that zooms on its own: its marker and, when zoomed,
 * `--area-zoom` with the CSS zoom. With `content`, the part itself keeps its size and look
 * and only `--area-zoom` is set; CSS zooms the content inside (the side panels, see
 * app.css). Places with their own zoom (the canvas, the graph) use it to undo the zoom.
 */
export function useAreaZoomProps(area: ZoomArea, { content = false } = {}) {
  const z = useAreaZoom((s) => s.areas[area] ?? 1);
  const style =
    z === 1 ? undefined : content ? { "--area-zoom": z } : { zoom: z, "--area-zoom": z };
  return { "data-zoom-area": area, style: style as CSSProperties | undefined };
}

/** Zoom the part of the window under the pointer one step in (`dir` = 1) or out. */
function zoomAreaAt(target: Element, dir: 1 | -1): boolean {
  const el = target.closest<HTMLElement>("[data-zoom-area]");
  const area = el?.dataset.zoomArea as ZoomArea | undefined;
  if (!area || !(area in ZOOM_AREAS)) return false;
  const { areas, setArea } = useAreaZoom.getState();
  const z = stepZoom(areas[area] ?? 1, dir);
  setArea(area, z);
  useAppStore.getState().notify(`${ZOOM_AREAS[area]} ${Math.round(z * 100)}% (Ctrl + 0 resets)`);
  return true;
}

/** Places with their own zoom (the canvas and the graph), where Ctrl + wheel/keys stay theirs. */
export const OWN_ZOOM =
  ".excalidraw, .graph-canvas, [data-testid='graph-canvas'], .local-graph-canvas";

/**
 * Apply the saved zoom, and handle the zoom gestures the command shortcuts don't cover:
 * Ctrl + mouse wheel (the part of the window under the pointer; the whole welcome screen),
 * "+" (number pad, or Shift + =), and on the welcome screen, where the command shortcuts
 * aren't active, Ctrl + = / − / 0 too. Returns a cleanup function.
 */
export function installZoom(): () => void {
  void backend.setZoom(useZoom.getState().zoom).catch(() => {});
  const inOwnZoom = (t: EventTarget | null) => t instanceof Element && t.closest(OWN_ZOOM) !== null;
  const onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey) || inOwnZoom(e.target) || e.deltaY === 0) return;
    // Never the browser's own page zoom.
    e.preventDefault();
    const dir = e.deltaY < 0 ? 1 : -1;
    if (e.target instanceof Element && zoomAreaAt(e.target, dir)) return;
    // Outside those parts (dialogs, the status bar) nothing changes; with no vault open,
    // the welcome screen is the whole window, so it all zooms.
    if (useAppStore.getState().vault !== null) return;
    if (dir > 0) zoomIn();
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
