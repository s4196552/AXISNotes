import { useEffect, useRef, useState } from "react";
import { Logo } from "../../app/Logo";
import { isBackendError } from "../../ipc";
import { type UpdateJob, updaterSteps } from "./updaterSteps";
import "./updater.css";

// The update window (T-119): shown by AXISNotes's updater copy while the installer runs
// silently (see src-tauri/src/updater.rs), in place of the installer's own window.

type Phase = "closing" | "installing" | "starting" | "failed";

const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STATUS: Record<Exclude<Phase, "failed">, string> = {
  closing: "Closing AXISNotes…",
  installing: "Installing the update…",
  starting: "Done. Opening AXISNotes…",
};

export function UpdaterWindow({ delayMs = 700 }: { delayMs?: number }) {
  const [job, setJob] = useState<UpdateJob | null>(null);
  const [phase, setPhase] = useState<Phase>("closing");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    // Once, even when React runs effects twice in development.
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        setJob(await updaterSteps.job());
        // A moment for the app to finish closing (the installer closes it otherwise).
        await pause(delayMs);
        setPhase("installing");
        await updaterSteps.install();
        setPhase("starting");
        await pause(delayMs);
        await updaterSteps.finish(true);
      } catch (e) {
        setError(message(e));
        setPhase("failed");
      }
    })();
  }, [delayMs]);

  const failed = phase === "failed";
  return (
    <main className="updater" data-tauri-drag-region>
      <div className="updater-mark" data-tauri-drag-region>
        <Logo size={56} decorative />
      </div>
      <h1 data-tauri-drag-region>{failed ? "The update didn’t install" : "Updating AXISNotes"}</h1>
      {job && (
        <p className="updater-versions" data-tauri-drag-region>
          {job.fromVersion} <span aria-label="to">→</span> <strong>{job.toVersion}</strong>
        </p>
      )}
      {failed ? (
        <>
          <p className="updater-error" role="alert">
            {error} Your notes are safe; nothing in your vault was changed.
          </p>
          <div className="updater-actions">
            <button className="primary" onClick={() => void updaterSteps.finish(true)}>
              Open AXISNotes
            </button>
            <button onClick={() => void updaterSteps.finish(false)}>Close</button>
          </div>
        </>
      ) : (
        <>
          <div
            className={phase === "starting" ? "updater-bar done" : "updater-bar"}
            role="progressbar"
            aria-label="Update progress"
            aria-valuetext={STATUS[phase]}
          >
            <span />
          </div>
          <p className="updater-status" role="status">
            {STATUS[phase]}
          </p>
          {job?.notes && <p className="updater-notes">{job.notes}</p>}
        </>
      )}
    </main>
  );
}
