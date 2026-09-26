import { useCallback, useEffect, useState } from "react";
import { backend, type Backlink, isBackendError, type Mention } from "../../ipc";
import { useAppStore } from "../../app/store";
import { noteName } from "../../lib/markdown";
import { linkMention } from "./mentions";

export function BacklinksPanel() {
  const activePath = useAppStore((s) => s.activePath);
  const indexVersion = useAppStore((s) => s.indexVersion);
  const openFile = useAppStore((s) => s.openFile);
  // Data remembers the note it belongs to; stale data is not shown.
  const [data, setData] = useState<{ path: string; linked: Backlink[]; mentions: Mention[] }>({
    path: "",
    linked: [],
    mentions: [],
  });

  useEffect(() => {
    let cancelled = false;
    if (!activePath) return;
    Promise.all([backend.backlinks(activePath), backend.unlinkedMentions(activePath)]).then(
      ([linked, mentions]) => {
        if (!cancelled) setData({ path: activePath, linked, mentions });
      },
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [activePath, indexVersion]);

  const link = useCallback(
    async (m: Mention) => {
      if (!activePath) return;
      const store = useAppStore.getState();
      try {
        if (!(await linkMention(activePath, m))) {
          store.setError(`${m.source} changed; refresh and try again`);
        }
      } catch (e) {
        store.setError(isBackendError(e) ? e.message : String(e));
      }
      store.bumpIndex();
    },
    [activePath],
  );

  if (!activePath) return <p className="panel-note muted">Open a note to see its links.</p>;
  const fresh = data.path === activePath;
  const linked = fresh ? data.linked : [];
  const mentions = fresh ? data.mentions : [];
  const linkCount = linked.reduce((n, b) => n + b.links.length, 0);

  return (
    <div className="panel">
      <h2 className="panel-heading">
        Linked mentions <span className="panel-count muted">{linkCount}</span>
      </h2>
      {linked.length === 0 && <p className="panel-note muted">No notes link here yet.</p>}
      <ul className="panel-list" aria-label="Linked mentions">
        {linked.map((b) => (
          <li key={b.source}>
            <button className="panel-item-title panel-link" onClick={() => openFile(b.source)}>
              {noteName(b.source)}
            </button>
            {b.links.map((l) => (
              <button
                key={l.line}
                className="panel-context"
                onClick={() => openFile(b.source, { line: l.line })}
              >
                {l.context}
              </button>
            ))}
          </li>
        ))}
      </ul>

      <h2 className="panel-heading">
        Unlinked mentions <span className="panel-count muted">{mentions.length}</span>
      </h2>
      {mentions.length === 0 && <p className="panel-note muted">None found.</p>}
      <ul className="panel-list" aria-label="Unlinked mentions">
        {mentions.map((m) => (
          <li key={`${m.source}:${m.start}`} className="panel-mention">
            <button className="panel-context" onClick={() => openFile(m.source, { line: m.line })}>
              <span className="panel-item-path muted">{noteName(m.source)}</span> {m.context}
            </button>
            <button className="panel-link-btn" onClick={() => void link(m)}>
              Link
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
