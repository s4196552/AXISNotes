import { type CSSProperties, Suspense, useEffect } from "react";
import { backend } from "./ipc";
import { useAppStore } from "./app/store";
import { useConfig } from "./app/config";
import {
  applyAppearance,
  applyTranslucency,
  applyTypography,
  onBlurAvailabilityChange,
} from "./app/appearance";
import { installZoom } from "./app/zoom";
import { openDailyNote } from "./features/commands/actions";
import { Modals } from "./features/commands/Modals";
import { WelcomeScreen } from "./features/vault/WelcomeScreen";
import { Editor } from "./features/editor";
import { lazyNamed } from "./app/lazy";
import { loadFunctions } from "./lib/formula/functions";
import { ImageView, UnsupportedView } from "./features/files/ImageView";
import { useClipNotices } from "./features/clipper/useClipNotices";
import { UpdateBanner } from "./features/updates/UpdateBanner";
import { checkOnLaunch } from "./features/updates/updates";
import { guardWindowClose } from "./features/files/closeGuard";
import { recentVaults, rememberVault, reopenLast, takeGettingStarted } from "./app/recentVaults";
import { useUi } from "./features/commands/ui";
import { docKind } from "./lib/fileKinds";
import { useLayout } from "./app/layout";

// Views other than the note editor load on first use (grids also need the formula
// function library before they render).
const Grid = lazyNamed(
  () => Promise.all([import("./features/grid/Grid"), loadFunctions()]).then(([m]) => m),
  "Grid",
);
const Canvas = lazyNamed(() => import("./features/canvas/Canvas"), "Canvas");
const GraphView = lazyNamed(() => import("./features/graph/GraphView"), "GraphView");
const TasksView = lazyNamed(() => import("./features/tasks/TasksView"), "TasksView");
const TimeReport = lazyNamed(() => import("./features/time/TimeReport"), "TimeReport");
import { RunningTimer } from "./features/time/TimerControls";
import { useTimer } from "./features/time/timer";
import { LeftSidebar, RightSidebar } from "./features/panels/Sidebars";
import { PanelToggle } from "./features/panels/PanelToggle";
import { usePresence } from "./features/panels/presence";
import { TabBar } from "./features/tabs/TabBar";
import { TAB_PANEL_ID } from "./features/tabs/tabInfo";
import { NewTab } from "./features/tabs/NewTab";

