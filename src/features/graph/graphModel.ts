import Graph from "graphology";
import type { GraphData, GraphNode } from "../../ipc";

// Pure graph building for the graph views: filtering, local neighborhoods, sizes,
// colors by top-level folder, and deterministic starting positions.

export interface GraphOptions {
  /** `tag:x`, `path:x`, or plain text matched against name and path. */
  query: string;
  showOrphans: boolean;
  showUnresolved: boolean;
  /** Local graph: only nodes within `depth` links of `center`. */
  center?: string;
  depth?: number;
}

export interface NodeAttrs {
  label: string;
  x: number;
  y: number;
  size: number;
  color: string;
  folder: string;
  unresolved: boolean;
  tags: string[];
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Top-level folder of a path ("" for root notes). */
export function topFolder(path: string): string {
  const i = path.indexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

/** A stable, readable color per folder (root notes use the accent). */
export function folderColor(folder: string, accent: string): string {
  if (!folder) return accent;
  return `hsl(${hash(folder) % 360}, 55%, 55%)`;
}

function matches(node: GraphNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (q.startsWith("tag:")) {
    const t = q.slice(4).replace(/^#/, "");
    return node.tags.some((x) => x === t || x.startsWith(t + "/"));
  }
  if (q.startsWith("path:")) return node.id.toLowerCase().includes(q.slice(5));
  return node.name.toLowerCase().includes(q) || node.id.toLowerCase().includes(q);
}

export function buildGraph(
  data: GraphData,
  opts: GraphOptions,
  colors: { accent: string; muted: string } = { accent: "#4f5bd5", muted: "#8d9199" },
): Graph<NodeAttrs> {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const neighbors = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    neighbors.get(a)!.add(b);
  };
  for (const e of data.edges) {
    link(e.source, e.target);
    link(e.target, e.source);
  }

  let keep = new Set(
    data.nodes
      .filter((n) => (opts.showUnresolved || !n.unresolved) && matches(n, opts.query))
      .map((n) => n.id),
  );

  if (opts.center) {
    const depth = opts.depth ?? 1;
    const local = new Set<string>([opts.center]);
    let frontier = [opts.center];
    for (let d = 0; d < depth; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const nb of neighbors.get(id) ?? []) {
          if (!local.has(nb) && (opts.showUnresolved || !byId.get(nb)?.unresolved)) {
            local.add(nb);
            next.push(nb);
          }
        }
      }
      frontier = next;
    }
    keep = new Set([...keep].filter((id) => local.has(id)));
    if (byId.has(opts.center)) keep.add(opts.center);
  }

  const graph = new Graph<NodeAttrs>({ type: "directed", multi: false });
  const degree = (id: string) => [...(neighbors.get(id) ?? [])].filter((n) => keep.has(n)).length;
  for (const id of keep) {
    const n = byId.get(id)!;
    const d = degree(id);
    if (!opts.showOrphans && d === 0 && id !== opts.center) continue;
    const h = hash(id);
    const folder = topFolder(id);
    graph.addNode(id, {
      label: n.name,
      x: ((h % 10007) / 10007) * 100,
      y: (((h >>> 13) % 10007) / 10007) * 100,
      size: 3 + Math.sqrt(d) * 2 + (id === opts.center ? 3 : 0),
      color: n.unresolved ? colors.muted : folderColor(folder, colors.accent),
      folder,
      unresolved: n.unresolved,
      tags: n.tags,
    });
  }
  for (const e of data.edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target) && !graph.hasEdge(e.source, e.target)) {
      graph.addEdge(e.source, e.target, { size: 1 });
    }
  }
  return graph;
}
