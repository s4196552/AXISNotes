import { useEffect, useState } from "react";
import { FolderOpen, Link2, Trash } from "lucide-react";
import { backend, type ClipperStatus, isBackendError, type PairingCode } from "../../ipc";
import "./clipper.css";

// Settings → Web clipper: the localhost endpoint the browser extension sends clips to,
// pairing a browser with a one-time code, and revoking paired browsers.

const when = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : "never");
const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));

export function ClipperSettings() {
  const [status, setStatus] = useState<ClipperStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<(PairingCode & { until: number }) | null>(null);
  const [left, setLeft] = useState(0);
  const [extensionDir, setExtensionDir] = useState<string | null>(null);

  useEffect(() => {
    backend.clipperStatus().then(setStatus, (e: unknown) => setError(message(e)));
  }, []);

  // While a code is shown: count down, and watch for the new browser to appear.
  useEffect(() => {
    if (!pairing) return;
    const before = status?.devices.length ?? 0;
    const tick = setInterval(() => {
      const secs = Math.max(0, Math.round((pairing.until - Date.now()) / 1000));
      setLeft(secs);
      if (secs === 0) setPairing(null);
      void backend.clipperStatus().then((s) => {
        setStatus(s);
        if (s.devices.length > before) setPairing(null);
      });
    }, 1000);
    return () => clearInterval(tick);
    // Only restart when a new code is shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  const run = (p: Promise<ClipperStatus>) =>
    p.then(
      (s) => (setStatus(s), setError(null)),
      (e: unknown) => setError(message(e)),
    );

  if (!status) return error ? <p className="ai-error">{error}</p> : null;

  return (
    <div className="clipper-settings">
      <p className="muted">
        Save web pages, selections, screenshots and links from your browser into this vault. The
        AXIS extension talks only to this app, on this computer.
      </p>
      <label className="clipper-row">
        <input
          type="checkbox"
          aria-label="Enable the web clipper"
          checked={status.enabled}
          onChange={(e) => void run(backend.clipperSetEnabled(e.target.checked))}
        />
        Enable the web clipper
      </label>
      <p className="clipper-status" role="status">
        {status.running ? (
          <span className="ai-ok">
            <Link2 size={13} /> Listening on 127.0.0.1:{status.port}
          </span>
        ) : status.error ? (
          <span className="ai-error">{status.error}</span>
        ) : (
          <span className="muted">Off</span>
        )}
      </p>
      <label className="clipper-row">
        Save clips in
        <input
          aria-label="Clippings folder"
          defaultValue={status.folder}
          key={status.folder}
          onBlur={(e) => {
            if (e.target.value.trim() !== status.folder)
              void run(backend.clipperSetFolder(e.target.value));
          }}
        />
      </label>

      <h3>Paired browsers</h3>
      {status.devices.length === 0 ? (
        <p className="muted">None yet.</p>
      ) : (
        <ul className="clipper-devices" aria-label="Paired browsers">
          {status.devices.map((d) => (
            <li key={d.id}>
              <strong>{d.name}</strong>
              <span className="muted">
                paired {when(d.createdMs)} · last clip {when(d.lastUsedMs)}
              </span>
              <button
                className="ai-icon"
                aria-label={`Revoke ${d.name}`}
                title="Revoke: this browser can't send clips any more"
                onClick={() => void run(backend.clipperRevoke(d.id))}
              >
                <Trash size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {pairing ? (
        <div className="clipper-pairing" role="group" aria-label="Pairing code">
          <p>In the AXIS extension, click “Pair with AXIS” and enter:</p>
          <div className="clipper-code" aria-label="Code">
            {pairing.code}
          </div>
          <p className="muted">
            Expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
          </p>
          <button
            onClick={() => {
              void backend.clipperCancelPairing();
              setPairing(null);
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          disabled={!status.running}
          onClick={() =>
            void backend.clipperStartPairing().then(
              (p) => {
                setLeft(p.expiresInSecs);
                setPairing({ ...p, until: Date.now() + p.expiresInSecs * 1000 });
              },
              (e: unknown) => setError(message(e)),
            )
          }
        >
          Pair a browser
        </button>
      )}
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}

      <h3>Install the extension</h3>
      <p className="muted">
        The extension comes with AXIS. In Chrome or Edge, open <code>chrome://extensions</code>,
        turn on Developer mode, choose “Load unpacked” and pick the extension folder. In Firefox,
        open <code>about:debugging</code> → This Firefox → “Load Temporary Add-on” and pick its{" "}
        <code>manifest.json</code>. Clips taken while AXIS is closed are kept by the extension and
        delivered the next time AXIS runs.
      </p>
      <button
        onClick={() =>
          void backend.clipperOpenExtensionFolder().then(
            (dir) => (setExtensionDir(dir), setError(null)),
            (e: unknown) => setError(message(e)),
          )
        }
      >
        <FolderOpen size={14} /> Open extension folder
      </button>
      {extensionDir && (
        <p className="muted">
          Opened <code>{extensionDir}</code>
        </p>
      )}
    </div>
  );
}
