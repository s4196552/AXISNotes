import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { backend, type GraphData } from "../../ipc";
import { useAppStore } from "../../app/store";
import { buildGraph } from "./graphModel";
import { useSigma } from "./useSigma";
import "./graph.css";

const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

/** Fetch graph data, refreshing when the index changes. */
function useGraphData(): GraphData | null {
  const indexVersion = useAppStore((s) => s.indexVersion);
  const [data, setData] = useState<GraphData | null>(null);
  useEffect(() => {
    let cancelled = false;
    backend.graph().then(
      (d) => !cancelled && setData(d),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [indexVersion]);
  return data;
}

function openNode(id: string) {
  const store = useAppStore.getState();
  if (id.startsWith("?")) void store.openLink(id.slice(1), store.activePath ?? "");
  else store.openFile(id);
}

/** The whole-vault graph in the main area. */
export function GraphView() {
  const data = useGraphData();
  const activePath = useAppStore((s) => s.activePath);
  const setMainView = useAppStore((s) => s.setMainView);
  const [query, setQuery] = useState("");
  const [showOrphans, setShowOrphans] = useState(true);
  const [showUnresolved, setShowUnresolved] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  const graph = useMemo(
    () =>
      data
        ? buildGraph(
            data,
            { query, showOrphans, showUnresolved },
            { accent: cssVar("--accent", "#4f5bd5"), muted: cssVar("--fg-muted", "#8d9199") },
          )
        : null,
    [data, query, showOrphans, showUnresolved],
  );
  useSigma(
    container,
    graph,
    (id) => {
      openNode(id);
      setMainView("note");
    },
    activePath,
  );

  return (
    <div className="graph-view">
      <header className="graph-toolbar">
        <strong>Graph</strong>
        <input
          type="search"
          aria-label="Filter graph"
          placeholder="Filter: text, tag:x, path:x"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setShowOrphans(e.target.checked)}
          />
          Orphans
        </label>
        <label>
          <input
            type="checkbox"
            checked={showUnresolved}
            onChange={(e) => setShowUnresolved(e.target.checked)}
          />
          Unresolved
        </label>
        <span className="graph-count muted" aria-live="polite">
          {graph ? `${graph.order} notes · ${graph.size} links` : "Loading…"}
        </span>
        <button
          className="graph-close"
          aria-label="Close graph"
          onClick={() => setMainView("note")}
        >
          <X size={16} />
        </button>
      </header>
      <div className="graph-canvas" ref={container} data-testid="graph-canvas" />
    </div>
  );
}

/** Neighborhood of the open note, in the right sidebar. */
export function LocalGraph() {
  const data = useGraphData();
  const activePath = useAppStore((s) => s.activePath);
  const [depth, setDepth] = useState(1);
  const container = useRef<HTMLDivElement>(null);
  const graph = useMemo(
    () =>
      data && activePath
        ? buildGraph(
            data,
            { query: "", showOrphans: true, showUnresolved: false, center: activePath, depth },
            { accent: cssVar("--accent", "#4f5bd5"), muted: cssVar("--fg-muted", "#8d9199") },
          )
        : null,
    [data, activePath, depth],
  );
  useSigma(container, graph, openNode, activePath);

  if (!activePath) return null;
  return (
    <section className="local-graph" aria-label="Local graph">
      <header className="local-graph-header">
        <span>Local graph</span>
        <select
          aria-label="Link depth"
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
        >
          <option value={1}>1 link</option>
          <option value={2}>2 links</option>
          <option value={3}>3 links</option>
        </select>
        <span className="graph-count muted">{graph ? `${graph.order} notes` : ""}</span>
      </header>
      <div className="local-graph-canvas" ref={container} data-testid="local-graph-canvas" />
    </section>
  );
}
