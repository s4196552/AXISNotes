import { create } from "zustand";
import { type AxisConfig, DEFAULT_CONFIG, useConfig } from "./config";
import { showLeftPanel, showRightPanel, useLayout } from "./layout";

// Which sidebar each panel sits in, in what order, and which the user removed (T-275).
// Saved in the vault config as `sidebars`; the fold state of each section is a device
// preference in local storage.

export const PANEL_IDS = [
  "favorites",
  "files",
  "search",
  "tags",
  "hub",
  "calendar",
  "outline",
  "graph",
  "backlinks",
] as const;
export type PanelId = (typeof PANEL_IDS)[number];
export type SidebarSide = "left" | "right";

export const PANEL_LABELS: Record<PanelId, string> = {
  favorites: "Favorites",
  files: "Files",
  search: "Search",
  tags: "Tags",
  hub: "AXIS Hub",
  calendar: "Calendar",
  outline: "Outline",
  graph: "Local graph",
  backlinks: "Backlinks",
};

/**
 * Panels that fill the sidebar: on the left they are tabs, one shown at a time. The others
 * stack as folding sections. On the right every panel is a section.
 */
const FULL_HEIGHT: ReadonlySet<PanelId> = new Set(["files", "search", "tags", "hub"]);
export const isFullHeight = (id: PanelId) => FULL_HEIGHT.has(id);

export const isPanelId = (v: unknown): v is PanelId =>
  typeof v === "string" && (PANEL_IDS as readonly string[]).includes(v);

export interface Placement {
  left: PanelId[];
  right: PanelId[];
  hidden: PanelId[];
}

const DEFAULT = DEFAULT_CONFIG.sidebars as Placement;

/** The side a panel starts on. */
export function defaultSide(id: PanelId): SidebarSide {
  return DEFAULT.right.includes(id) ? "right" : "left";
}

/**
 * A usable placement from saved lists: known ids only, each once (left, then right, then
 * removed). A panel in none of them (one added by a later version) goes to its default
 * sidebar, before the first panel that follows it there by default.
 */
export function normalize(saved: { left?: unknown; right?: unknown; hidden?: unknown }): Placement {
  const seen = new Set<PanelId>();
  const take = (list: unknown) => {
    const out: PanelId[] = [];
    if (!Array.isArray(list)) return out;
    for (const v of list) {
      if (isPanelId(v) && !seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
    return out;
  };
  const p: Placement = { left: take(saved.left), right: take(saved.right), hidden: [] };
  p.hidden = take(saved.hidden);
  for (const id of PANEL_IDS) {
    if (seen.has(id)) continue;
    const side = defaultSide(id);
    const order = DEFAULT[side];
    const later = order.slice(order.indexOf(id) + 1);
    const at = p[side].findIndex((x) => later.includes(x));
    if (at === -1) p[side].push(id);
    else p[side].splice(at, 0, id);
  }
  return p;
}

export function sideOf(p: Placement, id: PanelId): SidebarSide | null {
  return p.left.includes(id) ? "left" : p.right.includes(id) ? "right" : null;
}

const without = (p: Placement, id: PanelId): Placement => ({
  left: p.left.filter((x) => x !== id),
  right: p.right.filter((x) => x !== id),
  hidden: p.hidden.filter((x) => x !== id),
});

/** Put `id` at the end of `side` (taking it from wherever it was). */
export function moveToSide(p: Placement, id: PanelId, side: SidebarSide): Placement {
  const out = without(p, id);
  out[side] = [...out[side], id];
  return out;
}

/** Put `id` just before or after `target`, in `target`'s sidebar. */
export function placeBeside(p: Placement, id: PanelId, target: PanelId, after: boolean): Placement {
  if (id === target) return p;
  const side = sideOf(p, target);
  if (!side) return p;
  const out = without(p, id);
  const list = [...out[side]];
  list.splice(list.indexOf(target) + (after ? 1 : 0), 0, id);
  out[side] = list;
  return out;
}

/** Take `id` out of the sidebars; the Add panel menu brings it back. */
export function removePanel(p: Placement, id: PanelId): Placement {
  const out = without(p, id);
  out.hidden = [...out.hidden, id];
  return out;
}

export const placementOf = (c: Pick<AxisConfig, "sidebars">) => normalize(c.sidebars);

/** Save a change to the placement in the vault config. */
export function updatePlacement(fn: (p: Placement) => Placement) {
  return useConfig.getState().update((c) => {
    const next = fn(placementOf(c));
    return { ...c, sidebars: { left: next.left, right: next.right, hidden: next.hidden } };
  });
}

export function resetPlacement() {
  return useConfig.getState().update((c) => ({
    ...c,
    sidebars: structuredClone(DEFAULT_CONFIG.sidebars),
  }));
}

/** The current placement, following the config. */
export function usePlacement(): Placement {
  const sidebars = useConfig((s) => s.config.sidebars);
  return normalize(sidebars);
}

// ---- Fold state (per device) ----

/** Kept under the right panel's old key, so its sections keep their fold state. */
export const FOLDS_KEY = "axisnotes:right-panel-sections";
const useFoldVersion = create(() => ({ v: 0 }));

function readFolds(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "{}");
    return typeof v === "object" && v !== null ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

/** Whether a section is open (all are, at first). */
export const isSectionOpen = (id: PanelId) => readFolds()[id] !== false;

export function setSectionOpen(id: PanelId, open: boolean) {
  const folds = readFolds();
  if ((folds[id] !== false) === open) return;
  try {
    localStorage.setItem(FOLDS_KEY, JSON.stringify({ ...folds, [id]: open }));
  } catch {
    // Not remembered, that's all.
  }
  useFoldVersion.setState((s) => ({ v: s.v + 1 }));
}

/** Re-renders when a section folds or unfolds; returns a lookup. */
export function useSectionOpen(): (id: PanelId) => boolean {
  useFoldVersion((s) => s.v);
  const folds = readFolds();
  return (id) => folds[id] !== false;
}

// ---- Showing a panel from a command ----

/** Asks the right sidebar to show its Note details with `id` in view (see Sidebars). */
export const usePanelRequest = create<{ count: number; id: PanelId | null }>(() => ({
  count: 0,
  id: null,
}));

/**
 * Show a panel wherever it now sits: open its sidebar and unfold it. A removed panel comes
 * back to its default sidebar. Returns the sidebar it is in.
 */
export function showPanel(id: PanelId): SidebarSide {
  const p = placementOf(useConfig.getState().config);
  let side = sideOf(p, id);
  if (!side) {
    side = defaultSide(id);
    const to = side;
    void updatePlacement((q) => moveToSide(q, id, to));
  }
  if (!isFullHeight(id) || side === "right") setSectionOpen(id, true);
  if (side === "left") showLeftPanel();
  else {
    showRightPanel();
    useLayout.getState().setRightPanel("details");
    usePanelRequest.setState((s) => ({ count: s.count + 1, id }));
  }
  return side;
}
