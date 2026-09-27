import type { GraphData } from "../ipc";
import { InvalidAnswer, parseAnswer, type Schema } from "./aiJson";
import { splitFrontmatter } from "./markdown";

// Diagrams as a small graph model (nodes + edges), which AXIS can build without AI (from
// a note's outline, or from linked notes) or get from a model as validated JSON. A graph
// renders to Mermaid (for notes) or is laid out as Excalidraw shapes (for canvases).

export type Shape = "box" | "round" | "diamond" | "circle";

export interface DiagramNode {
  id: string;
  label: string;
  shape?: Shape;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramGraph {
  kind: "flowchart" | "mindmap";
  /** Flowcharts only: which way the arrows run. */
  direction?: "down" | "right";
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export const MAX_NODES = 60;

export const GRAPH_SCHEMA: Schema = {
  type: "object",
  props: {
    kind: { type: "string", enum: ["flowchart", "mindmap"] },
    direction: { type: "string", enum: ["down", "right"], optional: true },
    nodes: {
      type: "array",
      min: 1,
      max: MAX_NODES,
      items: {
        type: "object",
        props: {
          id: { type: "string" },
          label: { type: "string" },
          shape: { type: "string", enum: ["box", "round", "diamond", "circle"], optional: true },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        props: {
          from: { type: "string" },
          to: { type: "string" },
          label: { type: "string", optional: true },
        },
      },
    },
  },
};

/** Problems beyond the JSON shape: duplicate ids, dangling edges, a mind map that isn't a tree. */
export function checkGraph(g: DiagramGraph): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  g.nodes.forEach((n, i) => {
    if (!n.id.trim()) out.push(`nodes[${i}].id is empty`);
    else if (ids.has(n.id)) out.push(`node id "${n.id}" is used twice`);
    ids.add(n.id);
    if (!n.label.trim()) out.push(`nodes[${i}].label is empty`);
  });
  g.edges.forEach((e, i) => {
    if (!ids.has(e.from)) out.push(`edges[${i}].from "${e.from}" is not a node id`);
    if (!ids.has(e.to)) out.push(`edges[${i}].to "${e.to}" is not a node id`);
  });
  if (g.kind === "mindmap" && out.length === 0) {
    const parents = new Map<string, number>();
    for (const e of g.edges) parents.set(e.to, (parents.get(e.to) ?? 0) + 1);
    const root = g.nodes[0]!.id;
    if (parents.has(root)) out.push(`the mind map's first node "${root}" must be the center`);
    for (const [id, n] of parents)
      if (n > 1) out.push(`mind map node "${id}" has ${n} parents; each node needs one`);
    const reached = new Set(treeOrder(g).map((x) => x.node.id));
    for (const n of g.nodes)
      if (!reached.has(n.id)) out.push(`mind map node "${n.id}" is not connected to the center`);
  }
  return out;
}

/** Parse and check a model's graph answer; throws `InvalidAnswer`. */
export function parseGraph(answer: string): DiagramGraph {
  const g = parseAnswer<DiagramGraph>(answer, GRAPH_SCHEMA);
  const problems = checkGraph(g);
  if (problems.length) throw new InvalidAnswer(problems);
  return g;
}

// ---- Mermaid ----

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const quoted = (s: string) => `"${clean(s).replace(/"/g, "#quot;")}"`;

const SHAPES: Record<Shape, [string, string]> = {
  box: ["[", "]"],
  round: ["(", ")"],
  diamond: ["{", "}"],
  circle: ["((", "))"],
};

/** Depth-first order from the first node (mind maps). */
function treeOrder(g: DiagramGraph): { node: DiagramNode; depth: number }[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>();
  for (const e of g.edges) kids.set(e.from, [...(kids.get(e.from) ?? []), e.to]);
  const out: { node: DiagramNode; depth: number }[] = [];
  const seen = new Set<string>();
  const walk = (id: string, depth: number) => {
    const node = byId.get(id);
    if (!node || seen.has(id)) return;
    seen.add(id);
    out.push({ node, depth });
    for (const k of kids.get(id) ?? []) walk(k, depth + 1);
  };
  if (g.nodes[0]) walk(g.nodes[0].id, 0);
  return out;
}

export function graphToMermaid(g: DiagramGraph): string {
  const id = new Map(g.nodes.map((n, i) => [n.id, `n${i}`]));
  if (g.kind === "mindmap") {
    const lines = ["mindmap"];
    for (const { node, depth } of treeOrder(g)) {
      // Mind map text can't be quoted; drop the characters that delimit shapes.
      const text = clean(node.label)
        .replace(/[()[\]{}]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      const [a, b] = depth === 0 ? ["((", "))"] : SHAPES[node.shape ?? "box"];
      lines.push(`${"  ".repeat(depth + 1)}${id.get(node.id)}${a}${text || "…"}${b}`);
    }
    return lines.join("\n");
  }
  const lines = [`flowchart ${g.direction === "right" ? "LR" : "TD"}`];
  for (const n of g.nodes) {
    const [a, b] = SHAPES[n.shape ?? "box"];
    lines.push(`  ${id.get(n.id)}${a}${quoted(n.label)}${b}`);
  }
  for (const e of g.edges) {
    const label = e.label?.trim() ? `|${quoted(e.label)}|` : "";
    lines.push(`  ${id.get(e.from)} -->${label} ${id.get(e.to)}`);
  }
  return lines.join("\n");
}

// ---- Without AI: outline and links ----

/** Plain label from a line of Markdown (links, emphasis and code markers removed). */
export function plainLabel(s: string): string {
  return clean(
    s
      .replace(
        /!?\[\[([^\]|#]*)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
        (_m, t: string, a?: string) => a ?? t,
      )
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s\^[\w-]+$/, "")
      .replace(/(\*\*|__|\*|_|~~|`|==)/g, "")
      .replace(/^\[[ xX]\]\s*/, ""),
  ).slice(0, 80);
}

/** A mind map from a note's headings and (nested) list items. */
export function outlineToGraph(markdown: string, title: string): DiagramGraph {
  const body = markdown.slice(splitFrontmatter(markdown).length);
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  const add = (label: string, parent: string | null) => {
    const id = `n${nodes.length}`;
    nodes.push({ id, label });
    if (parent) edges.push({ from: parent, to: id });
    return id;
  };
  let root: string | null = null;
  // Open headings by level, and open list items by indent under the current heading.
  const headings: { level: number; id: string }[] = [];
  let items: { indent: number; id: string }[] = [];
  let fence = false;
  for (const raw of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) fence = !fence;
    if (fence || nodes.length >= MAX_NODES) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) {
      const level = h[1]!.length;
      const label = plainLabel(h[2]!);
      if (!root && level === 1) {
        root = add(label, null);
        continue;
      }
      root ??= add(title, null);
      while (headings.length && headings.at(-1)!.level >= level) headings.pop();
      headings.push({ level, id: add(label, headings.at(-1)?.id ?? root) });
      items = [];
      continue;
    }
    const li = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+)$/.exec(raw);
    if (li) {
      root ??= add(title, null);
      const indent = li[1]!.replace(/\t/g, "    ").length;
      while (items.length && items.at(-1)!.indent >= indent) items.pop();
      const parent = items.at(-1)?.id ?? headings.at(-1)?.id ?? root;
      const label = plainLabel(li[2]!);
      if (label) items.push({ indent, id: add(label, parent) });
    }
  }
  if (!root) add(title, null);
  return { kind: "mindmap", nodes, edges };
}

const noteLabel = (path: string, name?: string) =>
  name ?? path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** A flowchart of `center`, the notes it links to and the notes linking to it. */
export function linksToGraph(center: string, data: GraphData, limit = 40): DiagramGraph {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const keep = new Set([center]);
  for (const e of data.edges) {
    if (keep.size >= limit) break;
    if (e.source === center) keep.add(e.target);
    else if (e.target === center) keep.add(e.source);
  }
  const ids = [...keep];
  const nodes: DiagramNode[] = ids.map((id) => ({
    id,
    label: noteLabel(id.replace(/^\?/, ""), byId.get(id)?.name),
    shape: id === center ? "round" : byId.get(id)?.unresolved ? "circle" : "box",
  }));
  const seen = new Set<string>();
  const edges = data.edges.filter((e) => {
    const k = `${e.source}\n${e.target}`;
    if (!keep.has(e.source) || !keep.has(e.target) || e.source === e.target || seen.has(k))
      return false;
    seen.add(k);
    return true;
  });
  return {
    kind: "flowchart",
    direction: "right",
    nodes,
    edges: edges.map((e) => ({ from: e.source, to: e.target })),
  };
}

// ---- Layout for canvases ----

export interface Placed extends DiagramNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

const GAP_X = 70;
const GAP_Y = 50;

function size(label: string): { width: number; height: number } {
  const perLine = 24;
  const lines = Math.max(1, Math.ceil(label.length / perLine));
  const width = Math.min(260, Math.max(120, Math.min(label.length, perLine) * 9 + 40));
  return { width, height: 36 + lines * 22 };
}

/** Positions for every node, with the diagram's top-left at (0, 0). */
export function layoutGraph(g: DiagramGraph): Placed[] {
  const sized = new Map(g.nodes.map((n) => [n.id, { ...n, ...size(n.label), x: 0, y: 0 }]));
  if (g.kind === "mindmap") {
    // Center on the left, children to the right; each subtree gets the height it needs.
    const kids = new Map<string, string[]>();
    for (const e of g.edges) kids.set(e.from, [...(kids.get(e.from) ?? []), e.to]);
    const colX: number[] = [];
    const depthOf = new Map(treeOrder(g).map((t) => [t.node.id, t.depth]));
    for (const [id, d] of depthOf)
      colX[d + 1] = Math.max(colX[d + 1] ?? 0, (colX[d] ?? 0) + sized.get(id)!.width + GAP_X);
    colX[0] = 0;
    const place = (id: string, top: number): number => {
      const n = sized.get(id)!;
      const d = depthOf.get(id) ?? 0;
      n.x = colX[d] ?? 0;
      const children = (kids.get(id) ?? []).filter((k) => depthOf.get(k) === d + 1);
      if (!children.length) {
        n.y = top;
        return n.height + GAP_Y / 2;
      }
      let h = 0;
      for (const k of children) h += place(k, top + h);
      const first = sized.get(children[0]!)!;
      const last = sized.get(children.at(-1)!)!;
      n.y = (first.y + last.y + last.height) / 2 - n.height / 2;
      return Math.max(h, n.height + GAP_Y / 2);
    };
    if (g.nodes[0]) place(g.nodes[0].id, 0);
  } else {
    // Layers by longest path from the sources (back edges of cycles are ignored).
    const out = new Map<string, string[]>();
    for (const e of g.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
    const state = new Map<string, 1 | 2>();
    const forward: DiagramEdge[] = [];
    const visit = (id: string) => {
      state.set(id, 1);
      for (const to of out.get(id) ?? []) {
        if (state.get(to) === 1) continue; // back edge
        forward.push({ from: id, to });
        if (!state.has(to)) visit(to);
      }
      state.set(id, 2);
    };
    const incoming = new Set(g.edges.map((e) => e.to));
    for (const n of g.nodes) if (!incoming.has(n.id) && !state.has(n.id)) visit(n.id);
    for (const n of g.nodes) if (!state.has(n.id)) visit(n.id);
    const rank = new Map<string, number>(g.nodes.map((n) => [n.id, 0]));
    for (let changed = true, guard = 0; changed && guard < g.nodes.length; guard++) {
      changed = false;
      for (const e of forward) {
        const r = rank.get(e.from)! + 1;
        if (r > rank.get(e.to)!) {
          rank.set(e.to, r);
          changed = true;
        }
      }
    }
    const layers: string[][] = [];
    for (const n of g.nodes) (layers[rank.get(n.id)!] ??= []).push(n.id);
    // One barycenter pass keeps children near their parents.
    const order = new Map<string, number>();
    layers.forEach((layer, li) => {
      if (li > 0) {
        const bary = (id: string) => {
          const ps = forward.filter((e) => e.to === id).map((e) => order.get(e.from) ?? 0);
          return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : Infinity;
        };
        layer.sort((a, b) => bary(a) - bary(b));
      }
      layer.forEach((id, i) => order.set(id, i));
    });
    const right = g.direction === "right";
    let along = 0;
    for (const layer of layers.filter(Boolean)) {
      const nodes = layer.map((id) => sized.get(id)!);
      const thickness = Math.max(...nodes.map((n) => (right ? n.width : n.height)));
      const spans = nodes.map((n) => (right ? n.height : n.width));
      const total = spans.reduce((a, b) => a + b, 0) + GAP_X * (nodes.length - 1);
      let across = -total / 2;
      nodes.forEach((n, i) => {
        if (right) {
          n.x = along + (thickness - n.width) / 2;
          n.y = across;
        } else {
          n.x = across;
          n.y = along + (thickness - n.height) / 2;
        }
        across += spans[i]! + GAP_X;
      });
      along += thickness + (right ? GAP_X * 1.5 : GAP_Y * 1.5);
    }
  }
  const placed = [...sized.values()];
  const minX = Math.min(...placed.map((n) => n.x));
  const minY = Math.min(...placed.map((n) => n.y));
  return placed.map((n) => ({ ...n, x: Math.round(n.x - minX), y: Math.round(n.y - minY) }));
}

/** Where the line from `c` (a box's center) toward `to` leaves the box, plus a gap. */
function border(
  c: { x: number; y: number },
  box: { width: number; height: number },
  to: { x: number; y: number },
) {
  const dx = to.x - c.x;
  const dy = to.y - c.y;
  if (!dx && !dy) return c;
  const scale = Math.min(
    dx ? box.width / 2 / Math.abs(dx) : Infinity,
    dy ? box.height / 2 / Math.abs(dy) : Infinity,
  );
  const len = Math.hypot(dx, dy);
  const gap = 6 / len;
  return { x: c.x + dx * (scale + gap), y: c.y + dy * (scale + gap) };
}

const EXCALIDRAW_SHAPE: Record<Shape, "rectangle" | "ellipse" | "diamond"> = {
  box: "rectangle",
  round: "rectangle",
  diamond: "diamond",
  circle: "ellipse",
};

/**
 * Excalidraw element skeletons (for `convertToExcalidrawElements`): labelled shapes and
 * arrows bound to them, with the diagram's top-left at `origin`.
 */
export function graphToSkeleton(g: DiagramGraph, origin: { x: number; y: number }): object[] {
  const placed = layoutGraph(g);
  const prefix = `dg${Date.now().toString(36)}`;
  const idOf = new Map(placed.map((n, i) => [n.id, `${prefix}-${i}`]));
  const at = new Map(placed.map((n) => [n.id, n]));
  const shapes = placed.map((n) => ({
    type: EXCALIDRAW_SHAPE[n.shape ?? "box"],
    id: idOf.get(n.id),
    x: origin.x + n.x,
    y: origin.y + n.y,
    width: n.width,
    height: n.height,
    roundness: n.shape === "round" || !n.shape ? { type: 3 } : null,
    label: { text: n.label, fontSize: 16 },
  }));
  const arrows = g.edges.map((e) => {
    const a = at.get(e.from)!;
    const b = at.get(e.to)!;
    const ac = { x: origin.x + a.x + a.width / 2, y: origin.y + a.y + a.height / 2 };
    const bc = { x: origin.x + b.x + b.width / 2, y: origin.y + b.y + b.height / 2 };
    // From border to border (with a small gap), not through the boxes.
    const s = border(ac, a, bc);
    const t = border(bc, b, ac);
    return {
      type: "arrow",
      x: s.x,
      y: s.y,
      width: t.x - s.x,
      height: t.y - s.y,
      start: { id: idOf.get(e.from) },
      end: { id: idOf.get(e.to) },
      ...(e.label?.trim() ? { label: { text: e.label.trim(), fontSize: 14 } } : {}),
    };
  });
  return [...shapes, ...arrows];
}
