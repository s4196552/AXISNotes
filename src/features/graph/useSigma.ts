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
  const accent = cssVar("--accent", "#4f5bd5");
  let hovered: string | null = null;

  let layout: InstanceType<typeof FA2Layout> | null = null;
  let stopTimer: ReturnType<typeof setTimeout> | null = null;
  if (graph.order > 1) {
    const settings = forceAtlas2.inferSettings(graph);
    if (graph.order <= SYNC_LIMIT) {
      forceAtlas2.assign(graph, { iterations: 150, settings });
    } else {
      layout = new FA2Layout(graph, { settings });
      layout.start();
      stopTimer = setTimeout(() => layout?.stop(), WORKER_MS);
    }
  }

  const focus = () => hovered ?? highlight;
  const renderer = new Sigma(graph, el, {
    renderEdgeLabels: false,
    labelColor: { color: cssVar("--fg", "#1f2328") },
    labelRenderedSizeThreshold: 7,
    defaultEdgeColor: faded,
    zIndex: true,
    nodeReducer: (node, data) => {
      const f = focus();
      if (!f || !graph.hasNode(f)) return data;
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
