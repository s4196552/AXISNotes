import { useCallback, useEffect, useRef, useState } from "react";
import { onThemeChange } from "../../app/appearance";
import type { FolderIcon } from "../../app/config";
import type Graph from "graphology";
import type { NodeAttrs } from "./graphModel";
import { loadGraphLibs } from "./graphLibs";
import {
  applyForces,
  createSimulation,
  preTick,
  type GraphSimulation,
  type SimNode,
} from "./forces";
import {
  DEFAULT_DISPLAY,
  DEFAULT_FORCES,
  type DisplaySettings,
  type ForceSettings,
} from "./graphSettings";
import { createIconPainter, nodeIcon, type IconPainter, type NodeIcon } from "./nodeIcons";

// Render a graphology graph with sigma (WebGL) and move it with a live force simulation,
// like Obsidian: nodes can be dragged (their neighbours follow), hovering highlights a
// node's neighbours, and clicks are reported. Display settings and colour groups apply
// without moving anything; force changes reheat the simulation. Labels can show each
// note's icon. Sigma and d3-force are loaded on first use.

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Synchronous layout before the first frame, so the graph doesn't open as a cloud. */
const PRETICK_MS = 120;

interface LabelData {
  key?: string;
  x: number;
  y: number;
  size: number;
  label?: string | null;
  color?: string;
}

interface LabelSettings {
  labelSize: number;
  labelFont: string;
  labelWeight: string;
}

/** A node's icon on its label, if icons are shown. */
type IconFor = (key: string | undefined) => NodeIcon | null;

/** Icons are a little taller than the label text. */
const iconSize = (labelSize: number) => labelSize + 2;

/** Labels in the theme colour, after the node's icon when it has one. */
function iconLabelDrawer(fg: string, iconFor: IconFor, painter: IconPainter) {
  return (ctx: CanvasRenderingContext2D, data: LabelData, settings: LabelSettings) => {
    if (!data.label) return;
    const size = settings.labelSize;
    let x = data.x + data.size + 3;
    const icon = iconFor(data.key);
    if (icon) {
      const s = iconSize(size);
      painter.draw(ctx, icon, x, data.y - s / 2, s);
      x += s + 3;
    }
    ctx.fillStyle = fg;
    ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
    ctx.fillText(data.label, x, data.y + size / 3);
  };
}

/** Hover/highlight label drawn with theme colors (sigma's default is a white box). */
function themedHoverDrawer(
  bg: string,
  fg: string,
  border: string,
  iconFor: IconFor,
  painter: IconPainter,
) {
  return (ctx: CanvasRenderingContext2D, data: LabelData, settings: LabelSettings) => {
    const size = settings.labelSize;
    ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
    const label = data.label ?? "";
    const icon = label ? iconFor(data.key) : null;
    const room = icon ? iconSize(size) + 3 : 0;
    const width = label ? ctx.measureText(label).width + 10 + room : 0;
    const h = size + 8;
    const x = data.x + data.size + 4;
    const y = data.y - h / 2;
    ctx.fillStyle = bg;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x - 2, y, width, h, 4);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2);
    ctx.strokeStyle = data.color ?? fg;
    ctx.lineWidth = 2;
    ctx.stroke();
    if (icon) {
      const s = iconSize(size);
      painter.draw(ctx, icon, x + 3, data.y - s / 2, s);
    }
    if (label) {
      ctx.fillStyle = fg;
      ctx.fillText(label, x + 3 + room, data.y + size / 3);
    }
  };
}

/** What the view can change on a mounted graph without re-creating it. */
export interface SigmaLook {
  display: DisplaySettings;
  /** Colour overrides from the colour groups. */
  groupColors: Map<string, string>;
  /** The open note: emphasized and always labelled. */
  highlight: string | null;
  /** Custom icons by path, shown on labels when `display.icons` is on. */
  icons: Readonly<Record<string, FolderIcon>>;
}

interface Mounted {
  dispose(): void;
  refresh(): void;
  setForces(f: ForceSettings): void;
  /** Scatter the nodes and lay the graph out again, visibly. */
  animate(): void;
  /** Frame every node again, after the user panned or zoomed away. */
  fit(): void;
}

/**
 * Render `graph` into `el` and start its simulation. Positions in `positions` (from an
 * earlier mount) are reused, and kept up to date. Resolves to null if `cancelled()`
 * became true while the libraries were loading.
 */
