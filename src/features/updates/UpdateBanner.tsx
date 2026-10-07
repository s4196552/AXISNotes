import { Download, X } from "lucide-react";
import { useUpdates } from "./updates";
import "./updates.css";

/** Offers a newer version found in the updates folder. Never installs without a click. */
export function UpdateBanner() {
  const { available, dismissed, installing, error, install, dismiss } = useUpdates();
  if (!available || dismissed) return null;
  return (
    <div className="update-banner" role="region" aria-label="Update available">
      <Download size={16} className="update-icon" />
      <div className="update-text">
        <strong>AXISNotes {available.version} is available.</strong>
        {available.notes && <span className="muted update-notes">{available.notes}</span>}
        {installing && <span className="muted">Installing… AXISNotes will reopen.</span>}
        {error && (
          <span className="ai-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <button disabled={installing} onClick={() => void install()}>
        Install and restart
      </button>
      <button aria-label="Later" title="Later" disabled={installing} onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
