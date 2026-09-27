import { useState } from "react";
import { FolderOpen, FolderPlus, X } from "lucide-react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { forgetVault, recentVaults, reopenLast, setReopenLast } from "../../app/recentVaults";
import { STARTER_NOTES } from "./starterNotes";

// First screen when no vault is open: recent vaults, open a folder (an Obsidian vault
// works as is), or create a new vault, optionally with a few example notes.

export function WelcomeScreen() {
  const openVault = useAppStore((s) => s.openVault);
  const createVault = useAppStore((s) => s.createVault);
  const error = useAppStore((s) => s.error);
  const [name, setName] = useState("My Vault");
  const [examples, setExamples] = useState(true);
  const [creating, setCreating] = useState(false);
  const [recent, setRecent] = useState(recentVaults);
  const [reopen, setReopen] = useState(reopenLast);

  async function handleOpen() {
    const folder = await backend.pickFolder();
    if (folder) await openVault(folder);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const parent = await backend.pickFolder();
    if (parent) await createVault(parent, name.trim(), examples ? STARTER_NOTES : {});
  }

  return (
    <main className="welcome">
      <h1>AXIS</h1>
      <p className="muted">
        Your notes are plain files in a folder you choose. Everything works offline.
      </p>

      {recent.length > 0 && (
        <section className="welcome-recent" aria-label="Recent vaults">
          <h2>Recent</h2>
          <ul>
            {recent.map((r) => (
              <li key={r.root}>
                <button className="welcome-vault" onClick={() => void openVault(r.root)}>
                  <strong>{r.name}</strong>
                  <span className="muted">{r.root}</span>
                </button>
                <button
                  className="ai-icon"
                  aria-label={`Remove ${r.name} from the list`}
                  title="Remove from the list (the folder isn't touched)"
                  onClick={() => {
                    forgetVault(r.root);
                    setRecent(recentVaults());
                  }}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
          <label className="welcome-reopen">
            <input
              type="checkbox"
              checked={reopen}
              onChange={(e) => {
                setReopenLast(e.target.checked);
                setReopen(e.target.checked);
              }}
            />
            Reopen the last vault when AXIS starts
          </label>
        </section>
      )}

      <div className="welcome-actions">
        <button className="primary" onClick={handleOpen}>
          <FolderOpen size={16} /> Open folder as vault
        </button>
        <button onClick={() => setCreating((c) => !c)} aria-expanded={creating}>
          <FolderPlus size={16} /> Create new vault
        </button>
      </div>
      <p className="muted welcome-hint">
        Using Obsidian? Open your Obsidian vault folder: AXIS reads it as it is.
      </p>
      {creating && (
        <form className="welcome-create" onSubmit={handleCreate}>
          <label>
            Vault name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="welcome-examples">
            <input
              type="checkbox"
              checked={examples}
              onChange={(e) => setExamples(e.target.checked)}
            />
            Add a few example notes
          </label>
          <button className="primary" type="submit" disabled={!name.trim()}>
            Choose location…
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
