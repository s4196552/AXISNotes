import { useState } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";

export function WelcomeScreen() {
  const openVault = useAppStore((s) => s.openVault);
  const createVault = useAppStore((s) => s.createVault);
  const error = useAppStore((s) => s.error);
  const [name, setName] = useState("My Vault");
  const [creating, setCreating] = useState(false);

  async function handleOpen() {
    const folder = await backend.pickFolder();
    if (folder) await openVault(folder);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const parent = await backend.pickFolder();
    if (parent) await createVault(parent, name.trim());
  }

  return (
    <main className="welcome">
      <h1>AXIS</h1>
      <p className="muted">Your notes are plain files in a folder you choose.</p>
      <div className="welcome-actions">
        <button className="primary" onClick={handleOpen}>
          <FolderOpen size={16} /> Open folder as vault
        </button>
        <button onClick={() => setCreating((c) => !c)}>
          <FolderPlus size={16} /> Create new vault
        </button>
      </div>
      {creating && (
        <form className="welcome-create" onSubmit={handleCreate}>
          <label>
            Vault name
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
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
