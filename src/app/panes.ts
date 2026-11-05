// Split panes in the main area, like Obsidian's: each pane has its own row of tabs, and a
// tab dragged onto a pane's edge splits it there (onto its middle or its tab row, the tab
// moves into that pane). Panes split side by side ("row") or stacked ("column"), nested to
// any depth. Pure functions over `Workspace`; the app store (store.ts) holds it, with the
// focused pane's tabs in `tabs` so every tab action works on the focused pane.

import * as T from "./tabs";
import type { Tab, TabsState } from "./tabs";

/** "row": side by side; "column": one above the other. */
export type SplitDir = "row" | "column";

export type PaneNode =
  | { kind: "pane"; id: string }
  | {
      kind: "split";
      id: string;
      dir: SplitDir;
      children: PaneNode[];
      /** Each child's share of the split, summing to 1. */
      sizes: number[];
    };

export interface Workspace {
  root: PaneNode;
  /** Each pane's tabs, by pane id. */
  tabs: Record<string, TabsState>;
  /** The pane that tab actions, links and the file tree open into. */
  focused: string;
}

/** Where a dragged tab lands on a pane: its middle (into the pane) or one of its edges. */
export type DropZone = "center" | "left" | "right" | "top" | "bottom";

/** No pane gets smaller than this share of its split when resizing. */
export const MIN_SHARE = 0.1;

let seq = 0;
const nextId = (kind: string) => `${kind}-${Date.now().toString(36)}-${(seq++).toString(36)}`;

/** One pane holding `tabs`. */
export function singlePane(tabs: TabsState = T.initialTabs()): Workspace {
  const id = nextId("pane");
  return { root: { kind: "pane", id }, tabs: { [id]: tabs }, focused: id };
}

/** Pane ids in reading order (left to right, top to bottom). */
export function paneIds(node: PaneNode): string[] {
  return node.kind === "pane" ? [node.id] : node.children.flatMap(paneIds);
}

export const paneCount = (w: Workspace) => paneIds(w.root).length;

export function focusPane(w: Workspace, id: string): Workspace {
  return w.focused === id || !w.tabs[id] ? w : { ...w, focused: id };
}

/** Shares that sum to 1 (equal ones when they're unusable). */
function normalSizes(sizes: number[], n: number): number[] {
  const ok = sizes.length === n && sizes.every((x) => Number.isFinite(x) && x > 0);
  if (!ok) return Array.from({ length: n }, () => 1 / n);
  const sum = sizes.reduce((a, b) => a + b, 0);
  return sizes.map((x) => x / sum);
}

/**
 * Keep the tree simple: a split with one child is that child, and a split inside a split of
 * the same direction joins its parent (its children taking its share).
 */
function normalize(node: PaneNode): PaneNode {
  if (node.kind === "pane") return node;
  const children: PaneNode[] = [];
  const sizes: number[] = [];
  const own = normalSizes(node.sizes, node.children.length);
  node.children.forEach((c, i) => {
    const child = normalize(c);
    if (child.kind === "split" && child.dir === node.dir) {
      child.children.forEach((g, j) => {
        children.push(g);
        sizes.push(own[i]! * child.sizes[j]!);
      });
    } else {
      children.push(child);
      sizes.push(own[i]!);
    }
  });
  if (children.length === 1) return children[0]!;
  return { ...node, children, sizes: normalSizes(sizes, children.length) };
}

/** The tree without pane `id` (its share goes to its neighbours). Null when nothing's left. */
function without(node: PaneNode, id: string): PaneNode | null {
  if (node.kind === "pane") return node.id === id ? null : node;
  const kept: { child: PaneNode; size: number }[] = [];
  node.children.forEach((c, i) => {
    const child = without(c, id);
    if (child) kept.push({ child, size: node.sizes[i] ?? 0 });
  });
  if (!kept.length) return null;
  return normalize({
    ...node,
    children: kept.map((k) => k.child),
    sizes: kept.map((k) => k.size),
  });
}

/**
 * Close pane `id` (the last pane stays). Focus goes to the pane before it, else the one
 * after.
 */
