import { useEffect, useState } from "react";
import { ExternalLink, FolderOpen, Globe, RotateCw } from "lucide-react";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { DraftBanner } from "./DraftBanner";
import { isDraft } from "./drafts";
import "./drafts.css";

// A web page in the vault (an AI-made quiz, flash cards, a lesson, or any .html file),
// shown in the app (T-190). The page runs in a sandboxed frame without allow-same-origin,
// so it gets a null origin: it can't reach the app's page or call the app's commands, and
// the page protocol's own policy keeps it off the network. Where pages can't be shown
// (the browser preview) it falls back to opening them in the default browser.

/** What a page may do in its frame. Never add allow-same-origin or allow-popups. */
export const PAGE_SANDBOX = "allow-scripts allow-forms allow-modals";

export function WebFileView({ path }: { path: string }) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const draft = isDraft(path);
  const url = backend.pageUrl(path);
  const [reloads, setReloads] = useState(0);

  // Edited outside the app (or rewritten by a skill): show the new version.
  useEffect(() => {
    if (!url) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    backend
      .onVaultChanged((changes) => {
        if (changes.some((c) => c.paths.includes(path))) setReloads((n) => n + 1);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [path, url]);

  const report = (e: unknown) =>
    useAppStore.getState().notify(isBackendError(e) ? e.message : String(e));
  const openInBrowser = () => void backend.openInBrowser(path).catch(report);
  const reveal = () => void backend.revealEntry(path).catch(report);

  if (!url)
    return (
      <BrowserOnly path={path} name={name} draft={draft} onOpen={openInBrowser} onReveal={reveal} />
    );

  return (
    <div className="web-view has-frame">
      {draft && <DraftBanner path={path} />}
      <div className="web-view-bar" role="toolbar" aria-label="Web page">
        <Globe size={14} aria-hidden className="muted" />
        <span className="web-view-name" title={path}>
          {name}
        </span>
        <button
          type="button"
          aria-label="Reload page"
          title="Reload page"
          onClick={() => setReloads((n) => n + 1)}
        >
          <RotateCw size={14} />
        </button>
        <button type="button" title="Open in your default browser" onClick={openInBrowser}>
          <ExternalLink size={14} /> Open in browser
        </button>
        {!draft && (
          <button type="button" aria-label="Show in folder" title="Show in folder" onClick={reveal}>
            <FolderOpen size={14} />
          </button>
        )}
      </div>
      <iframe
        className="web-view-frame"
        title={name}
        // A new query string reloads the frame; the page protocol ignores it.
        src={`${url}?r=${reloads}`}
        sandbox={PAGE_SANDBOX}
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

/** Where pages can't be shown in the app: say so and offer the browser. */
function BrowserOnly(p: {
  path: string;
  name: string;
  draft: boolean;
  onOpen(): void;
  onReveal(): void;
}) {
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    let gone = false;
    backend.readFile(p.path).then(
      (f) => !gone && setSize(f.content.length),
      () => !gone && setSize(null),
    );
    return () => {
      gone = true;
    };
  }, [p.path]);
  return (
    <div className="web-view">
      {p.draft && <DraftBanner path={p.path} />}
      <div className="web-view-body">
        <h1 className="editor-title">{p.name}</h1>
        <p className="muted">
          A web page{size !== null && ` (${Math.max(1, Math.round(size / 1024))} KB)`}. It opens in
          your browser, where its buttons and quizzes work.
        </p>
        <button type="button" className="primary" onClick={p.onOpen}>
          <ExternalLink size={14} /> Open in browser
        </button>
        {!p.draft && (
          <button type="button" onClick={p.onReveal}>
            <FolderOpen size={14} /> Show in folder
          </button>
        )}
      </div>
    </div>
  );
}
