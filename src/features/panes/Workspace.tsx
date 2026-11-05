import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  Suspense,
  useRef,
} from "react";
import { useAppStore } from "../../app/store";
import { useAreaZoomProps } from "../../app/zoom";
import { lazyNamed } from "../../app/lazy";
import { PaneContext } from "../../app/paneContext";
import { type DividerBox, dragDivider, layout, type PaneBox } from "../../app/panes";
import { activeTab } from "../../app/tabs";
import { loadFunctions } from "../../lib/formula/functions";
import { docKind } from "../../lib/fileKinds";
import { Editor } from "../editor";
import { ImageView, UnsupportedView } from "../files/ImageView";
import { TabBar } from "../tabs/TabBar";
import { TAB_PANEL_ID } from "../tabs/tabInfo";
import { NewTab } from "../tabs/NewTab";
import { useTabDrop } from "../tabs/tabDrop";
import "./panes.css";

// Views other than the note editor load on first use (grids also need the formula
// function library before they render).
const Grid = lazyNamed(
  () => Promise.all([import("../grid/Grid"), loadFunctions()]).then(([m]) => m),
  "Grid",
);
const Canvas = lazyNamed(() => import("../canvas/Canvas"), "Canvas");
const GraphView = lazyNamed(() => import("../graph/GraphView"), "GraphView");
const TasksView = lazyNamed(() => import("../tasks/TasksView"), "TasksView");
const TimeReport = lazyNamed(() => import("../time/TimeReport"), "TimeReport");
const Dashboard = lazyNamed(() => import("../dashboard/Dashboard"), "Dashboard");

const pct = (x: number) => `${x * 100}%`;

/**
 * The main area: the split panes, each with its tab row and its active tab's view. Every
 * pane is placed by its share of the area, so splitting or closing one never remounts the
 * others (their notes keep their cursor and unsaved state).
 */
export function Workspace() {
  const root = useAppStore((s) => s.panes.root);
  const area = useRef<HTMLDivElement>(null);
  const { panes, dividers } = layout(root);
  const single = panes.length === 1;
  return (
    <div ref={area} className={single ? "workspace single" : "workspace"}>
      {panes.map((p) => (
        <Pane key={p.id} box={p} single={single} />
      ))}
      {dividers.map((d) => (
        <Divider key={`${d.split}:${d.index}`} divider={d} area={area} />
      ))}
    </div>
  );
}

function Pane({ box, single }: { box: PaneBox; single: boolean }) {
  const { id, rect, edges } = box;
  const focused = useAppStore((s) => s.panes.focused === id);
  const tabs = useAppStore((s) => (s.panes.focused === id ? s.tabs : s.panes.tabs[id]));
  const zone = useTabDrop((s) =>
    s.target?.kind === "split" && s.target.pane === id ? s.target.zone : null,
  );
  // The focused pane shows the store's `activePath` and `mainView` (which older callers set
  // directly); the others their own active tab. One element either way, so focusing a pane
  // never remounts its view.
  const focusedPath = useAppStore((s) => s.activePath);
  const focusedView = useAppStore((s) => s.mainView);
  const zoomProps = useAreaZoomProps("main");
  if (!tabs) return null;
  const tab = activeTab(tabs);
  const view = focused ? focusedView : tab.view;
  const path = focused ? focusedPath : tab.view === "dashboard" ? null : tab.path;
  const focus = () => {
    if (!focused) useAppStore.getState().focusPane(id);
  };
  const panelId = focused ? TAB_PANEL_ID : `${TAB_PANEL_ID}-${id}`;
  return (
    <section
      className={["pane", focused && !single && "focused"].filter(Boolean).join(" ")}
      data-pane-id={id}
      data-edge-top={edges.top || undefined}
      data-edge-left={edges.left || undefined}
      data-edge-right={edges.right || undefined}
      data-edge-bottom={edges.bottom || undefined}
      aria-label={single ? undefined : "Pane"}
      style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.w), height: pct(rect.h) }}
      // Pressing or tabbing into a pane makes it the one tab actions and links open into,
      // before whatever the press does there.
      onPointerDownCapture={focus}
      onFocusCapture={focus}
    >
      <TabBar paneId={id} tabs={tabs} focused={focused} titleBar={edges.top} />
      <div className="tab-panel" id={panelId} role="tabpanel" {...zoomProps}>
        <PaneContext.Provider value={{ id, focused }}>
          <Suspense fallback={<div className="empty muted">Loading…</div>}>
            <View view={view} path={path} tabPath={tab.path} />
          </Suspense>
        </PaneContext.Provider>
        {zone && <div className={`pane-drop-zone ${zone}`} aria-hidden />}
      </div>
    </section>
  );
}

function View({
  view,
  path,
  tabPath,
}: {
  view: string;
  /** The note shown, if any. */
  path: string | null;
  /** The tab's own path (a dashboard's folder). */
  tabPath: string | null;
}) {
  if (view === "graph") return <GraphView />;
  if (view === "tasks") return <TasksView />;
  if (view === "time") return <TimeReport />;
  if (view === "dashboard") return <Dashboard key={tabPath ?? ""} folder={tabPath ?? ""} />;
  if (!path) return <NewTab />;
  const kind = docKind(path);
  if (kind === "grid") return <Grid key={path} path={path} />;
  if (kind === "canvas") return <Canvas key={path} path={path} />;
  if (kind === "image" || kind === "media") return <ImageView key={path} path={path} />;
  if (kind === "other") return <UnsupportedView key={path} path={path} />;
  return <Editor key={path} path={path} />;
}

/** The line between two panes; dragging it resizes them. */
function Divider({
  divider: d,
  area,
}: {
  divider: DividerBox;
  area: React.RefObject<HTMLDivElement | null>;
}) {
  const row = d.dir === "row";
  const style: CSSProperties = row
    ? { left: pct(d.at), top: pct(d.box.y), height: pct(d.box.h) }
    : { top: pct(d.at), left: pct(d.box.x), width: pct(d.box.w) };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !area.current) return;
    e.preventDefault();
    const r = area.current.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      // The pointer's place along the split, as a share of the split's own length.
      const along = row
        ? ((ev.clientX - r.left) / r.width - d.box.x) / d.box.w
        : ((ev.clientY - r.top) / r.height - d.box.y) / d.box.h;
      // Read the sizes fresh: earlier moves of this drag have changed them.
      const split = findSplit(useAppStore.getState().panes.root, d.split);
      if (!split) return;
      useAppStore.getState().resizeSplit(d.split, dragDivider(split.sizes, d.index, along));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.classList.remove("pane-resizing", row ? "row" : "column");
    };
    document.body.classList.add("pane-resizing", row ? "row" : "column");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  return (
    <div
      className={`pane-divider ${d.dir}`}
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-label="Resize panes"
      style={style}
      onPointerDown={onPointerDown}
      // Double-click shares the space equally again.
      onDoubleClick={() => {
        const split = findSplit(useAppStore.getState().panes.root, d.split);
        if (split) {
          const n = split.sizes.length;
          useAppStore.getState().resizeSplit(d.split, Array<number>(n).fill(1 / n));
        }
      }}
    />
  );
}

function findSplit(
  node: ReturnType<typeof useAppStore.getState>["panes"]["root"],
  id: string,
): { sizes: number[] } | null {
  if (node.kind === "pane") return null;
  if (node.id === id) return node;
  for (const c of node.children) {
    const f = findSplit(c, id);
    if (f) return f;
  }
  return null;
}
