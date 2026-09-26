import type { FileDocument } from "./useFileDocument";

/** "Changed on disk" / "moved or deleted" banner for file-backed documents. */
export function DocBanner({ doc, noun }: { doc: FileDocument; noun: string }) {
  if (doc.banner === "conflict") {
    return (
      <div className="editor-banner" role="alert">
        <span>This {noun} changed on disk.</span>
        <button
          onClick={() => {
            doc.dismissBanner();
            void doc.reload();
          }}
        >
          Reload from disk
        </button>
        <button
          className="primary"
          onClick={() => {
            doc.dismissBanner();
            void doc.save(true);
          }}
        >
          Keep my version
        </button>
      </div>
    );
  }
  if (doc.banner === "removed") {
    return (
      <div className="editor-banner" role="alert">
        <span>This {noun} was moved or deleted.</span>
        <button
          className="primary"
          onClick={() => {
            doc.dismissBanner();
            void doc.save(true);
          }}
        >
          Save here anyway
        </button>
      </div>
    );
  }
  return null;
}
