import { useEffect } from "react";
import { backend } from "./ipc";
import { useAppStore } from "./app/store";
import { useConfig } from "./app/config";
import { applyAppearance } from "./app/appearance";
import { openDailyNote } from "./features/commands/actions";
import { Modals } from "./features/commands/Modals";
import { WelcomeScreen } from "./features/vault/WelcomeScreen";
import { Editor } from "./features/editor";
import { LeftSidebar, RightSidebar } from "./features/panels/Sidebars";

export default function App() {
  const vault = useAppStore((s) => s.vault);
  const activePath = useAppStore((s) => s.activePath);
  const error = useAppStore((s) => s.error);
  const refreshTree = useAppStore((s) => s.refreshTree);

  // Restore a vault the backend already has open (e.g. after a webview reload).
  useEffect(() => {
    backend.currentVault().then((v) => {
      if (v) useAppStore.setState({ vault: v });
    });
  }, []);

  // Load vault settings; optionally open today's daily note.
  useEffect(() => {
    if (!vault) return;
    let cancelled = false;
    useConfig
      .getState()
      .load()
      .then(async () => {
        if (cancelled || !useConfig.getState().config.dailyNotes.openOnStartup) return;
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
        {activePath ? (
          <Editor key={activePath} path={activePath} />
        ) : (
          <div className="empty muted">Select or create a note</div>
        )}
      </main>
      <RightSidebar />
      <Modals />
      <footer className="statusbar">
        <span>{activePath ?? ""}</span>
        {error && (
          <span className="error" role="alert">
            {error}
          </span>
        )}
      </footer>
    </div>
  );
}
