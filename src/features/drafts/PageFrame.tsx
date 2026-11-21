import { useEffect, useRef, useState } from "react";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { LINK_GAP_MS, pageLink } from "./pageLinks";
import { findEntry } from "../filetree/treeModel";
import { useStudyResults } from "../comprehension/studyResults";

// A vault web page in a sandboxed frame (T-190), shared by the page tab (WebFileView) and
// pages embedded in notes with ![[Page.html]] (T-269), so the two can't drift apart.
//
// The page runs in a sandbox without allow-same-origin, so it gets a null origin: it can't
// reach the app's page or call the app's commands, and the page protocol's own policy
// (src-tauri/src/pages.rs) keeps it off the network. Only `axispage:` URLs made by
// `backend.pageUrl` for a vault file are loaded: never `srcdoc`, `data:` or `blob:`.

/** What a page may do in its frame. Never add allow-same-origin or allow-popups. */
export const PAGE_SANDBOX = "allow-scripts allow-forms allow-modals";

export function PageFrame({
  path,
  url,
  title,
  className,
  reloads = 0,
  lazy = false,
  height,
}: {
  path: string;
  /** The page's `axispage:` URL (`backend.pageUrl(path)`). */
  url: string;
  title: string;
  className?: string;
  /** Bump to reload the page. */
  reloads?: number;
  /** Load only when the frame nears the viewport (embeds in notes). */
  lazy?: boolean;
  /** A fixed height in pixels (embeds); otherwise the stylesheet decides. */
  height?: number;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [changes, setChanges] = useState(0);
  // Practice test and flash-card pages report results to the comprehension heatmap.
  useStudyResults(frame, path);

  // Edited outside the app (or rewritten by a skill): show the new version.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    backend
      .onVaultChanged((c) => {
        if (c.some((x) => x.paths.includes(path))) setChanges((n) => n + 1);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [path]);

  // Links clicked in the page (its link handler posts them, see pages.rs). Only taken from
  // this frame, while it has focus, which it gets when the user clicks in it: a page can't
  // open links on its own as it loads.
  useEffect(() => {
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

  return (
    <iframe
      ref={frame}
      className={className}
      title={title}
      // A new query string reloads the frame; the page protocol ignores it.
      src={`${url}?r=${reloads + changes}`}
      sandbox={PAGE_SANDBOX}
      referrerPolicy="no-referrer"
      loading={lazy ? "lazy" : undefined}
      style={height ? { height } : undefined}
    />
  );
}
