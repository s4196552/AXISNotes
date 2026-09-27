import { backend } from "../../ipc";

// Images and other attachments opened from the file tree.

export function ImageView({ path }: { path: string }) {
  const url = backend.fileUrl(path);
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    <div className="image-view">
      <header className="editor-header">
        <h1 className="editor-title">{name}</h1>
      </header>
      <div className="image-view-body">
        {url ? (
          <img src={url} alt={name} />
        ) : (
          <p className="muted">Images are shown in the desktop app.</p>
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