async function mountSigma(
  el: HTMLElement,
  graph: Graph<NodeAttrs>,
  onClick: (id: string) => void,
  look: () => SigmaLook,
  forces: ForceSettings,
  positions: Map<string, { x: number; y: number }>,
  cancelled: () => boolean,
  padding: number,
): Promise<Mounted | null> {
  const { Sigma, d3 } = await loadGraphLibs();
  // A newer graph replaced this one while loading: don't start a second renderer.
  if (cancelled()) return null;
  const faded = cssVar("--border", "#e3e4e8");
  const edgeColor = cssVar("--fg-muted", "#8d9199");
  const accent = cssVar("--accent", "#4f5bd5");
  const fg = cssVar("--fg", "#1f2328");
  // Redraws once an icon image has loaded (`renderer` exists by then).
  const painter = createIconPainter(edgeColor, () => renderer.refresh({ skipIndexation: true }));
  const iconFor: IconFor = (key) => {
    const { display, icons } = look();
    if (!display.icons || key === undefined || !graph.hasNode(key)) return null;
    return nodeIcon(key, icons, { unresolved: graph.getNodeAttribute(key, "unresolved") });
  };
  let hovered: string | null = null;
  let dragged: SimNode | null = null;

  // Simulation nodes start where they were last time, or at the graph's seeded spot.
  const nodes: SimNode[] = graph.mapNodes((id, a) => {
    const p = positions.get(id);
    return { id, x: p?.x ?? a.x, y: p?.y ?? a.y };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const known = nodes.filter((n) => positions.has(n.id)).length;
  const sim: GraphSimulation = createSimulation(
    d3,
    nodes,
    graph.mapEdges((_e, _a, source, target) => ({ source, target })),
    forces,
  );
  const sync = () => {
    graph.updateEachNodeAttributes(
      (id, a) => {
        const n = byId.get(id)!;
        a.x = n.x ?? a.x;
        a.y = n.y ?? a.y;
        positions.set(id, { x: a.x, y: a.y });
        return a;
      },
      { attributes: ["x", "y"] },
    );
  };
  if (!nodes.length) {
    sim.alpha(0);
  } else if (known === nodes.length) {
    // Same notes as before (a filter or theme change): settle gently in place.
    sim.alpha(0.05);
  } else {
    if (known > 0) sim.alpha(0.5);
    preTick(sim, PRETICK_MS);
  }
  sync();

  // Only hovering fades the rest; the open note is just emphasized.
  const renderer = new Sigma(graph, el, {
    // A hidden or minimized window can mount the view at zero size; the resize observer
    // below draws it once it has room.
    allowInvalidContainer: true,
    // Room around the outermost nodes, so their labels (drawn to the right) aren't cut off.
    stagePadding: padding,
    renderEdgeLabels: false,
    labelColor: { color: fg },
    labelRenderedSizeThreshold: look().display.textFade,
    defaultEdgeColor: edgeColor,
    defaultDrawNodeLabel: iconLabelDrawer(fg, iconFor, painter),
    defaultDrawNodeHover: themedHoverDrawer(
      cssVar("--bg-sidebar", "#f6f6f7"),
      fg,
      cssVar("--border", "#e3e4e8"),
      iconFor,
      painter,
    ),
    zIndex: true,
    nodeReducer: (node, data) => {
      const { display, groupColors, highlight } = look();
      const base = {
        ...data,
        size: data.size * display.nodeSize,
        color: groupColors.get(node) ?? data.color,
      };
      const f = hovered;
      if (!f || !graph.hasNode(f)) {
        return node === highlight
          ? { ...base, forceLabel: true, highlighted: true, zIndex: 1 }
          : base;
      }
      if (node === f || graph.areNeighbors(node, f))
        return { ...base, zIndex: 1, forceLabel: node === f };
      return { ...base, color: faded, label: "", zIndex: 0 };
    },
    edgeReducer: (edge, data) => {
      const { display } = look();
      const base = {
        ...data,
        size: display.linkThickness,
        type: display.arrows ? "arrow" : "line",
      };
      const f = hovered;
      if (!f || !graph.hasNode(f)) return base;
      return graph.hasExtremity(edge, f)
        ? { ...base, color: accent, size: display.linkThickness + 0.5 }
        : { ...base, hidden: true };
    },
  });

  // Keep the graph fitted while it settles, until the user moves or zooms it: from then
  // on the frame stays put, so a dragged node stays under the pointer.
  let frozen = false;
  const freeze = () => {
    if (frozen || graph.order === 0) return;
    frozen = true;
    renderer.setCustomBBox(renderer.getBBox());
  };
  sim.on("tick", sync);
  sim.on("end", freeze);
  sim.restart();

  renderer.on("clickNode", ({ node }) => onClick(node));
  renderer.on("enterNode", ({ node }) => {
    hovered = node;
    el.style.cursor = "pointer";
    renderer.refresh({ skipIndexation: true });
  });
  renderer.on("leaveNode", () => {
    hovered = null;
    if (!dragged) el.style.cursor = "";
    renderer.refresh({ skipIndexation: true });
  });

  // Dragging: pin the node to the pointer and keep the simulation warm so its
  // neighbours follow; on release it's free again and everything settles.
  renderer.on("downNode", ({ node, event }) => {
    const n = byId.get(node);
    if (!n) return;
    freeze();
    dragged = n;
    n.fx = n.x;
    n.fy = n.y;
    sim.alphaTarget(0.3).restart();
    event.preventSigmaDefault();
  });
  renderer.on("moveBody", ({ event }) => {
    if (!dragged) return;
    const p = renderer.viewportToGraph(event);
    dragged.fx = p.x;
    dragged.fy = p.y;
    el.style.cursor = "grabbing";
    event.preventSigmaDefault();
    event.original.preventDefault();
    event.original.stopPropagation();
  });
  const release = () => {
    if (!dragged) return;
    dragged.fx = null;
    dragged.fy = null;
    dragged = null;
    el.style.cursor = hovered ? "pointer" : "";
    sim.alphaTarget(0);
  };
  renderer.on("upNode", release);
  renderer.on("upStage", release);
  renderer.on("downStage", freeze);
  renderer.on("wheelStage", freeze);

  // Exposed for end-to-end tests, which can't click WebGL nodes by label.
  (el as HTMLElement & { __sigma?: unknown }).__sigma = renderer;

  // The container also changes size without a window resize, e.g. when the side panels
  // are hidden or shown, so redraw to fit it (once per frame at most).
  let frame = 0;
  const observer =
    typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => {
            renderer.resize(true);
            renderer.refresh({ skipIndexation: true });
          });
        });
  observer?.observe(el);

  return {
    dispose() {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      painter.dispose();
      sim.stop();
      sim.on("tick", null).on("end", null);
      renderer.kill();
    },
    refresh() {
      renderer.setSetting("labelRenderedSizeThreshold", look().display.textFade);
      renderer.refresh({ skipIndexation: true });
    },
    setForces(f) {
      applyForces(d3, sim, f, nodes.length);
      sim.alpha(Math.max(sim.alpha(), 0.3)).restart();
    },
    animate() {
      // Scatter around the middle and let the forces pull it together again, refitting.
      const spread = Math.sqrt(nodes.length) * 20;
      for (const n of nodes) {
        n.x = (Math.random() - 0.5) * spread;
        n.y = (Math.random() - 0.5) * spread;
        n.vx = n.vy = 0;
      }
      frozen = false;
      renderer.setCustomBBox(null);
      renderer.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
      sim.alpha(1).restart();
    },
    fit() {
      // Measure the nodes where they are now, frame them, and keep that frame for drags.
      renderer.setCustomBBox(null);
      renderer.refresh();
      if (frozen) renderer.setCustomBBox(renderer.getBBox());
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      void renderer.getCamera().animatedReset({ duration: reduce ? 0 : 250 });
    },
  };
}

