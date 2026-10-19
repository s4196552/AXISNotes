import { useMemo, useState } from "react";
import { ImagePlus } from "lucide-react";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { attachmentFolderFor, vaultImages } from "../../lib/attachments";

/** Images listed at once; the filter narrows the rest. */
const SHOWN = 60;

/**
 * Choose an image for `forPath` (a note or folder): one already in the vault, or one
 * uploaded from the computer, which is copied into `attachments/` beside it.
 */
export function ImageChooser({
  forPath,
  query,
  onPick,
}: {
  forPath: string;
  query: string;
  onPick(path: string): void;
}) {
  const tree = useAppStore((s) => s.tree);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const all = useMemo(() => vaultImages(tree), [tree]);
  const q = query.trim().toLowerCase();
  const matches = q ? all.filter((p) => p.toLowerCase().includes(q)) : all;

  const upload = async () => {
    setError("");
    const source = await backend.pickImage();
    if (!source) return;
    setBusy(true);
    try {
      const entry = await backend.importImage(source, attachmentFolderFor(forPath));
      await useAppStore.getState().refreshTree();
      onPick(entry.path);
    } catch (e) {
      setError(`Couldn't add the image: ${isBackendError(e) ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="image-chooser">
      <button className="image-upload" onClick={() => void upload()} disabled={busy}>
        <ImagePlus size={15} aria-hidden /> {busy ? "Adding…" : "Upload image…"}
      </button>
      {error && (
        <p className="icon-note" role="alert">
          {error}
        </p>
      )}
      {matches.length === 0 ? (
        <p className="icon-note">
          {all.length === 0 ? "No images in this vault yet." : `No images match “${query}”.`}
        </p>
      ) : (
        <div className="image-grid" role="listbox" aria-label="Images in this vault">
          {matches.slice(0, SHOWN).map((p) => (
            <button key={p} role="option" aria-selected={false} title={p} onClick={() => onPick(p)}>
              <Thumb path={p} />
              <span>{p.slice(p.lastIndexOf("/") + 1)}</span>
            </button>
          ))}
        </div>
      )}
      {matches.length > SHOWN && (
        <p className="icon-note">
          Showing {SHOWN} of {matches.length}. Type to narrow down.
        </p>
      )}
    </div>
  );
}

function Thumb({ path }: { path: string }) {
  const url = backend.fileUrl(path);
  const [failed, setFailed] = useState(false);
  if (!url || failed) return <span className="image-thumb missing" aria-hidden />;
  return (
    <img className="image-thumb" src={url} alt="" loading="lazy" onError={() => setFailed(true)} />
  );
}
