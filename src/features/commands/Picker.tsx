import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fuzzyScore } from "./fuzzy";

export interface PickerItem {
  id: string;
  label: string;
  detail?: string;
  /** Extra text matched by the filter (aliases, keywords). */
  keywords?: string;
  hint?: string;
}

interface PickerProps<T extends PickerItem> {
  title: string;
  placeholder: string;
  items: T[];
  onPick(item: T): void;
  onClose(): void;
  /** Called on Enter when nothing matches (e.g. "create note"). */
  onCreate?(query: string): void;
  createLabel?(query: string): string;
  limit?: number;
}

/** Modal list with fuzzy filtering and keyboard navigation. */
export function Picker<T extends PickerItem>(p: PickerProps<T>) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const results = useMemo(() => {
    const q = query.trim();
    if (!q) return p.items.slice(0, p.limit ?? 200);
    return p.items
      .map((item) => ({
        item,
        score: Math.max(
          fuzzyScore(q, item.label),
          fuzzyScore(q, item.keywords ?? "") - 1,
          fuzzyScore(q, item.detail ?? "") - 2,
        ),
      }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, p.limit ?? 200)
      .map((r) => r.item);
  }, [query, p.items, p.limit]);

  const canCreate = Boolean(p.onCreate && query.trim());
  const count = results.length + (canCreate ? 1 : 0);
  const selected = Math.min(index, Math.max(0, count - 1));

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  const choose = (i: number) => {
    if (i < results.length) p.onPick(results[i]!);
    else if (canCreate) p.onCreate!(query.trim());
  };

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
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setIndex((selected + 1) % Math.max(1, count));
            else if (e.key === "ArrowUp") setIndex((selected - 1 + count) % Math.max(1, count));
            else if (e.key === "Enter") choose(selected);
            else if (e.key === "Escape") p.onClose();
            else return;
            e.preventDefault();
          }}
        />
        <ul
          id={listId}
          className="picker-list"
          role="listbox"
          ref={listRef}
          aria-label={`${p.title} results`}
        >
          {results.map((item, i) => (
            <li
              key={item.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? "selected" : undefined}
              onMouseMove={() => setIndex(i)}
              onClick={() => choose(i)}
            >
              <span className="picker-label">{item.label}</span>
              {item.detail && <span className="picker-detail muted">{item.detail}</span>}
              {item.hint && <kbd className="picker-hint">{item.hint}</kbd>}
            </li>
          ))}
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
      </div>
    </div>
  );
}
