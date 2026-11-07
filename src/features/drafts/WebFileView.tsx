import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, FolderOpen, Globe, RotateCw } from "lucide-react";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { DraftBanner } from "./DraftBanner";
import { isDraft } from "./drafts";
import { LINK_GAP_MS, pageLink } from "./pageLinks";
import { findEntry } from "../filetree/treeModel";
import { copyPageText } from "../skills/copyable";
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
  const frame = useRef<HTMLIFrameElement>(null);

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

  // Links clicked in the page (its link handler posts them, see pages.rs). Only taken from
  // this frame, while it has focus, which it gets when the user clicks in it: a page can't
  // open links on its own as it loads.
  useEffect(() => {
    if (!url) return;
    let last = 0;
    const onMessage = (e: MessageEvent) => {
      const f = frame.current;
      if (!f || e.source !== f.contentWindow || document.activeElement !== f) return;
      const data: unknown = e.data;
      if (!data || typeof data !== "object" || !("axisnotesLink" in data)) return;
      const link = pageLink(data.axisnotesLink, url);
      if (!link || Date.now() - last < LINK_GAP_MS) return;
      last = Date.now();
      const notify = useAppStore.getState().notify;
      if ("web" in link) {
        backend
          .openWebLink(link.web)
          .catch((err: unknown) => notify(isBackendError(err) ? err.message : String(err)));
      } else if (findEntry(useAppStore.getState().tree, link.vault)) {
        useAppStore.getState().openFile(link.vault);
      } else notify(`${link.vault} isn't in the vault.`);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [url]);

  const report = (e: unknown) =>
    useAppStore.getState().notify(isBackendError(e) ? e.message : String(e));
  const openInBrowser = () => void backend.openInBrowser(path).catch(report);
  const reveal = () => void backend.revealEntry(path).catch(report);
  // The page's text as saved (T-191); text its script writes isn't included.
  const copyText = () =>
    void backend
      .readFile(path)
      .then((f) => copyPageText(f.content))
      .then((m) => useAppStore.getState().notify(m), report);

  if (!url)
    return (
      <BrowserOnly
        path={path}
        name={name}
        draft={draft}
        onOpen={openInBrowser}
        onReveal={reveal}
        onCopy={copyText}
      />
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
        <button type="button" title="Copy the page's text" onClick={copyText}>
          <Copy size={14} /> Copy text
        </button>
        {!draft && (
          <button type="button" aria-label="Show in folder" title="Show in folder" onClick={reveal}>
            <FolderOpen size={14} />
          </button>
        )}
      </div>
      <iframe
        ref={frame}
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
  onCopy(): void;
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
          your browser, where its buttons and quizzes work and you can select and copy its text.
        </p>
        <button type="button" className="primary" onClick={p.onOpen}>
          <ExternalLink size={14} /> Open in browser
        </button>
        <button type="button" onClick={p.onCopy}>
          <Copy size={14} /> Copy text
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
