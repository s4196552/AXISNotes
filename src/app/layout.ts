import { create } from "zustand";

// Which side panels are showing and how wide they are. Like zoom, it's a per-device
// preference, so it lives in local storage rather than the vault.

const KEY = "axisnotes.layout";

export type Side = "left" | "right";

/** Panel widths in CSS pixels: defaults, and the range a drag or arrow key can reach. */
export const PANEL_WIDTH = {
  default: { left: 260, right: 280 },
  min: 180,
  max: 600,
  /** The note area keeps at least this much room when a panel grows. */
  contentMin: 320,
} as const;

const widthKey = { left: "leftWidth", right: "rightWidth" } as const;

interface Saved {
  left: boolean;
  right: boolean;
  leftWidth: number;
  rightWidth: number;
}

/** A width within the allowed range, or the side's default for anything unusable. */
export function clampWidth(side: Side, w: unknown): number {
  if (typeof w !== "number" || !Number.isFinite(w)) return PANEL_WIDTH.default[side];
  return Math.round(Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, w)));
}

function stored(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Saved>;
    return {
      left: v.left !== false,
      right: v.right !== false,
      leftWidth: clampWidth("left", v.leftWidth),
      rightWidth: clampWidth("right", v.rightWidth),
    };
  } catch {
    return {
      left: true,
      right: true,
      leftWidth: PANEL_WIDTH.default.left,
      rightWidth: PANEL_WIDTH.default.right,
    };
  }
}

interface LayoutState extends Saved {
  setPanels(p: Partial<Pick<Saved, "left" | "right">>): void;
  /**
   * Set one panel's width (clamped). `save: false` applies it without writing local
   * storage, for the many updates of a drag; the drag saves once when it ends.
   */
  setWidth(side: Side, width: number, opts?: { save?: boolean }): void;
}

function save(s: Saved) {
  const { left, right, leftWidth, rightWidth } = s;
  try {
    localStorage.setItem(KEY, JSON.stringify({ left, right, leftWidth, rightWidth }));
  } catch {
    // Not saved; it still applies for this session.
  }
}

export const useLayout = create<LayoutState>((set, get) => ({
  ...stored(),
  setPanels(p) {
    set(p);
    save(get());
  },
  setWidth(side, width, opts) {
    set({ [widthKey[side]]: clampWidth(side, width) });
    if (opts?.save !== false) save(get());
  },
}));

/** The widest a panel can be right now, leaving the note area its minimum room. */
export function maxWidth(side: Side, windowWidth = window.innerWidth): number {
  const s = useLayout.getState();
  const other: Side = side === "left" ? "right" : "left";
  const otherWidth = s[other] ? s[widthKey[other]] : 0;
  const room = windowWidth - otherWidth - PANEL_WIDTH.contentMin;
  return Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, room));
}

export const panelWidth = (side: Side) => useLayout.getState()[widthKey[side]];
export const resetPanelWidth = (side: Side) =>
  useLayout.getState().setWidth(side, PANEL_WIDTH.default[side]);

/** Hide both side panels, or bring both back if they're already hidden. */
export function toggleSidePanels() {
  const { left, right, setPanels } = useLayout.getState();
  const show = !left && !right;
  setPanels({ left: show, right: show });
}

export const toggleLeftPanel = () =>
  useLayout.getState().setPanels({ left: !useLayout.getState().left });
export const toggleRightPanel = () =>
  useLayout.getState().setPanels({ right: !useLayout.getState().right });
export const showLeftPanel = () => useLayout.getState().setPanels({ left: true });
