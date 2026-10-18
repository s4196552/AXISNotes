import type { GraphData } from "../../ipc";
import { folderColor, topFolder } from "./graphModel";
import type { TreeDirection } from "./graphSettings";

// The tree layout: a spanning tree of a root note's links (or backlinks, or the vault's
// folders), placed left to right in one column per level, like a decision tree.

export interface TreeNode {
  /** Note path, `?name` for an unresolved link, or `folder/` for a folder. */
  id: string;
  label: string;
  color: string;
  unresolved: boolean;
  folder: boolean;
  children: TreeNode[];
  /** Links to notes that already appear elsewhere in the tree (not drawn twice). */
  elsewhere: number;
  /** Items past the depth limit. */
  beyond: number;
}

export interface TreeOptions {
  direction: TreeDirection;
  /** Root note (ignored for folders). */
  root: string | null;
  depth: number;
  showUnresolved: boolean;
  /** Stop adding notes past this many. */
  maxNodes?: number;
}

export interface Tree {
  root: TreeNode | null;
  count: number;
  /** Notes were left out because the tree reached `maxNodes`. */
  truncated: boolean;
}

export const MAX_TREE_NODES = 1500;

const byLabel = (a: TreeNode, b: TreeNode) =>
  Number(b.folder) - Number(a.folder) ||
  a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true });

/** The note with the most links in and out: a sensible default root. */
export function busiestNote(data: GraphData): string | null {
  const degree = new Map<string, number>();
  for (const e of data.edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  let best: string | null = null;
  let most = -1;
  for (const n of data.nodes) {
    if (n.unresolved) continue;
    const d = degree.get(n.id) ?? 0;
    if (d > most || (d === most && best !== null && n.id < best)) {
      best = n.id;
      most = d;
    }
  }
  return best;
}

export function buildTree(
  data: GraphData,
  opts: TreeOptions,
  colors: { accent: string; muted: string } = { accent: "#4f5bd5", muted: "#8d9199" },
): Tree {
  return opts.direction === "folders"
    ? folderTree(data, opts, colors)
    : linkTree(data, opts, colors);
}

function linkTree(
  data: GraphData,
  opts: TreeOptions,
  colors: { accent: string; muted: string },
): Tree {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  if (!opts.root || !byId.has(opts.root)) return { root: null, count: 0, truncated: false };
  const max = opts.maxNodes ?? MAX_TREE_NODES;
  const next = new Map<string, string[]>();
  for (const e of data.edges) {
    const [from, to] = opts.direction === "links" ? [e.source, e.target] : [e.target, e.source];
    if (from === to) continue;
    if (!next.has(from)) next.set(from, []);
    next.get(from)!.push(to);
  }
  const make = (id: string): TreeNode => {
    const n = byId.get(id)!;
    return {
      id,
      label: n.name,
      color: n.unresolved ? colors.muted : folderColor(topFolder(id), colors.accent),
      unresolved: n.unresolved,
      folder: false,
      children: [],
      elsewhere: 0,
      beyond: 0,
    };
  };

  // Breadth first, so each note sits at its shallowest level.
  const root = make(opts.root);
  const placed = new Set([opts.root]);
  let frontier = [root];
  let truncated = false;
  for (let level = 0; frontier.length; level++) {
    const following: TreeNode[] = [];
    for (const parent of frontier) {
      const targets = [...new Set(next.get(parent.id) ?? [])].filter(
        (t) => byId.has(t) && (opts.showUnresolved || !byId.get(t)!.unresolved),
      );
      if (level >= opts.depth) {
        parent.beyond = targets.filter((t) => !placed.has(t)).length;
        continue;
      }
      for (const t of targets) {
        if (placed.has(t)) {
          parent.elsewhere++;
        } else if (placed.size >= max) {
          truncated = true;
        } else {
          placed.add(t);
          parent.children.push(make(t));
        }
      }
      parent.children.sort(byLabel);
      following.push(...parent.children);
    }
    frontier = following;
  }
  return { root, count: placed.size, truncated };
}

function folderTree(
  data: GraphData,
  opts: TreeOptions,
  colors: { accent: string; muted: string },
): Tree {
  const max = opts.maxNodes ?? MAX_TREE_NODES;
  const root: TreeNode = {
    id: "/",
    label: "Vault",
    color: colors.accent,
    unresolved: false,
    folder: true,
    children: [],
    elsewhere: 0,
    beyond: 0,
  };
  const folders = new Map<string, TreeNode>([["", root]]);
  let count = 1;
  let truncated = false;

  /** The folder node for `path` (made on the way), or null when it's past the depth. */
  const folderAt = (path: string): TreeNode | null => {
    const parts = path ? path.split("/") : [];
    let node = root;
    for (const [i, part] of parts.entries()) {
      const key = parts.slice(0, i + 1).join("/");
      let child = folders.get(key);
      if (!child) {
        if (i + 1 > opts.depth) {
          node.beyond++;
          return null;
        }
        if (count >= max) {
          truncated = true;
          return null;
        }
        child = {
          id: key + "/",
          label: part,
          color: folderColor(parts[0] ?? part, colors.accent),
          unresolved: false,
          folder: true,
          children: [],
          elsewhere: 0,
          beyond: 0,
        };
        folders.set(key, child);
        node.children.push(child);
        count++;
      }
      node = child;
    }
    return node;
  };

  for (const n of data.nodes) {
    if (n.unresolved) continue;
    const slash = n.id.lastIndexOf("/");
    const dir = slash === -1 ? "" : n.id.slice(0, slash);
    const depth = dir ? dir.split("/").length + 1 : 1;
    const parent = folderAt(dir);
    if (!parent) continue;
    if (depth > opts.depth) {
      parent.beyond++;
      continue;
    }
    if (count >= max) {
      truncated = true;
      continue;
    }
    parent.children.push({
      id: n.id,
      label: n.name,
      color: folderColor(topFolder(n.id), colors.accent),
      unresolved: false,
      folder: false,
      children: [],
      elsewhere: 0,
      beyond: 0,
    });
    count++;
  }
  const sort = (t: TreeNode) => {
    t.children.sort(byLabel);
    t.children.forEach(sort);
  };
  sort(root);
  return { root, count, truncated };
}

// ---- Layout -------------------------------------------------------------------------

export const TREE_DIMS = {
  boxWidth: 168,
  boxHeight: 30,
  column: 240,
  row: 46,
  header: 36,
  pad: 24,
} as const;

export interface PlacedNode {
  node: TreeNode;
  parent: string | null;
  depth: number;
  /** Top-left corner of the box. */
  x: number;
  y: number;
  collapsed: boolean;
}

export interface PlacedEdge {
  from: string;
  to: string;
  /** SVG path data for the elbow connector. */
  d: string;
}

export interface TreeLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  /** Levels drawn (columns). */
  levels: number;
  width: number;
  height: number;
}