/**
 * A number that changes whenever the theme does. Graph colors are read from the theme
 * when a graph is built and when sigma mounts, so callers rebuild the graph on it.
 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => onThemeChange(() => setVersion((v) => v + 1)), []);
  return version;
}

export interface SigmaOptions {
  display?: DisplaySettings;
  /** Custom icons by path (the vault's `folderIcons`). */
  icons?: Readonly<Record<string, FolderIcon>>;
  forces?: ForceSettings;
  groupColors?: Map<string, string>;
  /** Pixels kept clear around the graph (sigma's default is 30). */
  padding?: number;
}

const NO_GROUPS = new Map<string, string>();
const NO_ICONS: Readonly<Record<string, FolderIcon>> = {};

/** Render `graph` into `container`. Returns `animate`, which lays it out again. */
export function useSigma(
  container: React.RefObject<HTMLDivElement | null>,
  graph: Graph<NodeAttrs> | null,
  onClickNode: (id: string) => void,
  highlight?: string | null,
  options: SigmaOptions = {},
): { animate: () => void; fit: () => void } {
  const onClick = useRef(onClickNode);
  const mounted = useRef<Mounted | null>(null);
  // Where each note was drawn, so a rebuilt graph (filter, theme) doesn't jump around.
  const positions = useRef(new Map<string, { x: number; y: number }>());
  const look = useRef<SigmaLook>({
    display: DEFAULT_DISPLAY,
    groupColors: NO_GROUPS,
    highlight: null,
    icons: NO_ICONS,
  });
  const forces = options.forces ?? DEFAULT_FORCES;
  const forcesRef = useRef(forces);
  const display = options.display ?? DEFAULT_DISPLAY;
  const groupColors = options.groupColors ?? NO_GROUPS;
  const icons = options.icons ?? NO_ICONS;
  const padding = useRef(options.padding ?? 30);

  useEffect(() => {
    onClick.current = onClickNode;
  }, [onClickNode]);

  useEffect(() => {
    look.current = { display, groupColors, highlight: highlight ?? null, icons };
    mounted.current?.refresh();
  }, [display, groupColors, highlight, icons]);

  useEffect(() => {
    if (forcesRef.current === forces) return;
    forcesRef.current = forces;
    mounted.current?.setForces(forces);
  }, [forces]);

  useEffect(() => {
    const el = container.current;
    if (!el || !graph) return;
    let disposed = false;
    mountSigma(
      el,
      graph,
      (id) => onClick.current(id),
      () => look.current,
      forcesRef.current,
      positions.current,
      () => disposed,
      padding.current,
    ).then(
      (m) => {
        if (!m) return;
        if (disposed) m.dispose();
        else mounted.current = m;
      },
      (e: unknown) => console.warn("graph render failed", e),
    );
    return () => {
      disposed = true;
      mounted.current?.dispose();
      mounted.current = null;
    };
  }, [container, graph]);

  const animate = useCallback(() => mounted.current?.animate(), []);
  const fit = useCallback(() => mounted.current?.fit(), []);
  return { animate, fit };
}
