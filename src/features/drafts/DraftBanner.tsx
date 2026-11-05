import { useState } from "react";
import { FilePlus2, Trash2 } from "lucide-react";
import { useAppStore } from "../../app/store";
import { isBackendError } from "../../ipc";
import { baseName, discardDraft, saveDraft, suggestedFolder, vaultFolders } from "./drafts";
import "./drafts.css";

// Shown above a draft (an AI-made file that isn't in the user's notes yet): pick a folder
// and a name to keep it, or discard it.

export function DraftBanner({ path, flush }: { path: string; flush?: () => Promise<void> }) {
  const tree = useAppStore((s) => s.tree);
  const folders = vaultFolders(tree);
  const [folder, setFolder] = useState(() => {
    const f = suggestedFolder(path);
    return folders.includes(f) ? f : "";
  });
  const [name, setName] = useState(() => baseName(path));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(isBackendError(e) || e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="draft-banner" role="region" aria-label="Draft">
      <span className="draft-banner-text">
        <strong>Draft.</strong> The AI made this. It isn&rsquo;t in your notes until you save it.
      </span>
      <label className="draft-field">
        Name
        <input
          aria-label="Draft name"
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="draft-field">
        Folder
        <select
          aria-label="Save to folder"
          value={folder}
          disabled={busy}
          onChange={(e) => setFolder(e.target.value)}
        >
          {folders.map((f) => (
            <option key={f} value={f}>
              {f || "Top level of the vault"}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="primary"
        disabled={busy || !name.trim()}
        onClick={() =>
          void run(async () => {
            await flush?.();
            const to = await saveDraft(path, folder, name);
            useAppStore.getState().notify(`Saved as ${to}.`);
          })
        }
      >
        <FilePlus2 size={13} /> Save
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await discardDraft(path);
            useAppStore.getState().notify("Draft discarded (it's in the trash).");
          })
        }
      >
        <Trash2 size={13} /> Discard
      </button>
      {error && (
        <span className="ai-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
