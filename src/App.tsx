import { useEffect } from "react";
import { backend } from "./ipc";
import { useAppStore } from "./app/store";
import { useConfig } from "./app/config";
import { applyAppearance } from "./app/appearance";
import { openDailyNote } from "./features/commands/actions";
import { Modals } from "./features/commands/Modals";
import { WelcomeScreen } from "./features/vault/WelcomeScreen";
import { Editor } from "./features/editor";
import { Grid } from "./features/grid/Grid";
import { Canvas } from "./features/canvas/Canvas";
import { ImageView, UnsupportedView } from "./features/files/ImageView";
import { useClipNotices } from "./features/clipper/useClipNotices";
import { recentVaults, rememberVault, reopenLast, takeGettingStarted } from "./app/recentVaults";
import { useUi } from "./features/commands/ui";
import { docKind } from "./lib/fileKinds";
import { GraphView } from "./features/graph/GraphView";
import { TasksView } from "./features/tasks/TasksView";
import { TimeReport } from "./features/time/TimeReport";
import { RunningTimer } from "./features/time/TimerControls";
import { useTimer } from "./features/time/timer";
import { LeftSidebar, RightSidebar } from "./features/panels/Sidebars";

export default function App() {
  const vault = useAppStore((s) => s.vault);
  const activePath = useAppStore((s) => s.activePath);
  const mainView = useAppStore((s) => s.mainView);
  const error = useAppStore((s) => s.error);
  const notice = useAppStore((s) => s.notice);
  const refreshTree = useAppStore((s) => s.refreshTree);
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

  // Keep the tree in sync with edits made outside the app.
  useEffect(() => {
    if (!vault) return;
    void refreshTree();
    let unlisten: (() => void) | undefined;
    backend.onVaultChanged(() => void refreshTree()).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, [vault, refreshTree]);

  if (!vault) return <WelcomeScreen />;

  return (
    <div className="shell">
      <LeftSidebar />
      <main className="content">
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
          <div className="empty muted">Select or create a note</div>
        )}
      </main>
      <RightSidebar />
      <Modals />
      <footer className="statusbar">
        <span>{activePath ?? ""}</span>
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
