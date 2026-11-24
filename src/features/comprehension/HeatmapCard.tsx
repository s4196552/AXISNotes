import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Brain, Paintbrush, Sparkles } from "lucide-react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { stricter } from "../../lib/aiAccess";
import { ruleForPath } from "../ai/folderScope";
import { useSkills } from "../skills/skills";
import { runSkillOnPicked } from "../skills/skillOnFiles";
import {
  buildColumns,
  type Column,
  FROM_LABELS,
  LEVELS,
  type Level,
  levelLabel,
  notesInSources,
  percent,
  setManual,
  statsOf,
  type Topic,
  type Unit,
  unitLevel,
  type UnitMode,
} from "./model";
import { useComprehension, useComprehensionFile } from "./store";
import "./comprehension.css";

// The comprehension heatmap card (T-261): a square per unit of a topic's notes, coloured
// by how well the user knows it, with a legend, counts per level and summary stats.
// Hover or focus a square for its name and level; click opens the note at that section.
// "Set levels" turns clicks into marking a level by hand (keys 1–5 and 0 do it too).

type TopicSpec = Omit<Topic, "id">;

/** The notes of a topic with their text, read again when the vault changes. */
function useTopicNotes(sources: string[]) {
  const notes = useAppStore((s) => s.notes);
  const paths = useMemo(
    () =>
      notesInSources(
        sources,
        notes.map((n) => n.path),
      ),
    [sources, notes],
  );
  // Re-read when one of these notes is saved, or the vault's structure changes.
  const version = useAppStore(
    (s) => `${s.structureVersion}:${paths.reduce((n, p) => n + (s.contentVersions[p] ?? 0), 0)}`,
  );
  const [texts, setTexts] = useState<{ path: string; text: string }[] | null>(null);
  useEffect(() => {
    let gone = false;
    void Promise.all(
      paths.map((p) =>
        backend.readFile(p).then(
          (f) => ({ path: p, text: f.content }),
          () => ({ path: p, text: "" }),
        ),
      ),
    ).then((t) => !gone && setTexts(t));
    return () => {
      gone = true;
    };
  }, [paths, version]);
  return texts;
}

/** Whether AI may read a note (AI: never folders and notes stay out of AI actions). */
function useAiRule() {
  const rules = useConfig((s) => s.config.ai.folders);
  const notes = useAppStore((s) => s.notes);
  return useMemo(() => {
    const marks = new Map(notes.map((n) => [n.path, n.aiAccess ?? "any"] as const));
    return (p: string) => stricter(ruleForPath(rules, p), marks.get(p) ?? "any");
  }, [rules, notes]);
}

const dateOf = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

