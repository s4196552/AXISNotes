import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { backend, HL_END, HL_START, isBackendError, type SearchHit } from "../../ipc";
import { useAppStore } from "../../app/store";
import { Highlighted } from "./Highlighted";

const DEBOUNCE_MS = 150;

export function SearchPanel() {
  const query = useAppStore((s) => s.searchQuery);
  const setQuery = useAppStore((s) => s.setSearchQuery);
  const indexVersion = useAppStore((s) => s.indexVersion);
  const openFile = useAppStore((s) => s.openFile);
  // Results remember the query they answer; stale ones are simply not shown.
  const [result, setResult] = useState<{
    query: string;
    hits: SearchHit[];
    ms: number;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!query.trim()) return;
    const t = setTimeout(async () => {
      const started = performance.now();
      try {
        const hits = await backend.search(query, 100);
        if (!cancelled) setResult({ query, hits, ms: performance.now() - started, error: null });
      } catch (e) {
        const error = isBackendError(e) ? e.message : String(e);
        if (!cancelled) setResult({ query, hits: [], ms: 0, error });
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, indexVersion]);

  const current = query.trim() && result?.query === query ? result : null;
  const hits = current && !current.error ? current.hits : null;
  const error = current?.error ?? null;
  const ms = current?.ms ?? null;

  return (
    <div className="panel">
      <label className="panel-search">
        <Search size={14} aria-hidden />
        <input
          type="search"
          aria-label="Search notes"
          placeholder="Search…  tag:  path:  prop:k=v  -word"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      {error && <p className="panel-note error">{error}</p>}
      {hits && (
        <p className="panel-note muted" aria-live="polite">
          {hits.length === 0
            ? "No results"
            : `${hits.length}${hits.length === 100 ? "+" : ""} results`}
          {ms !== null && hits.length > 0 && ` · ${Math.round(ms)} ms`}
        </p>
      )}
      <ul className="panel-list" aria-label="Search results">
        {hits?.map((hit) => (
          <li key={hit.path}>
            <button className="panel-item" onClick={() => openFile(hit.path)}>
              <span className="panel-item-title">{hit.title}</span>
              <span className="panel-item-path muted">{hit.path}</span>
              {hit.snippet && (
                <span className="panel-item-snippet">
                  <Highlighted text={hit.snippet} start={HL_START} end={HL_END} />
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
