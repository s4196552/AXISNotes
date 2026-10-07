import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { backend, isBackendError, type UpdateSettings } from "../../ipc";
import { useUpdates } from "./updates";
import "./updates.css";

// Settings → Updates: where new versions come from, checking on launch, and checking now.

const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));

export function UpdatesSettings() {
  const [settings, setSettings] = useState<UpdateSettings | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const { available, checking, checked, installing, error, check, install } = useUpdates();

  useEffect(() => {
    backend.updatesSettings().then(setSettings, (e: unknown) => setSaveError(message(e)));
  }, []);

  if (!settings) return saveError ? <p className="ai-error">{saveError}</p> : null;

  const save = (checkOnLaunch: boolean, folder: string) =>
    backend.updatesSaveSettings(checkOnLaunch, folder).then(
      (s) => (setSettings(s), setSaveError(null), useUpdates.setState({ checked: false })),
      (e: unknown) => setSaveError(message(e)),
    );
  const custom = settings.folder !== settings.defaultFolder;

  return (
    <div className="updates-settings">
      <p className="muted">
        This is AXISNotes {settings.currentVersion}. New versions come from a folder on this
        computer or your network. AXISNotes only reads that folder and never goes online for
        updates.
      </p>
      <label className="updates-row">
        <input
          type="checkbox"
          aria-label="Check for updates when AXISNotes starts"
          checked={settings.checkOnLaunch}
          onChange={(e) => void save(e.target.checked, custom ? settings.folder : "")}
        />
        Check for updates when AXISNotes starts
      </label>
      <div className="updates-row">
        <label className="updates-row">
          Updates folder
          <input
            aria-label="Updates folder"
            defaultValue={settings.folder}
            key={settings.folder}
            onBlur={(e) => {
              if (e.target.value.trim() !== settings.folder)
                void save(settings.checkOnLaunch, e.target.value);
            }}
          />
        </label>
        <button
          className="ai-icon"
          aria-label="Choose updates folder"
          title="Choose folder"
          onClick={() =>
            void backend.pickFolder().then((f) => {
              if (f) void save(settings.checkOnLaunch, f);
            })
          }
        >
          <FolderOpen size={14} />
        </button>
        {custom && (
          <button onClick={() => void save(settings.checkOnLaunch, "")}>Use default</button>
        )}
      </div>
      {saveError && <p className="ai-error">{saveError}</p>}
      <div className="updates-row">
        <button disabled={checking} onClick={() => void check()}>
          {checking ? "Checking…" : "Check for updates"}
        </button>
        {available && (
          <button disabled={installing} onClick={() => void install()}>
            Install {available.version} and restart
          </button>
        )}
      </div>
      <p className="updates-status" role="status">
        {error ? (
          <span className="ai-error">{error}</span>
        ) : installing ? (
          <span className="muted">Installing… AXISNotes will reopen.</span>
        ) : available ? (
          <span>
            AXISNotes {available.version} is available.
            {available.notes && <span className="muted"> {available.notes}</span>}
          </span>
        ) : checked ? (
          <span className="muted">You have the latest version.</span>
        ) : null}
      </p>
    </div>
  );
}
