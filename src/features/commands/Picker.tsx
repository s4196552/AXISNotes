import { Fragment, useEffect, useId, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { fuzzyIndices, fuzzyScore } from "./fuzzy";

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  /** Extra text matched by the filter (aliases, keywords). */
  keywords?: string;
  hint?: string;
  icon?: LucideIcon;
  /** A heading shown above the first item of each run with the same section. */
  section?: string;
}

interface PickerProps<T extends PickerItem> {
  title: string;
  placeholder: string;
  items: T[];
  /** `mod`: chosen with Ctrl/Cmd held (Ctrl+Enter or Ctrl+click), e.g. "open in a new tab". */
  onPick(item: T, how: { mod: boolean }): void;
  onClose(): void;
  /** Called on Enter when nothing matches (e.g. "create note"). */
  onCreate?(query: string): void;
  createLabel?(query: string): string;
  limit?: number;
  /** Told about every edit of the query (e.g. to load a note's headings after `#`). */
  onQueryChange?(query: string): void;
  /** The part of the query the items are filtered by (default: all of it). */
  matchQuery?(query: string): string;
  /** Whether "create" is offered for this query (default: whenever there is one). */
  canCreate?(query: string): boolean;
  /** Key hints under the list, e.g. "Enter open". */
  footer?: string[];
}

/** `text` with the characters matching `query` marked. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const hits = query ? fuzzyIndices(query, text) : null;
  if (!hits?.length) return <>{text}</>;
  const marked = new Set(hits);
  const parts: { s: string; on: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const on = marked.has(i);
    const last = parts.at(-1);
    if (last && last.on === on) last.s += text[i];
    else parts.push({ s: text[i]!, on });
  }
  return (
    <>
      {parts.map((p, i) =>
        p.on ? <mark key={i}>{p.s}</mark> : <Fragment key={i}>{p.s}</Fragment>,
      )}
    </>
  );
}

/** Modal list with fuzzy filtering and keyboard navigation. */
export function Picker<T extends PickerItem>(p: PickerProps<T>) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;
  const match = (p.matchQuery?.(query) ?? query).trim();

  const results = useMemo(() => {
    if (!match) return p.items.slice(0, p.limit ?? 200);
    return p.items
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyScore(match, item.label),
          fuzzyScore(match, item.keywords ?? "") - 1,
          fuzzyScore(match, item.detail ?? "") - 2,
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, p.limit ?? 200)
      .map((r) => r.item);
  }, [match, p.items, p.limit]);

  const canCreate = Boolean(p.onCreate && query.trim() && (p.canCreate?.(query.trim()) ?? true));
  const count = results.length + (canCreate ? 1 : 0);
  const selected = Math.min(index, Math.max(0, count - 1));

  useEffect(() => {
    document.getElementById(`${listId}-opt-${selected}`)?.scrollIntoView?.({ block: "nearest" });
  }, [selected, listId]);

  const choose = (i: number, mod = false) => {
    if (i < results.length) p.onPick(results[i]!, { mod });
    else if (canCreate) p.onCreate!(query.trim());
  };

  // While filtering, results are ranked, so section headings would only interleave.
  const showSections = !match;

  return (
    <div className="modal-backdrop" onMouseDown={p.onClose}>
      <div
        className="modal picker"
        role="dialog"
        aria-label={p.title}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          className="picker-input"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={count ? optionId(selected) : undefined}
          aria-label={p.title}
          placeholder={p.placeholder}
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
            p.onQueryChange?.(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIndex((selected + 1) % Math.max(1, count));
            else if (e.key === "ArrowUp") setIndex((selected - 1 + count) % Math.max(1, count));
            else if (e.key === "Enter") choose(selected, e.ctrlKey || e.metaKey);
            else if (e.key === "Escape") p.onClose();
            else return;
            e.preventDefault();
          }}
        />
        <ul id={listId} className="picker-list" role="listbox" aria-label={`${p.title} results`}>
          {results.map((item, i) => {
            const Icon = item.icon;
            const heading =
              showSections && item.section && item.section !== results[i - 1]?.section
                ? item.section
                : null;
            return (
              <Fragment key={item.id}>
                {heading && (
                  <li className="picker-section" role="presentation">
                    {heading}
                  </li>
                )}
                <li
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === selected}
                  className={i === selected ? "selected" : undefined}
                  onMouseMove={() => setIndex(i)}
                  onClick={(e) => choose(i, e.ctrlKey || e.metaKey)}
                >
                  {Icon && <Icon className="picker-icon" size={15} aria-hidden="true" />}
                  <span className="picker-label">
                    <Highlighted text={item.label} query={match} />
                  </span>
                  {item.detail && <span className="picker-detail muted">{item.detail}</span>}
                  {item.hint && <kbd className="picker-hint">{item.hint}</kbd>}
                </li>
              </Fragment>
            );
          })}
          {canCreate && (
            <li
              id={optionId(results.length)}
              role="option"
              aria-selected={selected === results.length}
              className={selected === results.length ? "selected" : undefined}
              onMouseMove={() => setIndex(results.length)}
              onClick={() => choose(results.length)}
            >
              <span className="picker-label">
                {p.createLabel?.(query.trim()) ?? `Create "${query.trim()}"`}
              </span>
            </li>
          )}
          {count === 0 && <li className="picker-empty muted">No matches</li>}
        </ul>
        {p.footer && (
          <div className="picker-footer muted" aria-hidden="true">
            {p.footer.map((f) => (
              <span key={f}>{f}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
