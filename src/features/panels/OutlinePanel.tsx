import { useEffect, useState } from "react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { type Heading, listHeadings } from "../../lib/headings";

/**
 * The open note's headings, indented by level; clicking one jumps there. Read from the
 * saved file, so it follows edits once they are saved (autosave is half a second).
 */
export function OutlinePanel({ path }: { path: string }) {
  const indexVersion = useAppStore((s) => s.indexVersion);
  const [outline, setOutline] = useState<{ path: string; headings: Heading[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    backend.readFile(path).then(
      (f) => !cancelled && setOutline({ path, headings: listHeadings(f.content) }),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [path, indexVersion]);

  const headings = outline?.path === path ? outline.headings : null;
  if (!headings) return null;
  if (headings.length === 0)
    return <p className="panel-note muted outline-empty">No headings in this note.</p>;
  const top = Math.min(...headings.map((h) => h.level));
  return (
    <ul className="outline-list" aria-label="Outline">
      {headings.map((h) => (
        <li key={`${h.line}`} style={{ paddingLeft: `${(h.level - top) * 12}px` }}>
          <button
            className="outline-item"
            title={h.text}
            onClick={() => useAppStore.getState().openFile(path, { line: h.line })}
          >
            {h.text}
          </button>
        </li>
      ))}
    </ul>
  );
}
