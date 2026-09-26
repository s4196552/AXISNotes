import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Hash } from "lucide-react";
import { backend, type TagCount } from "../../ipc";
import { buildTagTree, type TagNode } from "./tagTree";
import { useAppStore } from "../../app/store";

export function TagsPanel() {
  const indexVersion = useAppStore((s) => s.indexVersion);
  const search = useAppStore((s) => s.search);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    backend.listTags().then(
      (t) => !cancelled && setTags(t),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, [indexVersion]);

  const tree = useMemo(() => buildTagTree(tags), [tags]);
  const toggle = (tag: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });

  const render = (nodes: TagNode[], depth: number): React.ReactNode =>
    nodes.map((n) => (
      <li key={n.tag}>
        <div className="panel-row" style={{ paddingLeft: 6 + depth * 14 }}>
          {n.children.length ? (
            <button
              className="panel-chevron"
              aria-label={`${open.has(n.tag) ? "Collapse" : "Expand"} ${n.tag}`}
              onClick={() => toggle(n.tag)}
            >
              {open.has(n.tag) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </button>
          ) : (
            <span className="panel-chevron" />
          )}
          <button className="panel-tag" onClick={() => search(`tag:${n.tag}`)}>
            <Hash size={13} aria-hidden />
            {n.name}
          </button>
          <span className="panel-count muted">{n.total}</span>
        </div>
        {n.children.length > 0 && open.has(n.tag) && <ul>{render(n.children, depth + 1)}</ul>}
      </li>
    ));

  return (
    <div className="panel">
      {tree.length === 0 ? (
        <p className="panel-note muted">No tags yet. Add #tags to your notes.</p>
      ) : (
        <ul className="panel-list" aria-label="Tags">
          {render(tree, 0)}
        </ul>
      )}
    </div>
  );
}