export function closePane(w: Workspace, id: string): Workspace {
  const ids = paneIds(w.root);
  const i = ids.indexOf(id);
  if (i === -1 || ids.length === 1) return w;
  const root = without(w.root, id)!;
  const tabs = { ...w.tabs };
  delete tabs[id];
  const focused = w.focused === id ? (ids[i - 1] ?? ids[i + 1]!) : w.focused;
  return { root, tabs, focused };
}

/** Put `leaf` beside pane `target`, on side `zone` of it (not "center"). */
function insertBeside(node: PaneNode, target: string, leaf: PaneNode, zone: DropZone): PaneNode {
  const dir: SplitDir = zone === "left" || zone === "right" ? "row" : "column";
  const before = zone === "left" || zone === "top";
  if (node.kind === "pane") {
    if (node.id !== target) return node;
    return {
      kind: "split",
      id: nextId("split"),
      dir,
      children: before ? [leaf, node] : [node, leaf],
      sizes: [0.5, 0.5],
    };
  }
  const at = node.children.findIndex((c) => c.kind === "pane" && c.id === target);
  if (at !== -1 && node.dir === dir) {
    // A sibling in this split: the target shares its space with the new pane.
    const children = [...node.children];
    const sizes = [...node.sizes];
    const half = sizes[at]! / 2;
    sizes[at] = half;
    const i = before ? at : at + 1;
    children.splice(i, 0, leaf);
    sizes.splice(i, 0, half);
    return { ...node, children, sizes };
  }
  return { ...node, children: node.children.map((c) => insertBeside(c, target, leaf, zone)) };
}

/** Tabs `s` without tab `id`; null when it was the only one. Nothing goes to "closed". */
function takeOut(s: TabsState, id: string): TabsState | null {
  if (!s.list.some((t) => t.id === id)) return s;
  if (s.list.length === 1) return null;
  return { ...T.closeTab(s, id), closed: s.closed };
}

/** Tabs `s` with `tab` at `index` (counted without it) in `group`, active. */
function putIn(s: TabsState, tab: Tab, index: number, group: string | null): TabsState {
  const added: TabsState = { ...s, list: [...s.list, { ...tab, group: null }] };
  return T.activate(T.moveTab(added, tab.id, index, group), tab.id);
}

const findTab = (w: Workspace, pane: string, id: string) =>
  w.tabs[pane]?.list.find((t) => t.id === id);

/**
 * Move tab `tabId` from pane `from` into pane `to` at `index`, in `group` (of that pane;
 * null: none). The tab becomes active there, and that pane focused. A pane left without
 * tabs closes.
 */
export function moveToPane(
  w: Workspace,
  tabId: string,
  from: string,
  to: string,
  index: number,
  group: string | null = null,
): Workspace {
  const tab = findTab(w, from, tabId);
  const target = w.tabs[to];
  if (!tab || !target) return w;
  if (from === to) {
    const tabs = T.activate(T.moveTab(target, tabId, index, group), tabId);
    return { ...w, tabs: { ...w.tabs, [to]: tabs }, focused: to };
  }
  const rest = takeOut(w.tabs[from]!, tabId);
  let out: Workspace = {
    ...w,
    tabs: { ...w.tabs, [to]: putIn(target, tab, index, group) },
    focused: to,
  };
  if (rest) out = { ...out, tabs: { ...out.tabs, [from]: rest } };
  else out = closePane(out, from);
  return out;
}

/**
 * Drop tab `tabId` (from pane `from`) on pane `target`: its middle moves the tab in, at the
 * end; an edge splits the target there, with the tab alone in the new pane, which gets
 * the focus. A pane can't be split off its own only tab.
 */
