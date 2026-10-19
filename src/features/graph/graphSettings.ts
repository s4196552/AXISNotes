import { useCallback, useState } from "react";

// Graph view settings, like Obsidian's graph panel: filters, colour groups, display and
// forces, plus the layout (graph or tree) and the tree's options. A per-device
// preference, so it lives in local storage rather than the vault.

const KEY = "axisnotes.graph";

export type GraphMode = "graph" | "tree";
export type TreeDirection = "links" | "backlinks" | "folders";

export interface ColorGroup {
  /** Same syntax as the filter: text, `tag:x` or `path:x`. */
  query: string;
  color: string;
}

export interface DisplaySettings {
  arrows: boolean;
  /** Each note's icon (its custom icon, else one for its kind) beside its label. */
  icons: boolean;
  /** Labels show on nodes drawn at least this many pixels wide (0 = always). */
  textFade: number;
  /** Multiplier on node sizes. */
  nodeSize: number;
  /** Link width in pixels. */
  linkThickness: number;
}

export interface ForceSettings {
  /** Pull towards the middle, 0–1. */
  center: number;
  /** Push between nodes, 0–20. */
  repel: number;
  /** Pull along links, 0–1. */
  linkForce: number;
  /** Preferred link length, 30–500. */
  linkDistance: number;
}

export interface GraphSettings {
  mode: GraphMode;
  query: string;
  showOrphans: boolean;
  showUnresolved: boolean;
  groups: ColorGroup[];
  display: DisplaySettings;
  forces: ForceSettings;
  tree: { direction: TreeDirection; depth: number };
}

export const DEFAULT_DISPLAY: DisplaySettings = {
  arrows: false,
  icons: true,
  textFade: 5,
  nodeSize: 1,
  linkThickness: 1,
};

export const DEFAULT_FORCES: ForceSettings = {
  center: 0.5,
  repel: 10,
  linkForce: 1,
  linkDistance: 250,
};

export const DEFAULT_SETTINGS: GraphSettings = {
  mode: "graph",
  query: "",
  showOrphans: true,
  showUnresolved: false,
  groups: [],
  display: DEFAULT_DISPLAY,
  forces: DEFAULT_FORCES,
  tree: { direction: "links", depth: 3 },
};

/** Slider ranges, shared by the panel and the sanitizer. */
export const RANGES = {
  textFade: [0, 20, 1],
  nodeSize: [0.3, 3, 0.1],
  linkThickness: [0.5, 5, 0.5],
  center: [0, 1, 0.05],
  repel: [0, 20, 0.5],
  linkForce: [0, 1, 0.05],
  linkDistance: [30, 500, 10],
  depth: [1, 6, 1],
} as const satisfies Record<string, readonly [number, number, number]>;

function num(v: unknown, key: keyof typeof RANGES, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  const [min, max] = RANGES[key];
  return Math.min(max, Math.max(min, v));
}

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const str = (v: unknown, fallback: string) => (typeof v === "string" ? v : fallback);
const isColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/** Settings from anything (stored JSON included), with defaults for unusable values. */
export function sanitizeSettings(raw: unknown): GraphSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = (v.display ?? {}) as Record<string, unknown>;
  const f = (v.forces ?? {}) as Record<string, unknown>;
  const t = (v.tree ?? {}) as Record<string, unknown>;
  const groups = Array.isArray(v.groups) ? v.groups : [];
  return {
    mode: v.mode === "tree" ? "tree" : "graph",
    query: str(v.query, ""),
    showOrphans: bool(v.showOrphans, DEFAULT_SETTINGS.showOrphans),
    showUnresolved: bool(v.showUnresolved, DEFAULT_SETTINGS.showUnresolved),
    groups: groups
      .filter(
        (g): g is ColorGroup =>
          !!g && typeof g === "object" && typeof g.query === "string" && isColor(g.color),
      )
      .map((g) => ({ query: g.query, color: g.color })),
    display: {
      arrows: bool(d.arrows, DEFAULT_DISPLAY.arrows),
      icons: bool(d.icons, DEFAULT_DISPLAY.icons),
      textFade: num(d.textFade, "textFade", DEFAULT_DISPLAY.textFade),
      nodeSize: num(d.nodeSize, "nodeSize", DEFAULT_DISPLAY.nodeSize),
      linkThickness: num(d.linkThickness, "linkThickness", DEFAULT_DISPLAY.linkThickness),
    },
    forces: {
      center: num(f.center, "center", DEFAULT_FORCES.center),
      repel: num(f.repel, "repel", DEFAULT_FORCES.repel),
      linkForce: num(f.linkForce, "linkForce", DEFAULT_FORCES.linkForce),
      linkDistance: num(f.linkDistance, "linkDistance", DEFAULT_FORCES.linkDistance),
    },
    tree: {
      direction: t.direction === "backlinks" || t.direction === "folders" ? t.direction : "links",
      depth: Math.round(num(t.depth, "depth", DEFAULT_SETTINGS.tree.depth)),
    },
  };
}

export function loadGraphSettings(): GraphSettings {
  try {
    return sanitizeSettings(JSON.parse(localStorage.getItem(KEY) ?? "{}"));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(s: GraphSettings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Storage unavailable: the settings just aren't remembered.
  }
}

/** The settings and an updater that saves them. */
export function useGraphSettings(): [
  GraphSettings,
  (change: (s: GraphSettings) => GraphSettings) => void,
] {
  const [settings, setSettings] = useState(loadGraphSettings);
  const update = useCallback((change: (s: GraphSettings) => GraphSettings) => {
    setSettings((s) => {
      const next = change(s);
      save(next);
      return next;
    });
  }, []);
  return [settings, update];
}

/** Colours offered for a new group, in turn. */
export const GROUP_COLORS = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#0090ff", "#8e4ec6"];
