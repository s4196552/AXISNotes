import { backend } from "../../ipc";
import { mediaKind } from "../../lib/attachments";

// Images, video and audio opened from the file tree.

export function ImageView({ path }: { path: string }) {
  const url = backend.fileUrl(path);
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    <div className="image-view">
      <header className="editor-header">
        <h1 className="editor-title">{name}</h1>
      </header>
      <div className="image-view-body">
        {!url ? (
          <p className="muted">Images and videos are shown in the desktop app.</p>
        ) : mediaKind(path) === "video" ? (
          <video src={url} controls preload="metadata" aria-label={name} />
        ) : mediaKind(path) === "audio" ? (
          <audio src={url} controls preload="metadata" aria-label={name} />
        ) : (
          <img src={url} alt={name} />
        )}
      </div>
    </div>
  );
}

export function UnsupportedView({ path }: { path: string }) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    <div className="image-view">
      <header className="editor-header">
        <h1 className="editor-title">{name}</h1>
      </header>
      <p className="empty muted">
        AXISNotes can't show this kind of file. It stays in your vault as is.
      </p>
    </div>
  );
}
