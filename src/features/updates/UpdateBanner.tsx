import { Download, X } from "lucide-react";
import { useUpdates } from "./updates";
import "./updates.css";

/** Says an update isn't signed by the AXISNotes release key (T-282). */
export function Unverified({ reason }: { reason: string | null }) {
  return (
    <span className="update-unverified">
      Not verified: {reason ?? "its signature doesn’t check out."} Install it only if you trust
      whoever can change the updates folder.
    </span>
  );
}

/** Offers a newer version found in the updates folder, or shows it installing on its own
 *  (automatic install, Settings → Updates). An unverified update is only ever installed
 *  from its button. */
export function UpdateBanner() {
  const { available, dismissed, installing, error, install, dismiss } = useUpdates();
  if (!available || dismissed) return null;
  return (
    <div className="update-banner" role="region" aria-label="Update available">
      <Download size={16} className="update-icon" />
      <div className="update-text">
        <strong>AXISNotes {available.version} is available.</strong>
        {available.notes && <span className="muted update-notes">{available.notes}</span>}
        {!available.verified && <Unverified reason={available.unverifiedReason} />}
        {installing && <span className="muted">Installing… AXISNotes will reopen.</span>}
        {error && (
          <span className="ai-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <button
        disabled={installing}
        // Keep focus where it is until install() has started protecting edits (T-073).
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => void install(true)}
      >
        {available.verified ? "Install and restart" : "Install anyway"}
      </button>
      <button aria-label="Later" title="Later" disabled={installing} onClick={dismiss}>
        <X size={14} />
      </button>
    </div>
  );
}
