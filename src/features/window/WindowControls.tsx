import { useEffect, useState } from "react";
import { Copy, Minus, Square, X } from "lucide-react";
import { backend } from "../../ipc";
import "./window.css";

// The desktop window has no system frame, like Obsidian: the tab row is the title bar, and
// these buttons sit at its right end. In a browser (no `windowFrame`) nothing shows.

/**
 * Minimize, maximize/restore and close, fixed to the window's top-right corner.
 * `dragStrip` adds an empty strip across the top to move the window by, for screens
 * without a tab row (the welcome screen).
 */
export function WindowControls({ dragStrip = false }: { dragStrip?: boolean }) {
  const frame = backend.windowFrame;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!frame) return;
    let gone = false;
    let unlisten: (() => void) | undefined;
    const refresh = () =>
      void frame.isMaximized().then(
        (m) => !gone && setMaximized(m),
        () => {},
      );
    refresh();
    void frame.onResized(refresh).then((u) => (gone ? u() : (unlisten = u)));
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [frame]);

  if (!frame) return null;
  const size = maximized ? "Restore" : "Maximize";
  return (
    <>
      {dragStrip && <div className="titlebar-drag" data-tauri-drag-region />}
      <div className="window-controls" role="group" aria-label="Window">
        <button aria-label="Minimize" title="Minimize" onClick={() => void frame.minimize()}>
          <Minus size={16} strokeWidth={1.5} aria-hidden />
        </button>
        <button aria-label={size} title={size} onClick={() => void frame.toggleMaximize()}>
          {maximized ? (
            <Copy size={13} strokeWidth={1.5} aria-hidden className="window-restore" />
          ) : (
            <Square size={13} strokeWidth={1.5} aria-hidden />
          )}
        </button>
        <button
          className="window-close"
          aria-label="Close"
          title="Close"
          onClick={() => void frame.requestClose()}
        >
          <X size={17} strokeWidth={1.5} aria-hidden />
        </button>
      </div>
    </>
  );
}