/**
 * Place the tree's visible nodes: one column per level, leaves on consecutive rows and
 * each parent centred on its children. `nodes` is in depth-first order, which is also
 * top-to-bottom reading order.
 */
export function layoutTree(root: TreeNode | null, collapsed: ReadonlySet<string>): TreeLayout {
  const { boxWidth: W, boxHeight: H, column, row, header, pad } = TREE_DIMS;
  const nodes: PlacedNode[] = [];
  const edges: PlacedEdge[] = [];
  if (!root) return { nodes, edges, levels: 0, width: 0, height: 0 };
  let leaves = 0;
  let levels = 1;

  const place = (node: TreeNode, parent: string | null, depth: number): PlacedNode => {
    levels = Math.max(levels, depth + 1);
    const isCollapsed = collapsed.has(node.id) && node.children.length > 0;
    const placed: PlacedNode = {
      node,
      parent,
      depth,
      x: pad + depth * column + (column - W) / 2,
      y: 0,
      collapsed: isCollapsed,
    };
    nodes.push(placed);
    const kids = isCollapsed ? [] : node.children.map((c) => place(c, node.id, depth + 1));
    const first = kids[0];
    const last = kids.at(-1);
    if (!first || !last) {
      placed.y = header + pad + leaves * row;
      leaves++;
    } else {
      placed.y = (first.y + last.y) / 2;
      for (const k of kids) edges.push({ from: node.id, to: k.node.id, d: elbow(placed, k) });
    }
    return placed;
  };
  place(root, null, 0);

  function elbow(p: PlacedNode, c: PlacedNode): string {
    const py = p.y + H / 2;
    const cy = c.y + H / 2;
    // Straight across when level, otherwise down (or up) from the parent's middle and
    // across into the child, like a decision tree.
    if (Math.abs(cy - py) < 0.5) return `M${p.x + W},${py} H${c.x}`;
    const mx = p.x + W / 2;
    const sy = cy > py ? p.y + H : p.y;
    return `M${mx},${sy} V${cy} H${c.x}`;
  }

  return {
    nodes,
    edges,
    levels,
    width: pad * 2 + levels * column,
    height: header + pad * 2 + Math.max(0, leaves - 1) * row + H,
  };
}

/** Ids on the way from the root to `id` (both included), or empty if it isn't shown. */
export function pathTo(layout: TreeLayout, id: string | null): Set<string> {
  const parent = new Map(layout.nodes.map((n) => [n.node.id, n.parent]));
  const out = new Set<string>();
  if (!id || !parent.has(id)) return out;
  for (let cur: string | null = id; cur !== null; cur = parent.get(cur) ?? null) out.add(cur);
  return out;
}

/** Column heading for a level. */
export function levelTitle(direction: TreeDirection, level: number): string {
  if (level === 0) return direction === "folders" ? "Vault" : "Root";
  if (direction === "folders") return `Level ${level}`;
  const steps = `${level} ${level === 1 ? "step" : "steps"}`;
  return direction === "links" ? `Links · ${steps}` : `Backlinks · ${steps}`;
}
