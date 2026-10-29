import { create } from "zustand";

// Which side panels are showing and how wide they are. Like zoom, it's a per-device
// preference, so it lives in local storage rather than the vault.

const KEY = "axisnotes.layout";

export type Side = "left" | "right";
/** A window edge that reveals part of the app in Zen mode (see `src/app/zen.ts`). */
export type ZenEdge = Side | "top";

/**
 * Below this width the side panels stop taking room beside the note and open over it
 * instead (one at a time, closing when you pick something). DESIGN.md §3.
 */
export const COMPACT_QUERY = "(max-width: 1099px)";
const compactNow = () =>
  typeof window !== "undefined" && (window.matchMedia?.(COMPACT_QUERY).matches ?? false);

/** Panel widths in CSS pixels: defaults, and the range a drag or arrow key can reach. */
export const PANEL_WIDTH = {
  default: { left: 260, right: 280 },
  min: 180,
  max: 600,
  /** The note area keeps at least this much room when a panel grows. */
  contentMin: 320,
} as const;

/** Shared pane geometry; App exposes these as CSS variables on the shell. */
export const PANE_LAYOUT = { inset: 8, gap: 8, radius: 18 } as const;

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
  /** The window is narrow: panels open as overlays (see COMPACT_QUERY). */
  compact: boolean;
  /** The panel open over the note while compact (not saved; starts closed). */
  overlay: Side | null;
  setOverlay(side: Side | null): void;
  /**
   * Zen mode: the note fills the screen, and the panels and the tab row stay hidden
   * until the pointer reaches the window's left, right or top edge (not saved).
   */
  zen: boolean;
  /** What the pointer has revealed in Zen mode, if anything. */
  zenReveal: ZenEdge | null;
  setZenReveal(edge: ZenEdge | null): void;
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
  compact: compactNow(),
  overlay: null,
  setOverlay(overlay) {
    set({ overlay });
  },
  zen: false,
  zenReveal: null,
  setZenReveal(zenReveal) {
    if (get().zenReveal !== zenReveal) set({ zenReveal });
  },
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
  const paneSpace = 2 * PANE_LAYOUT.inset + PANE_LAYOUT.gap * (1 + Number(s[other]));
  const room = windowWidth - otherWidth - PANEL_WIDTH.contentMin - paneSpace;
  return Math.max(PANEL_WIDTH.min, Math.min(PANEL_WIDTH.max, room));
}

export const panelWidth = (side: Side) => useLayout.getState()[widthKey[side]];
export const resetPanelWidth = (side: Side) =>
  useLayout.getState().setWidth(side, PANEL_WIDTH.default[side]);

// Follow the window across the compact breakpoint; any open overlay closes.
if (typeof window !== "undefined") {
  window
    .matchMedia?.(COMPACT_QUERY)
    .addEventListener?.("change", (e) => useLayout.setState({ compact: e.matches, overlay: null }));
}

/**
 * Whether a panel is showing: docked when the window is wide, as an overlay when compact,
 * and in Zen mode only while the pointer has revealed it.
 */
export const isPanelOpen = (s: LayoutState, side: Side) =>
  s.zen ? s.zenReveal === side : s.compact ? s.overlay === side : s[side];

/** Hide both side panels, or bring both back if they're already hidden. */
export function toggleSidePanels() {
  const { left, right, setPanels, compact, overlay, setOverlay, zen, zenReveal, setZenReveal } =
    useLayout.getState();
  if (zen) return setZenReveal(zenReveal ? null : "left");
  if (compact) return setOverlay(overlay ? null : "left");
  const show = !left && !right;
  setPanels({ left: show, right: show });
}

function togglePanel(side: Side) {
  const s = useLayout.getState();
  if (s.zen) s.setZenReveal(s.zenReveal === side ? null : side);
  else if (s.compact) s.setOverlay(s.overlay === side ? null : side);
  else s.setPanels({ [side]: !s[side] });
}

export const toggleLeftPanel = () => togglePanel("left");
export const toggleRightPanel = () => togglePanel("right");
export function showLeftPanel() {
  const s = useLayout.getState();
  if (s.zen) s.setZenReveal("left");
  else if (s.compact) s.setOverlay("left");
  else s.setPanels({ left: true });
}
/** Close the panel open over the note (compact windows). */
export const closeOverlay = () => useLayout.getState().setOverlay(null);
