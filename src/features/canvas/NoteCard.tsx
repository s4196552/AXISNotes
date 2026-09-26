import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { splitFrontmatter } from "../../lib/markdown";

// A live preview of a note, shown inside a canvas card. Re-reads the note whenever it
// changes on disk (including the app's own saves, which bump the index version).

const PREVIEW_LINES = 60;

function titleOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.replace(/\.md$/i, "");
}

type State = { status: "loading" } | { status: "missing" } | { status: "ok"; body: string };

export function NoteCard({ path }: { path: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [reloads, setReloads] = useState(0);
  const indexVersion = useAppStore((s) => s.indexVersion);

  useEffect(() => {
    let cancelled = false;
    backend.readFile(path).then(
      (f) => {
        if (cancelled) return;
        const body = f.content.slice(splitFrontmatter(f.content).length).replace(/^\s+/, "");
        setState({ status: "ok", body: body.split("\n").slice(0, PREVIEW_LINES).join("\n") });
      },
      () => !cancelled && setState({ status: "missing" }),
    );
    return () => {
      cancelled = true;
    };
  }, [path, reloads, indexVersion]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    backend
      .onVaultChanged((changes) => {
        if (changes.some((c) => c.paths.includes(path))) setReloads((n) => n + 1);
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [path]);

  return (
    <div className="canvas-card" data-card-path={path}>
      <header className="canvas-card-header">
        <span className="canvas-card-title">{titleOf(path)}</span>
        <button
          className="canvas-card-open"
          aria-label={`Open ${titleOf(path)}`}
          title="Open note"
          onClick={() => useAppStore.getState().openFile(path)}
        >
          <ExternalLink size={13} />
        </button>
      </header>
      <div className="canvas-card-body">
        {state.status === "loading" && <span className="muted">Loading…</span>}
        {state.status === "missing" && <span className="muted">Note not found: {path}</span>}
        {state.status === "ok" &&
          (state.body.trim() ? (
            state.body.split("\n").map((line, i) => <PreviewLine key={i} line={line} />)
          ) : (
            <span className="muted">Empty note</span>
          ))}
      </div>
    </div>
  );
}

/** Very light Markdown styling: headings, bullets, tasks. Everything else is plain text. */
function PreviewLine({ line }: { line: string }) {
  const h = /^(#{1,6})\s+(.*)$/.exec(line);
  if (h) return <div className={`canvas-card-h h${h[1]!.length}`}>{h[2]}</div>;
  const task = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line);
  if (task)
    return (
      <div style={{ paddingLeft: task[1]!.length * 8 }}>
        {task[2] === " " ? "☐" : "☑"} {task[3]}
      </div>
    );
  const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
  if (bullet) return <div style={{ paddingLeft: bullet[1]!.length * 8 }}>• {bullet[2]}</div>;
  return <div>{line || " "}</div>;
}