export function HeatmapCard(p: {
  topic: TopicSpec;
  /** Change Notes/Sections (the view saves it; a block rewrites its text). */
  onUnitChange?(unit: UnitMode): void;
  /** Extra buttons in the header. */
  actions?: ReactNode;
}) {
  const { topic } = p;
  const file = useComprehensionFile();
  const texts = useTopicNotes(topic.sources);
  const ruleOf = useAiRule();
  const skills = useSkills((s) => s.skills);
  const columns = useMemo(() => buildColumns(texts ?? [], topic.unit), [texts, topic.unit]);
  const units = useMemo(() => columns.flatMap((c) => c.units), [columns]);
  const levels = useMemo(() => units.map((u) => unitLevel(file, u)), [units, file]);
  const levelByKey = useMemo(
    () => new Map(units.map((u, i) => [u.key, levels[i]!] as const)),
    [units, levels],
  );
  const stats = statsOf(levels.map((l) => l.level));
  const [brush, setBrush] = useState<Level | 0 | null>(null);
  const [focus, setFocus] = useState(0);
  const [tip, setTip] = useState<{ unit: Unit; x: number; y: number } | null>(null);
  const grid = useRef<HTMLDivElement>(null);
  const unitGroup = useId();

  const setLevel = (u: Unit, level: Level | null) =>
    void useComprehension.getState().change((f) => setManual(f, u.key, level));
  const open = (u: Unit) =>
    useAppStore.getState().openFile(u.path, u.heading ? { heading: u.heading } : undefined);
  const activate = (u: Unit) => {
    if (brush === null) open(u);
    else setLevel(u, brush || null);
  };

  // In notes mode the squares flow into columns of 7, like a contribution graph.
  const shown: Column[] = useMemo(() => {
    if (topic.unit === "sections") return columns;
    const out: Column[] = [];
    for (let i = 0; i < columns.length; i += 7) {
      const part = columns.slice(i, i + 7);
      out.push({
        path: part[0]!.path,
        name: part.map((c) => c.name).join(", "),
        label: part[0]!.label,
        units: part.flatMap((c) => c.units),
      });
    }
    return out;
  }, [columns, topic.unit]);
  const flat = useMemo(() => shown.flatMap((c) => c.units), [shown]);
  const position = (i: number) => {
    let n = i;
    for (let c = 0; c < shown.length; c++) {
      if (n < shown[c]!.units.length) return { c, r: n };
      n -= shown[c]!.units.length;
    }
    return { c: 0, r: 0 };
  };
  const indexAt = (c: number, r: number) =>
    shown.slice(0, c).reduce((s, col) => s + col.units.length, 0) +
    Math.min(r, shown[c]!.units.length - 1);

  const moveFocus = (i: number) => {
    setFocus(i);
    grid.current?.querySelectorAll<HTMLButtonElement>(".heatmap-square")[i]?.focus();
  };
  const onKey = (e: KeyboardEvent, i: number) => {
    const u = flat[i]!;
    const { c, r } = position(i);
    if (/^[0-5]$/.test(e.key)) {
      e.preventDefault();
      setLevel(u, e.key === "0" ? null : (Number(e.key) as Level));
    } else if (e.key === "ArrowDown" && r < shown[c]!.units.length - 1) moveFocus(i + 1);
    else if (e.key === "ArrowUp" && r > 0) moveFocus(i - 1);
    else if (e.key === "ArrowRight" && c < shown.length - 1) moveFocus(indexAt(c + 1, r));
    else if (e.key === "ArrowLeft" && c > 0) moveFocus(indexAt(c - 1, r));
    else if (e.key === "Home") moveFocus(0);
    else if (e.key === "End") moveFocus(flat.length - 1);
    else return;
    e.preventDefault();
  };

  const showTip = (u: Unit, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setTip({ unit: u, x: r.left + r.width / 2, y: r.top });
  };

  const describe = (u: Unit) => {
    const l = levelByKey.get(u.key);
    const last = l?.rec?.results?.at(-1);
    const parts = [`${u.name}: ${levelLabel(l?.level ?? null)}`];
    if (l?.rec?.manual) parts.push("set by you");
    else if (l?.inherited === "note") parts.push("from the whole note");
    else if (l?.inherited === "sections") parts.push("average of its sections");
    if (last)
      parts.push(
        `${FROM_LABELS[last.from]}${last.total ? ` ${last.right}/${last.total}` : ""}, ${dateOf(last.at)}`,
      );
    if (ruleOf(u.path) === "never") parts.push("AI: never");
    return parts.join(" · ");
  };

  // Practise the weakest notes with a Practice test. Notes marked "AI: never" are left out
  // (runSkillOnPicked says so); the Rust layer still checks every note it's sent.
  const weakNotes = [
    ...new Set(units.filter((_u, i) => (levels[i]!.level ?? 9) <= 2).map((u) => u.path)),
  ];
  const test = skills.find((s) => s.id === "test");
  const practise = () => test && weakNotes.length && void runSkillOnPicked(test, weakNotes);

  const title = topic.title || "Comprehension";
  const loading = texts === null;
  return (
    <section className="heatmap-card" aria-label={`Comprehension heatmap: ${title}`}>
      <header className="heatmap-head">
        <span className="heatmap-icon" aria-hidden>
          <Brain size={18} />
        </span>
        <div className="heatmap-heading">
          <h3>{title}</h3>
          <span className="heatmap-sub">
            {columns.length} {columns.length === 1 ? "note" : "notes"}
            {topic.unit === "sections" && ` · ${units.length} sections`}
          </span>
        </div>
        {p.onUnitChange && (
          <div className="heatmap-segmented" role="radiogroup" aria-label="Squares are">
            {(["notes", "sections"] as const).map((m) => (
              <label key={m}>
                <input
                  type="radio"
                  name={unitGroup}
                  checked={topic.unit === m}
                  onChange={() => p.onUnitChange!(m)}
                />
                {m === "notes" ? "Notes" : "Sections"}
              </label>
            ))}
          </div>
        )}
        {p.actions}
      </header>

      <div className="heatmap-stats">
        <div>
          <strong>{percent(stats.mastered, stats.total)}</strong>
          <span className="heatmap-unit">%</span>
          <span className="heatmap-label">Mastered</span>
        </div>
        <div>
          <strong>{stats.covered}</strong>
          <span className="heatmap-unit">/ {stats.total}</span>
          <span className="heatmap-label">Items covered</span>
        </div>
      </div>

      {loading ? (
        <p className="heatmap-empty">Reading notes…</p>
      ) : !units.length ? (
        <p className="heatmap-empty">
          {topic.sources.length
            ? "No notes in these sources yet."
            : "Add notes or folders to see how well you know them."}
        </p>
      ) : (
        <div
          className="heatmap-grid"
          ref={grid}
          role="group"
          aria-label={brush === null ? "Squares: Enter opens" : "Squares: Enter sets the level"}
          data-painting={brush !== null || undefined}
          data-unit={topic.unit}
          onMouseLeave={() => setTip(null)}
        >
          {shown.map((col, c) => (
            <div
              key={`${col.path}-${c}`}
              className="heatmap-col"
              role="group"
              aria-label={col.name}
            >
              <span className="heatmap-col-label" title={col.name} aria-hidden>
                {col.label}
              </span>
              {col.units.map((u) => {
                const i = flat.indexOf(u);
                const l = levelByKey.get(u.key);
                return (
                  <button
                    key={u.key}
                    type="button"
                    className="heatmap-square"
                    data-level={l?.level ?? 0}
                    data-inherited={l?.inherited === "note" || undefined}
                    data-manual={l?.rec?.manual ? true : undefined}
                    tabIndex={i === Math.min(focus, flat.length - 1) ? 0 : -1}
                    aria-label={describe(u)}
                    onClick={() => activate(u)}
                    onKeyDown={(e) => onKey(e, i)}
                    onFocus={(e) => {
                      setFocus(i);
                      showTip(u, e.currentTarget);
                    }}
                    onBlur={() => setTip(null)}
                    onMouseEnter={(e) => showTip(u, e.currentTarget)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      )}
      {tip && (
        <div className="heatmap-tip" style={{ left: tip.x, top: tip.y }} aria-hidden>
          {describe(tip.unit)}
        </div>
      )}

      <div className="heatmap-legend">
        <span className="heatmap-legend-item">
          <i className="heatmap-swatch" data-level={0} /> No data
        </span>
        <span className="heatmap-legend-scale">
          Bad
          {LEVELS.map((l) => (
            <i key={l.level} className="heatmap-swatch" data-level={l.level} title={l.label} />
          ))}
          Best
        </span>
      </div>

      <ol className="heatmap-counts" aria-label="Items per level">
        {LEVELS.map((l) => (
          <li key={l.level}>
            {brush !== null ? (
              <button
                type="button"
                aria-pressed={brush === l.level}
                onClick={() => setBrush(l.level)}
                title={`Click squares to mark them ${l.label}`}
              >
                <strong data-level={l.level}>{stats.counts[l.level - 1]}</strong>
                <i data-level={l.level} />
                <span>{l.label}</span>
              </button>
            ) : (
              <>
                <strong data-level={l.level}>{stats.counts[l.level - 1]}</strong>
                <i data-level={l.level} />
                <span>{l.label}</span>
              </>
            )}
          </li>
        ))}
      </ol>

      <footer className="heatmap-foot">
        <button
          type="button"
          aria-pressed={brush !== null}
          onClick={() => setBrush(brush === null ? 3 : null)}
          title="Click squares to set their level yourself"
        >
          <Paintbrush size={14} aria-hidden /> {brush === null ? "Set levels" : "Done"}
        </button>
        {brush !== null && (
          <>
            <span className="muted">
              Pick a level above, then click squares. Keys 1–5 set, 0 clears.
            </span>
            <button type="button" aria-pressed={brush === 0} onClick={() => setBrush(0)}>
              Clear mark
            </button>
          </>
        )}
        {brush === null && test && (
          <button
            type="button"
            disabled={!weakNotes.length}
            onClick={practise}
            title={
              weakNotes.length
                ? "Make a Practice test from the notes marked Bad or Weak. Notes kept from AI are left out."
                : "Nothing is marked Bad or Weak yet."
            }
          >
            <Sparkles size={14} aria-hidden /> Practise weak spots
          </button>
        )}
      </footer>
    </section>
  );
}
