import { useEffect, useRef } from "react";
import type Graph from "graphology";
import type { NodeAttrs } from "./graphModel";
import { loadGraphLibs } from "./graphLibs";

// Render a graphology graph with sigma (WebGL), lay it out with ForceAtlas2 (in a web
// worker for large graphs), highlight a hovered node's neighbors, and report clicks.
// Sigma and the layout are loaded on first use: they're large and need WebGL.

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Layout budget: small graphs lay out synchronously; large ones in a worker briefly. */
const SYNC_LIMIT = 400;
const WORKER_MS = 2500;

interface LabelData {
  x: number;
  y: number;
  size: number;
  label?: string | null;
  color?: string;
}

/** Hover/highlight label drawn with theme colors (sigma's default is a white box). */
function themedHoverDrawer(bg: string, fg: string, border: string) {
  return (
    ctx: CanvasRenderingContext2D,
    data: LabelData,
    settings: { labelSize: number; labelFont: string; labelWeight: string },
  ) => {
    const size = settings.labelSize;
    ctx.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
    const label = data.label ?? "";
    const width = label ? ctx.measureText(label).width + 10 : 0;
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
    if (label) {
      ctx.fillStyle = fg;
      ctx.fillText(label, x + 3, data.y + size / 3);
    }
  };
}

/**
 * Lay out `graph` (mutating positions) and render it into `el`. Resolves to a disposer,
 * or null if `cancelled()` became true while the libraries were loading.
 */
async function mountSigma(
  el: HTMLElement,
  graph: Graph<NodeAttrs>,
  onClick: (id: string) => void,
  highlight: string | null,
  cancelled: () => boolean,
): Promise<(() => void) | null> {
  const { Sigma, forceAtlas2, FA2Layout } = await loadGraphLibs();
  // A newer graph replaced this one while loading: don't start a second renderer.
  if (cancelled()) return null;
  const faded = cssVar("--border", "#e3e4e8");
  const edgeColor = cssVar("--fg-muted", "#8d9199");
  const accent = cssVar("--accent", "#4f5bd5");
  let hovered: string | null = null;

  let layout: InstanceType<typeof FA2Layout> | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  if (graph.order > 1) {
    // Strong gravity keeps small graphs (and their orphans) compact.
    const settings = { ...forceAtlas2.inferSettings(graph), strongGravityMode: true, gravity: 0.5 };
    if (graph.order <= SYNC_LIMIT) {
      forceAtlas2.assign(graph, { iterations: 150, settings });
    } else {
      layout = new FA2Layout(graph, { settings });
      layout.start();
      stopTimer = setTimeout(() => layout?.stop(), WORKER_MS);
    }
  }

  // Only hovering fades the rest; the open note is just emphasized.
  const focus = () => hovered;
  const renderer = new Sigma(graph, el, {
    renderEdgeLabels: false,
    labelColor: { color: cssVar("--fg", "#1f2328") },
    // Label everything in small graphs; only prominent nodes in big ones.
    labelRenderedSizeThreshold: graph.order <= 200 ? 0 : 8,
    defaultEdgeColor: edgeColor,
    defaultDrawNodeHover: themedHoverDrawer(
      cssVar("--bg-sidebar", "#f6f6f7"),
      cssVar("--fg", "#1f2328"),
      cssVar("--border", "#e3e4e8"),
    ),
    zIndex: true,
    nodeReducer: (node, data) => {
      const f = focus();
      if (!f || !graph.hasNode(f)) {
        return node === highlight
          ? { ...data, forceLabel: true, highlighted: true, zIndex: 1 }
          : data;
      }
      if (node === f || graph.areNeighbors(node, f))
        return { ...data, zIndex: 1, forceLabel: node === f };
      return { ...data, color: faded, label: "", zIndex: 0 };
    },
    edgeReducer: (edge, data) => {
      const f = focus();
      if (!f || !graph.hasNode(f)) return data;
      return graph.hasExtremity(edge, f)
        ? { ...data, color: accent, size: 1.5 }
        : { ...data, hidden: true };
    },
  });
  renderer.on("clickNode", ({ node }) => onClick(node));
  renderer.on("enterNode", ({ node }) => {
    hovered = node;
    el.style.cursor = "pointer";
    renderer.refresh({ skipIndexation: true });
  });
  renderer.on("leaveNode", () => {
    hovered = null;
    el.style.cursor = "";
    renderer.refresh({ skipIndexation: true });
  });
  // Exposed for end-to-end tests, which can't click WebGL nodes by label.
  (el as HTMLElement & { __sigma?: unknown }).__sigma = renderer;

  return () => {
    if (stopTimer) clearTimeout(stopTimer);
    layout?.kill();
    renderer.kill();
  };
}

export function useSigma(
  container: React.RefObject<HTMLDivElement | null>,
  graph: Graph<NodeAttrs> | null,
  onClickNode: (id: string) => void,
  highlight?: string | null,
) {
  const onClick = useRef(onClickNode);
  const dispose = useRef<(() => void) | null>(null);
  useEffect(() => {
    onClick.current = onClickNode;
  }, [onClickNode]);

  useEffect(() => {
    const el = container.current;
    if (!el || !graph) return;
    let disposed = false;
    mountSigma(
      el,
      graph,
      (id) => onClick.current(id),
      highlight ?? null,
      () => disposed,
    ).then(
      (d) => {
        if (!d) return;
        if (disposed) d();
        else dispose.current = d;
      },
      (e: unknown) => console.warn("graph render failed", e),
    );
    return () => {
      disposed = true;
      dispose.current?.();
      dispose.current = null;
    };
  }, [container, graph, highlight]);
}