export function dropOnPane(
  w: Workspace,
  tabId: string,
  from: string,
  target: string,
  zone: DropZone,
): Workspace {
  const tab = findTab(w, from, tabId);
  if (!tab || !w.tabs[target]) return w;
  if (zone === "center") {
    if (from === target) return w;
    return moveToPane(w, tabId, from, target, w.tabs[target].list.length);
  }
  const rest = takeOut(w.tabs[from]!, tabId);
  if (!rest && from === target) return w;
  const id = nextId("pane");
  const own: TabsState = {
    list: [{ ...tab, group: null }],
    active: tab.id,
    closed: [],
    groups: [],
    selected: [],
  };
  let out: Workspace = {
    root: normalize(insertBeside(w.root, target, { kind: "pane", id }, zone)),
    tabs: { ...w.tabs, [id]: own },
    focused: id,
  };
  if (rest) out = { ...out, tabs: { ...out.tabs, [from]: rest } };
  else out = closePane(out, from);
  return out;
}

/**
 * "Split right" / "Split down": a new pane beside `pane` showing what its active tab
 * shows, focused.
 */
export function splitPane(w: Workspace, pane: string, zone: Exclude<DropZone, "center">) {
  const tabs = w.tabs[pane];
  if (!tabs) return w;
  const cur = T.activeTab(tabs);
  const tab = T.makeTab({ path: cur.path, view: cur.view });
  const id = nextId("pane");
  return {
    root: normalize(insertBeside(w.root, pane, { kind: "pane", id }, zone)),
    tabs: {
      ...w.tabs,
      [id]: { list: [tab], active: tab.id, closed: [], groups: [], selected: [] },
    },
    focused: id,
  };
}

/** Set the shares of split `splitId`'s children. */
export function resizeSplit(w: Workspace, splitId: string, sizes: number[]): Workspace {
  const walk = (node: PaneNode): PaneNode => {
    if (node.kind === "pane") return node;
    if (node.id === splitId) {
      return sizes.length === node.children.length
        ? { ...node, sizes: normalSizes(sizes, sizes.length) }
        : node;
    }
    return { ...node, children: node.children.map(walk) };
  };
  return { ...w, root: walk(w.root) };
}

/**
 * New shares for the two children either side of divider `i` (between child i and i+1),
 * with that divider at `share` of the way along the split. Each keeps at least MIN_SHARE.
 */
export function dragDivider(sizes: number[], i: number, share: number): number[] {
  const start = sizes.slice(0, i).reduce((a, b) => a + b, 0);
  const pair = sizes[i]! + sizes[i + 1]!;
  const min = Math.min(MIN_SHARE, pair / 2);
  const left = Math.max(min, Math.min(pair - min, share - start));
  const out = [...sizes];
  out[i] = left;
  out[i + 1] = pair - left;
  return out;
}

/** Apply `f` to every pane's tabs. */
export function mapTabs(w: Workspace, f: (tabs: TabsState, pane: string) => TabsState): Workspace {
  let changed = false;
  const tabs: Record<string, TabsState> = {};
  for (const [id, t] of Object.entries(w.tabs)) {
    tabs[id] = f(t, id);
    if (tabs[id] !== t) changed = true;
  }
  return changed ? { ...w, tabs } : w;
}

/**
 * Whether a change (closing tabs, removing their files) left a pane with nothing but a
 * fresh empty tab: then the pane goes, when it isn't the only one.
 */
export function emptied(before: TabsState, after: TabsState): boolean {
  const tab = T.activeTab(after);
  return after.list.length === 1 && T.isEmpty(tab) && !before.list.some((t) => t.id === tab.id);
}

// ---- Layout: where each pane and divider goes, as shares of the main area ----

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Which sides of the main area a pane touches. */
export interface Edges {
  top: boolean;
  left: boolean;
  right: boolean;
  bottom: boolean;
}

export interface PaneBox {
  id: string;
  rect: Rect;
  edges: Edges;
}

/** The line between child `index` and `index + 1` of split `split` (whose box is `box`). */
export interface DividerBox {
  split: string;
  index: number;
  dir: SplitDir;
  /** Position of the line: x for a row split, y for a column split (share of the area). */
  at: number;
  box: Rect;
  sizes: number[];
}

