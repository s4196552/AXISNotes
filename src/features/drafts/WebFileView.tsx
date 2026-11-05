import { useEffect, useState } from "react";
import { ExternalLink, FolderOpen } from "lucide-react";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { DraftBanner } from "./DraftBanner";
import { isDraft } from "./drafts";
import "./drafts.css";

// A web page in the vault (an AI-made quiz or flash-card deck). AXISNotes doesn't run
// pages inside the app, where they could reach the app itself; it opens them in the
// default browser instead.

export function WebFileView({ path }: { path: string }) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const [size, setSize] = useState<number | null>(null);
  const draft = isDraft(path);

  useEffect(() => {
    let gone = false;
    backend.readFile(path).then(
      (f) => !gone && setSize(f.content.length),
      () => !gone && setSize(null),
    );
    return () => {
      gone = true;
    };
  }, [path]);

  const report = (e: unknown) =>
    useAppStore.getState().notify(isBackendError(e) ? e.message : String(e));

  return (
    <div className="web-view">
      {draft && <DraftBanner path={path} />}
      <div className="web-view-body">
        <h1 className="editor-title">{name}</h1>
        <p className="muted">
          A web page{size !== null && ` (${Math.max(1, Math.round(size / 1024))} KB)`}. It opens in
          your browser, where its buttons and quizzes work.
        </p>
        <button
          type="button"
          className="primary"
          onClick={() => void backend.openInBrowser(path).catch(report)}
        >
          <ExternalLink size={14} /> Open in browser
        </button>
        {!draft && (
          <button type="button" onClick={() => void backend.revealEntry(path).catch(report)}>
            <FolderOpen size={14} /> Show in folder
          </button>
        )}
      </div>
    </div>
  );
}
