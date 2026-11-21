import { useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ExternalLink, Globe, PanelTop, RotateCw } from "lucide-react";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { resolveMedia } from "../../lib/attachments";
import { PageFrame } from "./PageFrame";
import "./drafts.css";

// A vault web page shown inside a note with ![[Page.html]] or ![[Page.html|600]] (T-269).
// The page runs in the same sandboxed frame as a page tab (PageFrame); the number sets its
// height. Loaded the first time a note has one, and the frame only when it nears the view.

export const DEFAULT_PAGE_HEIGHT = 480;

/** A height from the embed's `|number`, kept to something that fits a note. */
export const pageHeight = (n: number | null) =>
  n === null ? DEFAULT_PAGE_HEIGHT : Math.min(2000, Math.max(120, Math.round(n)));

export interface PageEmbedProps {
  /** The link target as written, e.g. `Quiz.html` or `Lessons/Lesson 1.html`. */
  target: string;
  /** The note the embed is in. */
  from: string;
  height: number | null;
  onEditLink(): void;
}

function PageEmbed(p: PageEmbedProps) {
  const tree = useAppStore((s) => s.tree);
  // Found like images and other attachments: by name anywhere, or relative to the note.
  const path = useMemo(() => {
    const found = resolveMedia(p.target.split("#")[0]!.trim(), p.from, tree);
    return found && /\.html?$/i.test(found) ? found : null;
  }, [p.target, p.from, tree]);
  const [reloads, setReloads] = useState(0);

  const name = p.target.slice(p.target.lastIndexOf("/") + 1);
  const url = path ? backend.pageUrl(path) : null;
  const report = (e: unknown) =>
    useAppStore.getState().notify(isBackendError(e) ? e.message : String(e));

  return (
    <div className="page-embed" role="group" aria-label={`Embedded page ${name}`}>
      <div className="page-embed-bar">
        <Globe size={14} aria-hidden className="muted" />
        <span className="page-embed-name" title={path ?? p.target}>
          {name}
        </span>
        {path && url && (
          <button
            type="button"
            aria-label="Reload page"
            title="Reload page"
            onClick={() => setReloads((n) => n + 1)}
          >
            <RotateCw size={13} />
          </button>
        )}
        {path && (
          <button
            type="button"
            title="Open the page in a tab"
            onClick={() => useAppStore.getState().openFile(path)}
          >
            <PanelTop size={13} /> Open
          </button>
        )}
        <button type="button" title="Edit the embed's link" onClick={p.onEditLink}>
          Edit link
        </button>
      </div>
      {path === null ? (
        <div className="page-embed-note">{p.target} isn't a web page in the vault.</div>
      ) : url ? (
        <PageFrame
          path={path}
          url={url}
          title={name}
          className="page-embed-frame"
          reloads={reloads}
          height={pageHeight(p.height)}
          lazy
        />
      ) : (
        <div className="page-embed-note">
          Web pages show here in the desktop app.{" "}
          <button type="button" onClick={() => void backend.openInBrowser(path).catch(report)}>
            <ExternalLink size={13} /> Open in browser
          </button>
        </div>
      )}
    </div>
  );
}

export function mountPageEmbed(host: HTMLElement, props: PageEmbedProps): Root {
  const root = createRoot(host);
  root.render(<PageEmbed {...props} />);
  return root;
}
