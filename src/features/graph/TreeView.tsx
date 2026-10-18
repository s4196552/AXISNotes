import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GraphData } from "../../ipc";
import type { TreeDirection } from "./graphSettings";
import {
  buildTree,
  layoutTree,
  levelTitle,
  pathTo,
  TREE_DIMS,
  type PlacedNode,
  type TreeLayout,
} from "./treeModel";

// The tree layout of the graph view: columns per level, boxes joined by elbow
// connectors, the path to the hovered (or open) note in the accent colour. Drawn as SVG,
// panned by dragging the background and zoomed with the wheel.

const { boxWidth: W, boxHeight: H, column, header, pad } = TREE_DIMS;
const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2.5;

interface View {
  x: number;
  y: number;
  k: number;
}

const NONE: ReadonlySet<string> = new Set();

const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** Shorten a label to fit a box (SVG text doesn't ellipsize). */
function fit(label: string, room: number): string {
  const chars = Math.floor(room / 7.2);
  return label.length <= chars ? label : label.slice(0, Math.max(1, chars - 1)) + "…";
}

/** A view that shows the whole tree, or as much as fits at a readable size. */
function fitView(layout: TreeLayout, el: HTMLElement | null, readable: boolean): View {
  const cw = el?.clientWidth || 800;
  const ch = el?.clientHeight || 600;
  const root = layout.nodes[0];
  if (!root) return { x: 0, y: 0, k: 1 };
  const whole = Math.min(cw / layout.width, ch / layout.height, 1);
  const k = clampZoom(readable ? Math.max(whole, 0.7) : whole);
  const x = layout.width * k <= cw ? (cw - layout.width * k) / 2 : 0;
  const y = layout.height * k <= ch ? (ch - layout.height * k) / 2 : ch / 2 - (root.y + H / 2) * k;
  return { x, y, k };
}

export interface TreeViewProps {
  data: GraphData;
  direction: TreeDirection;
  depth: number;
  showUnresolved: boolean;
  root: string | null;
  /** Highlighted when nothing is hovered or focused. */
  activePath: string | null;
  colors: { accent: string; muted: string };
  onOpen(id: string): void;
  onMakeRoot(id: string): void;
  /** Reports how many notes the tree shows. */
  onCount?(count: number, truncated: boolean): void;
}

export function TreeView(props: TreeViewProps) {
  const { data, direction, depth, showUnresolved, root, activePath, colors, onCount } = props;
  const box = useRef<HTMLDivElement>(null);
  const markerId = useId().replace(/:/g, "");
  // Collapsed nodes belong to one tree: a different root, direction or depth starts
  // fully expanded again.
  const frameKey = `${direction}|${root}|${depth}`;
  const [folded, setFolded] = useState<{ key: string; ids: ReadonlySet<string> }>({
    key: frameKey,
    ids: new Set(),
  });
  const collapsed = folded.key === frameKey ? folded.ids : NONE;
  const [hovered, setHovered] = useState<string | null>(null);
  /** The roving tab stop; it lights its path only while the tree has focus. */
  const [focused, setFocused] = useState<string | null>(null);
  const [hasFocus, setHasFocus] = useState(false);
  const moveFocus = useRef(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const items = useRef(new Map<string, SVGGElement>());

  const tree = useMemo(
    () => buildTree(data, { direction, root, depth, showUnresolved }, colors),
    [data, direction, root, depth, showUnresolved, colors],
  );
  const layout = useMemo(() => layoutTree(tree.root, collapsed), [tree, collapsed]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.node.id, n])), [layout]);
  const lit = useMemo(
    () => pathTo(layout, hovered ?? (hasFocus ? focused : null) ?? activePath),
    [layout, hovered, hasFocus, focused, activePath],
  );

  useEffect(() => onCount?.(tree.count, tree.truncated), [tree, onCount]);

  // A different tree is framed; collapsing or an index refresh keeps the current view.
  const framed = useRef("");
  useLayoutEffect(() => {
    if (framed.current === frameKey || !layout.nodes.length) return;
    framed.current = frameKey;
    setView(fitView(layout, box.current, true));
  }, [frameKey, layout]);

  // Wheel zoom around the pointer (a native listener: React's is passive).
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setView((v) => {
        const k = clampZoom(v.k * Math.exp(-e.deltaY * 0.0015));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag the background to pan.
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; id: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest(".tree-node")) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const zoomBy = (factor: number) => {
    const el = box.current;
    const cx = (el?.clientWidth || 800) / 2;
    const cy = (el?.clientHeight || 600) / 2;
    setView((v) => {
      const k = clampZoom(v.k * factor);
      return { k, x: cx - ((cx - v.x) * k) / v.k, y: cy - ((cy - v.y) * k) / v.k };
    });
  };

  const toggle = useCallback(
    (id: string) => {
      setFolded((f) => {
        const ids = new Set(f.key === frameKey ? f.ids : NONE);
        if (ids.has(id)) ids.delete(id);
        else ids.add(id);
        return { key: frameKey, ids };
      });
    },
    [frameKey],
  );

  /** Move keyboard focus to a node, panning just enough to show it. */
  const focusNode = (p: PlacedNode | undefined) => {
    if (!p) return;
    moveFocus.current = true;
    setFocused(p.node.id);
    const el = box.current;
    if (el) {
      setView((v) => {
        const left = p.x * v.k + v.x;
        const top = p.y * v.k + v.y;
        const cw = el.clientWidth || 800;
        const ch = el.clientHeight || 600;
        let { x, y } = v;
        if (left < 8) x += 8 - left;
        else if (left + W * v.k > cw - 8) x -= left + W * v.k - (cw - 8);
        if (top < 8) y += 8 - top;
        else if (top + H * v.k > ch - 8) y -= top + H * v.k - (ch - 8);
        return { ...v, x, y };
      });
    }
  };

  // Only arrow keys move DOM focus; a refresh never pulls focus back into the tree.
  useEffect(() => {
    if (!moveFocus.current || !focused) return;
    moveFocus.current = false;
    items.current.get(focused)?.focus({ preventScroll: true });
  }, [focused, layout]);

  const onKeyDown = (e: React.KeyboardEvent, p: PlacedNode) => {
    const i = layout.nodes.indexOf(p);
    const hasKids = p.node.children.length > 0;
    switch (e.key) {
      case "Enter":
      case " ":
        if (!p.node.folder) props.onOpen(p.node.id);
        else if (hasKids) toggle(p.node.id);
        break;
      case "ArrowDown":
        focusNode(layout.nodes[i + 1]);
        break;
      case "ArrowUp":
        focusNode(layout.nodes[i - 1]);
        break;
      case "Home":
        focusNode(layout.nodes[0]);
        break;
      case "End":
        focusNode(layout.nodes.at(-1));
        break;
      case "ArrowRight":
        if (p.collapsed) toggle(p.node.id);
        else if (hasKids) focusNode(layout.nodes[i + 1]);
        break;
      case "ArrowLeft":
        if (hasKids && !p.collapsed) toggle(p.node.id);
        else focusNode(p.parent ? byId.get(p.parent) : undefined);
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  const rovingId = focused && byId.has(focused) ? focused : layout.nodes[0]?.node.id;
  return (
    <div
      className="tree-view"
      ref={box}
      data-testid="tree-view"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {tree.root ? null : (
        <div className="tree-empty muted">
          {direction === "folders" ? "No notes yet." : "Choose a root note to draw its tree."}
        </div>
      )}
      <svg
        className="tree-svg"
        width="100%"
        height="100%"
        style={tree.root ? undefined : { display: "none" }}
      >
        <defs>
          {["", "-lit"].map((v) => (
            <marker
              key={v}
              id={markerId + v}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" className={`tree-arrow${v}`} />
            </marker>
          ))}
        </defs>
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {Array.from({ length: layout.levels }, (_, level) => (
            <g key={level} className="tree-band">
              <rect
                x={pad + level * column}
                y={0}
                width={column}
                height={layout.height}
                className={level % 2 ? "tree-band-odd" : "tree-band-even"}
              />
              <text x={pad + level * column + column / 2} y={header / 2 + 5} textAnchor="middle">
                {levelTitle(direction, level)}
              </text>
            </g>
          ))}
          {layout.edges.map((e) => {
            const on = lit.has(e.from) && lit.has(e.to);
            return (
              <path
                key={`${e.from}>${e.to}`}
                d={e.d}
                className={on ? "tree-edge tree-edge-lit" : "tree-edge"}
                markerEnd={`url(#${markerId}${on ? "-lit" : ""})`}
              />
            );
          })}
          <g role="tree" aria-label="Note tree">
            {layout.nodes.map((p) => {
              const { node } = p;
              const on = lit.has(node.id);
              const hasKids = node.children.length > 0;
              const extra = [
                node.elsewhere ? `${node.elsewhere} more linked elsewhere in the tree` : "",
                node.beyond ? `${node.beyond} more past the depth limit` : "",
              ].filter(Boolean);
              return (
                <g
                  key={node.id}
                  ref={(el) => {
                    if (el) items.current.set(node.id, el);
                    else items.current.delete(node.id);
                  }}
                  className={[
                    "tree-node",
                    on ? "tree-node-lit" : "",
                    node.unresolved ? "tree-node-unresolved" : "",
                    node.folder ? "tree-node-folder" : "",
                  ].join(" ")}
                  transform={`translate(${p.x},${p.y})`}
                  role="treeitem"
                  aria-level={p.depth + 1}
                  aria-expanded={hasKids ? !p.collapsed : undefined}
                  aria-current={node.id === activePath ? "page" : undefined}
                  aria-label={node.label}
                  tabIndex={node.id === rovingId ? 0 : -1}
                  onFocus={() => {
                    setFocused(node.id);
                    setHasFocus(true);
                  }}
                  onBlur={() => setHasFocus(false)}
                  onKeyDown={(e) => onKeyDown(e, p)}
                  onMouseEnter={() => setHovered(node.id)}
                  onMouseLeave={() => setHovered(null)}
                  onClick={() => {
                    if (!node.folder) props.onOpen(node.id);
                    else if (hasKids) toggle(node.id);
                  }}
                  onContextMenu={(e) => {
                    if (node.folder || node.unresolved) return;
                    e.preventDefault();
                    props.onMakeRoot(node.id);
                  }}
                >
                  <title>
                    {[
                      node.folder ? node.id.replace(/\/$/, "") || "Vault" : node.id,
                      ...extra,
                      node.folder ? "" : "Click to open · right-click to make it the root",
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  </title>
                  <rect className="tree-box" width={W} height={H} rx={6} />
                  <rect className="tree-stripe" width={4} height={H} rx={2} fill={node.color} />
                  <text className="tree-label" x={12} y={H / 2 + 4.5}>
                    {fit(node.label, W - (hasKids ? 44 : 20))}
                  </text>
                  {node.beyond + node.elsewhere > 0 && !hasKids ? (
                    <text className="tree-more" x={W - 8} y={H / 2 + 4} textAnchor="end">
                      +{node.beyond + node.elsewhere}
                    </text>
                  ) : null}
                  {hasKids ? (
                    <g
                      className="tree-toggle"
                      transform={`translate(${W - 15},${H / 2})`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(node.id);
                      }}
                    >
                      <circle r={9} />
                      <text y={3.5} textAnchor="middle">
                        {p.collapsed ? node.children.length : "−"}
                      </text>
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
        </g>
      </svg>
      <div className="tree-zoom" role="group" aria-label="Zoom" hidden={!tree.root}>
        <button type="button" aria-label="Zoom in" onClick={() => zoomBy(1.25)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(0.8)}>
          −
        </button>
        <button
          type="button"
          aria-label="Fit tree"
          onClick={() => setView(fitView(layout, box.current, false))}
        >
          Fit
        </button>
      </div>
    </div>
  );
}