export function layout(root: PaneNode): { panes: PaneBox[]; dividers: DividerBox[] } {
  const panes: PaneBox[] = [];
  const dividers: DividerBox[] = [];
  const walk = (node: PaneNode, box: Rect, edges: Edges) => {
    if (node.kind === "pane") {
      panes.push({ id: node.id, rect: box, edges });
      return;
    }
    const row = node.dir === "row";
    const sizes = normalSizes(node.sizes, node.children.length);
    let offset = 0;
    node.children.forEach((child, i) => {
      const first = i === 0;
      const last = i === node.children.length - 1;
      const part = sizes[i]!;
      const rect: Rect = row
        ? { x: box.x + offset * box.w, y: box.y, w: part * box.w, h: box.h }
        : { x: box.x, y: box.y + offset * box.h, w: box.w, h: part * box.h };
      walk(
        child,
        rect,
        row
          ? { ...edges, left: edges.left && first, right: edges.right && last }
          : { ...edges, top: edges.top && first, bottom: edges.bottom && last },
      );
      offset += part;
      if (!last) {
        dividers.push({
          split: node.id,
          index: i,
          dir: node.dir,
          at: row ? box.x + offset * box.w : box.y + offset * box.h,
          box,
          sizes,
        });
      }
    });
  };
  walk(root, { x: 0, y: 0, w: 1, h: 1 }, { top: true, left: true, right: true, bottom: true });
  return { panes, dividers };
}

/** Which zone of a pane's content box `r` the point x, y is over. */
export function zoneAt(r: DOMRect | Rect, x: number, y: number): DropZone {
  const left = "left" in r ? r.left : r.x;
  const top = "top" in r ? r.top : r.y;
  const w = "width" in r ? r.width : r.w;
  const h = "height" in r ? r.height : r.h;
  const fx = (x - left) / w;
  const fy = (y - top) / h;
  const near: [DropZone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  const [zone, d] = near.reduce((a, b) => (b[1] < a[1] ? b : a));
  return d < 0.25 ? zone : "center";
}

// ---- Saving per vault (the layout and each pane's tabs) ----

type SavedNode = { pane: number } | { dir: SplitDir; children: SavedNode[]; sizes: number[] };

interface Saved {
  root: SavedNode;
  /** Each pane's tabs, as tabs.ts saves them. */
  panes: string[];
  focused: number;
}

export function serialize(w: Workspace): string {
  const ids = paneIds(w.root);
  const save = (node: PaneNode): SavedNode =>
    node.kind === "pane"
      ? { pane: ids.indexOf(node.id) }
      : { dir: node.dir, children: node.children.map(save), sizes: node.sizes };
  const saved: Saved = {
    root: save(w.root),
    panes: ids.map((id) => T.serialize(w.tabs[id] ?? T.initialTabs())),
    focused: Math.max(0, ids.indexOf(w.focused)),
  };
  return JSON.stringify(saved);
}

/** A saved layout, or null when there's nothing usable. */
export function deserialize(text: string | null): Workspace | null {
  try {
    const saved = JSON.parse(text ?? "") as Saved;
    if (!saved || !Array.isArray(saved.panes) || !saved.panes.length) return null;
    const ids = saved.panes.map(() => nextId("pane"));
    const used = new Set<number>();
    const load = (n: SavedNode): PaneNode | null => {
      if (!n || typeof n !== "object") return null;
      if ("pane" in n) {
        const i = n.pane;
        if (!Number.isInteger(i) || !ids[i] || used.has(i)) return null;
        used.add(i);
        return { kind: "pane", id: ids[i]! };
      }
      if ((n.dir !== "row" && n.dir !== "column") || !Array.isArray(n.children)) return null;
      const children = n.children.map(load).filter((c): c is PaneNode => c !== null);
      if (!children.length) return null;
      return {
        kind: "split",
        id: nextId("split"),
        dir: n.dir,
        children,
        sizes: normalSizes(Array.isArray(n.sizes) ? n.sizes : [], children.length),
      };
    };
    const root = load(saved.root);
    if (!root) return null;
    const tabs: Record<string, TabsState> = {};
    for (const id of paneIds(root)) tabs[id] = T.deserialize(saved.panes[ids.indexOf(id)]!);
    const want = ids[Number.isInteger(saved.focused) ? saved.focused : 0];
    const focused = want && tabs[want] ? want : paneIds(root)[0]!;
    return { root: normalize(root), tabs, focused };
  } catch {
    return null;
  }
}