export default function App() {
  const vault = useAppStore((s) => s.vault);
  const activePath = useAppStore((s) => s.activePath);
  const mainView = useAppStore((s) => s.mainView);
  const error = useAppStore((s) => s.error);
  const notice = useAppStore((s) => s.notice);
  const indexing = useAppStore((s) => s.indexing);
  const refreshTree = useAppStore((s) => s.refreshTree);
  const showLeft = useLayout((s) => s.left);
  const showRight = useLayout((s) => s.right);
  const leftWidth = useLayout((s) => s.leftWidth);
  const rightWidth = useLayout((s) => s.rightWidth);
  const rightMounted = usePresence(showRight);
  useClipNotices();

  // Restore a vault the backend already has open (e.g. after a webview reload), or
  // reopen the last one used on this device.
  useEffect(() => {
    void backend.currentVault().then(async (v) => {
      if (v) {
        rememberVault(v);
        useAppStore.setState({ vault: v });
        return;
      }
      const last = recentVaults()[0];
      if (last && reopenLast()) {
        await useAppStore.getState().openVault(last.root);
        // A vault that moved or was deleted: just show the welcome screen.
        if (!useAppStore.getState().vault) useAppStore.setState({ error: null });
      }
    });
  }, []);

  // A vault created just now: show "Getting started" once.
  useEffect(() => {
    if (vault && takeGettingStarted(vault.root)) useUi.getState().open({ kind: "getting-started" });
  }, [vault]);

  // Load vault settings; optionally open today's daily note.
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    useConfig
      .getState()
      .load()
      .then(async () => {
        if (cancelled) return;
        void useTimer.getState().restore();
        if (!useConfig.getState().config.dailyNotes.openOnStartup) return;
        await useAppStore.getState().refreshTree();
        if (!cancelled && !useAppStore.getState().activePath) await openDailyNote();
      });
    return () => {
      cancelled = true;
    };
  }, [vault]);

  const theme = useConfig((s) => s.config.theme);
  const snippets = useConfig((s) => s.config.snippets);
  useEffect(() => {
    void applyAppearance({ theme, snippets });
  }, [theme, snippets]);

  const typography = useConfig((s) => s.config.appearance);
  useEffect(() => applyTypography(typography), [typography]);
  const { windowOpacity, windowBlur } = typography;
  useEffect(() => {
    const apply = () => void applyTranslucency(theme, { windowOpacity, windowBlur });
    apply();
    return onBlurAvailabilityChange(apply);
  }, [theme, windowOpacity, windowBlur]);

  // Zoom applies to the welcome screen too, so it doesn't wait for a vault.
  useEffect(() => installZoom(), []);

  // A newer version in the updates folder is offered by a banner (never installed unasked).
  useEffect(() => void checkOnLaunch(), []);

  // Closing the window saves every open document first, and stays open if one can't be.
  useEffect(() => guardWindowClose(), []);

  // Keep the tree in sync with edits made outside the app.
  useEffect(() => {
    if (!vault) return;
    void refreshTree();
    let unlisten: (() => void) | undefined;
    backend.onVaultChanged(() => void refreshTree()).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [vault, refreshTree]);

  // A big vault opens before its index is complete; show progress, then refresh.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let gone = false;
    void backend
      .onIndexProgress((p) => {
        if (p.finished) {
          useAppStore.setState({ indexing: null });
          useAppStore.getState().bumpIndex();
        } else useAppStore.setState({ indexing: { done: p.done, total: p.total } });
      })
      .then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      unlisten?.();
    };
  }, []);

  if (!vault)
    return (
      <>
        <WelcomeScreen />
        <UpdateBanner />
      </>
    );

  return (
    <div
      className="shell"
      // A hidden panel's column is 0 px rather than removed, so it can slide (see .shell).
      style={
        {
          gridTemplateColumns: `${showLeft ? leftWidth : 0}px minmax(0, 1fr) ${showRight ? rightWidth : 0}px`,
          "--left-width": `${leftWidth}px`,
          "--right-width": `${rightWidth}px`,
        } as CSSProperties
      }
    >
      {/* Kept mounted while hidden, so the file tree and search keep their state. */}
      <div
        className="sidebar-slot left"
        data-closed={showLeft ? undefined : ""}
        aria-hidden={showLeft ? undefined : true}
        inert={!showLeft}
      >
        <LeftSidebar />
      </div>
      <main className={showLeft ? "content" : "content left-hidden"}>
        {/* The left panel's own header holds its hide button; once hidden, it shows here. */}
        {!showLeft && <PanelToggle side="left" className="side-panels-toggle left" />}
        <PanelToggle side="right" className="side-panels-toggle" />
        <TabBar />
        <div className="tab-panel" id={TAB_PANEL_ID} role="tabpanel">
          <Suspense fallback={<div className="empty muted">Loading…</div>}>
            {mainView === "graph" ? (
              <GraphView />
            ) : mainView === "tasks" ? (
              <TasksView />
            ) : mainView === "time" ? (
              <TimeReport />
            ) : activePath && docKind(activePath) === "grid" ? (
              <Grid key={activePath} path={activePath} />
            ) : activePath && docKind(activePath) === "canvas" ? (
              <Canvas key={activePath} path={activePath} />
            ) : activePath && docKind(activePath) === "image" ? (
              <ImageView key={activePath} path={activePath} />
            ) : activePath && docKind(activePath) === "other" ? (
              <UnsupportedView key={activePath} path={activePath} />
            ) : activePath ? (
              <Editor key={activePath} path={activePath} />
            ) : (
              <NewTab />
            )}
          </Suspense>
        </div>
      </main>
      {/* The right side (with its live graph) only runs while showing or sliding away. */}
      {rightMounted && (
        <div
          className="sidebar-slot right"
          data-closed={showRight ? undefined : ""}
          aria-hidden={showRight ? undefined : true}
          inert={!showRight}
        >
          <RightSidebar />
        </div>
      )}
      <Modals />
      <UpdateBanner />
      <footer className="statusbar">
        <span>{activePath ?? ""}</span>
        {indexing && (
          <span className="muted" role="status">
            Indexing notes… {indexing.done.toLocaleString()} of {indexing.total.toLocaleString()}
          </span>
        )}
        {notice && !error && <span className="notice">{notice}</span>}
        <RunningTimer />
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </footer>
    </div>
  );
}
