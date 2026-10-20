import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Crosshair, Maximize, Network, Settings2, Workflow, X } from "lucide-react";
import { backend, type GraphData } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { buildGraph, groupColors } from "./graphModel";
import { useSigma, useThemeVersion } from "./useSigma";
import {
  DEFAULT_DISPLAY,
  RANGES,
  useGraphSettings,
  type GraphMode,
  type TreeDirection,
} from "./graphSettings";
import { GraphSettingsPanel } from "./GraphSettingsPanel";
import { TreeView } from "./TreeView";
import { busiestNote } from "./treeModel";
import "./graph.css";

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

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

/** Theme colours for building graphs, re-read when the theme changes. */
function useGraphColors() {
  const themeVersion = useThemeVersion();
  return useMemo(
    () => ({ accent: cssVar("--accent", "#4f5bd5"), muted: cssVar("--fg-muted", "#8d9199") }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- themeVersion: re-read colors
    [themeVersion],
  );
}

function openNode(id: string) {
  const store = useAppStore.getState();
  if (id.startsWith("?")) void store.openLink(id.slice(1), store.activePath ?? "");
  else store.openFile(id);
}

const MODES: { mode: GraphMode; label: string; Icon: typeof Network }[] = [
  { mode: "graph", label: "Graph", Icon: Network },
  { mode: "tree", label: "Tree", Icon: Workflow },
];

/** The whole-vault graph in the main area: a force graph, or a tree from one note. */
export function GraphView() {
  const data = useGraphData();
  const activePath = useAppStore((s) => s.activePath);
  const setMainView = useAppStore((s) => s.setMainView);
  const [settings, update] = useGraphSettings();
  const [panelOpen, setPanelOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const colors = useGraphColors();
  const icons = useConfig((s) => s.config.folderIcons);
  const isGraph = settings.mode === "graph";

  const graph = useMemo(
    () =>
      data && isGraph
        ? buildGraph(
            data,
            {
              query: settings.query,
              showOrphans: settings.showOrphans,
              showUnresolved: settings.showUnresolved,
            },
            colors,
          )
        : null,
    [data, isGraph, settings.query, settings.showOrphans, settings.showUnresolved, colors],
  );
  const groups = useMemo(
    () => (graph ? groupColors(graph, settings.groups) : new Map<string, string>()),
    [graph, settings.groups],
  );
  const open = useCallback(
    (id: string) => {
      openNode(id);
      setMainView("note");
    },
    [setMainView],
  );
  const { animate, fit } = useSigma(container, graph, open, activePath, {
    // Wide enough that labels at the right edge aren't cut off.
    padding: 72,
    display: settings.display,
    forces: settings.forces,
    groupColors: groups,
    icons,
  });

  // Tree: the chosen root, else the open note, else the busiest note.
  const [chosenRoot, setChosenRoot] = useState<string | null>(null);
  const [treeCount, setTreeCount] = useState<{ count: number; truncated: boolean } | null>(null);
  const root = useMemo(() => {
    if (!data) return null;
    const resolved = (id: string | null) =>
      id !== null && data.nodes.some((n) => n.id === id && !n.unresolved);
    if (resolved(chosenRoot)) return chosenRoot;
    if (resolved(activePath)) return activePath;
    return busiestNote(data);
  }, [data, chosenRoot, activePath]);
  const onTreeCount = useCallback(
    (count: number, truncated: boolean) => setTreeCount({ count, truncated }),
    [],
  );

  let count = "Loading…";
  if (isGraph && graph) count = `${plural(graph.order, "note")} · ${plural(graph.size, "link")}`;
  else if (!isGraph && data && treeCount)
    count = treeCount.truncated
      ? `First ${plural(treeCount.count, "item")}`
      : plural(treeCount.count, settings.tree.direction === "folders" ? "item" : "note");

  return (
    <div className="graph-view">
      <header className="graph-toolbar">
        <strong>Graph</strong>
        <div className="graph-modes" role="radiogroup" aria-label="Layout">
          {MODES.map(({ mode, label, Icon }) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={settings.mode === mode}
              onClick={() => update((s) => ({ ...s, mode }))}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        {isGraph ? (
          <input
            type="search"
            aria-label="Filter graph"
            placeholder="Filter: text, tag:x, path:x"
            value={settings.query}
            onChange={(e) => {
              const query = e.target.value;
              update((s) => ({ ...s, query }));
            }}
          />
        ) : (
          <TreeControls
            data={data}
            root={root}
            direction={settings.tree.direction}
            depth={settings.tree.depth}
            showUnresolved={settings.showUnresolved}
            showIcons={settings.display.icons}
            activePath={activePath}
            onRoot={setChosenRoot}
            onDirection={(direction) => update((s) => ({ ...s, tree: { ...s.tree, direction } }))}
            onDepth={(depth) => update((s) => ({ ...s, tree: { ...s.tree, depth } }))}
            onUnresolved={(v) => update((s) => ({ ...s, showUnresolved: v }))}
            onIcons={(v) => update((s) => ({ ...s, display: { ...s.display, icons: v } }))}
          />
        )}
        <span className="graph-count muted" aria-live="polite">
          {count}
        </span>
        <div className="graph-actions">
          {isGraph ? (
            <button type="button" aria-label="Fit graph" title="Fit graph to view" onClick={fit}>
              <Maximize size={16} />
            </button>
          ) : null}
          {isGraph ? (
            <button
              type="button"
              aria-label="Graph settings"
              aria-pressed={panelOpen}
              title="Graph settings"
              onClick={() => setPanelOpen((v) => !v)}
            >
              <Settings2 size={16} />
            </button>
          ) : null}
          <button
            className="graph-close"
            aria-label="Close graph"
            onClick={() => setMainView("note")}
          >
            <X size={16} />
          </button>
        </div>
      </header>
      {isGraph ? (
        <div className="graph-stage">
          <div className="graph-canvas" ref={container} data-testid="graph-canvas" />
          {panelOpen ? (
            <GraphSettingsPanel
              settings={settings}
              update={update}
              onAnimate={animate}
              onClose={() => setPanelOpen(false)}
            />
          ) : null}
        </div>
      ) : data ? (
        <TreeView
          data={data}
          direction={settings.tree.direction}
          depth={settings.tree.depth}
          showUnresolved={settings.showUnresolved}
          root={root}
          activePath={activePath}
          colors={colors}
          icons={settings.display.icons ? icons : null}
          onOpen={open}
          onMakeRoot={setChosenRoot}
          onCount={onTreeCount}
        />
      ) : (
        <div className="tree-view tree-empty muted">Loading…</div>
      )}
    </div>
  );
}

const DIRECTIONS: { value: TreeDirection; label: string }[] = [
  { value: "links", label: "Links" },
  { value: "backlinks", label: "Backlinks" },
  { value: "folders", label: "Folders" },
];

/** Root, direction, depth and unresolved links for the tree. */
function TreeControls(props: {
  data: GraphData | null;
  root: string | null;
  direction: TreeDirection;
  depth: number;
  showUnresolved: boolean;
  showIcons: boolean;
  activePath: string | null;
  onRoot(id: string | null): void;
  onDirection(d: TreeDirection): void;
  onDepth(d: number): void;
  onUnresolved(v: boolean): void;
  onIcons(v: boolean): void;
}) {
  const listId = useId();
  const notes = useMemo(() => (props.data?.nodes ?? []).filter((n) => !n.unresolved), [props.data]);
  // The field shows the root until the user types. Choosing a suggestion (a full path)
  // picks it at once; a typed name is picked on Enter or when leaving the field.
  const [draft, setDraft] = useState<string | null>(null);
  const find = (text: string, byName: boolean) => {
    const t = text.trim().toLowerCase();
    return (
      notes.find((n) => n.id.toLowerCase() === t) ??
      (byName ? notes.find((n) => n.name.toLowerCase() === t) : undefined)
    );
  };
  const commit = (text: string, byName: boolean) => {
    const hit = find(text, byName);
    if (hit) props.onRoot(hit.id);
    return hit;
  };
  const folders = props.direction === "folders";
  const [, maxDepth] = RANGES.depth;
  return (
    <div className="tree-controls">
      {folders ? null : (
        <>
          <input
            type="search"
            className="tree-root"
            aria-label="Tree root"
            placeholder="Root note"
            list={listId}
            value={draft ?? props.root ?? ""}
            onChange={(e) => {
              if (commit(e.target.value, false)) setDraft(null);
              else setDraft(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft !== null && commit(draft, true)) setDraft(null);
              if (e.key === "Escape") setDraft(null);
            }}
            onBlur={() => {
              if (draft !== null) commit(draft, true);
              setDraft(null);
            }}
          />
          <datalist id={listId}>
            {notes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </datalist>
          <button
            type="button"
            aria-label="Root on the open note"
            title="Root on the open note"
            disabled={!props.activePath}
            onClick={() => props.onRoot(props.activePath)}
          >
            <Crosshair size={14} />
          </button>
        </>
      )}
      <select
        aria-label="Tree follows"
        value={props.direction}
        onChange={(e) => props.onDirection(e.target.value as TreeDirection)}
      >
        {DIRECTIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Tree depth"
        value={props.depth}
        onChange={(e) => props.onDepth(Number(e.target.value))}
      >
        {Array.from({ length: maxDepth }, (_, i) => i + 1).map((d) => (
          <option key={d} value={d}>
            {d} {d === 1 ? "level" : "levels"}
          </option>
        ))}
      </select>
      {folders ? null : (
        <label>
          <input
            type="checkbox"
            checked={props.showUnresolved}
            onChange={(e) => props.onUnresolved(e.target.checked)}
          />
          Unresolved
        </label>
      )}
      <label>
        <input
          type="checkbox"
          checked={props.showIcons}
          onChange={(e) => props.onIcons(e.target.checked)}
        />
        Icons
      </label>
    </div>
  );
}

/** Neighborhood of the open note, in the right sidebar. */
export function LocalGraph() {
  const data = useGraphData();
  const activePath = useAppStore((s) => s.activePath);
  const [depth, setDepth] = useState(1);
  const container = useRef<HTMLDivElement>(null);
  const colors = useGraphColors();
  const icons = useConfig((s) => s.config.folderIcons);
  // Icons follow the graph's setting (as it was when this panel opened).
  const [{ display: shown }] = useGraphSettings();
  const display = useMemo(() => ({ ...DEFAULT_DISPLAY, icons: shown.icons }), [shown.icons]);
  const graph = useMemo(
    () =>
      data && activePath
        ? buildGraph(
            data,
            { query: "", showOrphans: true, showUnresolved: false, center: activePath, depth },
            colors,
          )
        : null,
    [data, activePath, depth, colors],
  );
  useSigma(container, graph, openNode, activePath, { display, icons });

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
        <span className="graph-count muted">{graph ? plural(graph.order, "note") : ""}</span>
      </header>
      <div className="local-graph-canvas" ref={container} data-testid="local-graph-canvas" />
    </section>
  );
}
