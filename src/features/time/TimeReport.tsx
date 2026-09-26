import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { backend, isBackendError, type TimeEntry } from "../../ipc";
import { useAppStore } from "../../app/store";
import { formatDate } from "../../lib/dates";
import { isNotePath } from "../../lib/markdown";
import { editNote } from "../files/editNote";
import { type GroupBy, noteLabel, type Preset, presetRange, type Range, summarize } from "./report";
import { appendEntry, durationMs, formatDuration, parseStamp, stamp } from "./timeLog";
import { useTimer } from "./timer";
import "./time.css";

const PRESETS: { id: Preset | "custom"; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "30d", label: "Last 30 days" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom…" },
];

const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "note", label: "Note" },
  { id: "tag", label: "Tag" },
  { id: "project", label: "Project" },
  { id: "day", label: "Day" },
];

const report = (e: unknown) =>
  useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));

export function TimeReport() {
  const indexVersion = useAppStore((s) => s.indexVersion);
  const running = useTimer((s) => s.running);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [preset, setPreset] = useState<Preset | "custom">("week");
  const [custom, setCustom] = useState<Range>(() => presetRange("week"));
  const [groupBy, setGroupBy] = useState<GroupBy>("note");

  useEffect(() => {
    let cancelled = false;
    backend.timeEntries().then((e) => !cancelled && setEntries(e), report);
    return () => {
      cancelled = true;
    };
  }, [indexVersion, running]);

  const range = preset === "custom" ? custom : presetRange(preset);
  const data = useMemo(
    () => summarize(entries ?? [], groupBy, range),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, groupBy, range.from, range.to],
  );
  const max = Math.max(1, ...data.rows.map((r) => r.ms));
  const open = (path: string) => useAppStore.getState().openFile(path);

  return (
    <div className="time-view">
      <header className="graph-toolbar">
        <strong>Time</strong>
        <select
          aria-label="Date range"
          value={preset}
          onChange={(e) => {
            const p = e.target.value as Preset | "custom";
            if (p === "custom" && preset !== "custom") setCustom(range);
            setPreset(p);
          }}
        >
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        {preset === "custom" && (
          <>
            <input
              type="date"
              aria-label="From"
              value={custom.from ?? ""}
              onChange={(e) => setCustom({ ...custom, from: e.target.value || null })}
            />
            <input
              type="date"
              aria-label="To"
              value={custom.to ?? ""}
              onChange={(e) => setCustom({ ...custom, to: e.target.value || null })}
            />
          </>
        )}
        <label>
          Group by
          <select
            aria-label="Group by"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            {GROUPS.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <span className="graph-count" aria-live="polite">
          Total <strong aria-label="Total time">{formatDuration(data.totalMs)}</strong>
        </span>
        <button
          className="graph-close"
          aria-label="Close time report"
          onClick={() => useAppStore.getState().setMainView("note")}
        >
          <X size={16} />
        </button>
      </header>

      <div className="time-body">
        {entries && data.rows.length === 0 && (
          <p className="muted">
            No time logged in this range. Start a timer from a note's header or a task, or log time
            below.
          </p>
        )}
        {data.rows.length > 0 && (
          <table className="time-table" aria-label="Time by group">
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    {groupBy === "note" ? (
                      <button className="time-link" onClick={() => open(r.key)}>
                        {r.label}
                      </button>
                    ) : (
                      r.label
                    )}
                  </th>
                  <td className="time-bar-cell">
                    <span className="time-bar" style={{ width: `${(r.ms / max) * 100}%` }} />
                  </td>
                  <td className="time-ms">{formatDuration(r.ms)}</td>
                  <td className="time-count muted">
                    {r.entries} {r.entries === 1 ? "entry" : "entries"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {data.entries.length > 0 && (
          <details className="time-entries">
            <summary>Entries ({data.entries.length})</summary>
            <ul>
              {[...data.entries].reverse().map((e, i) => (
                <li key={`${e.path}:${e.start}:${i}`}>
                  <span className="muted">{e.start.replace("T", " ").slice(0, 16)}</span>
                  <span className="time-ms">
                    {e.end ? formatDuration(durationMs(e)) : "running"}
                  </span>
                  <button className="time-link" onClick={() => open(e.path)}>
                    {noteLabel(e.path)}
                  </button>
                  {e.task && <span>{e.task}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}

        <LogTimeForm />
      </div>
    </div>
  );
}

/** Add a finished entry by hand. */
function LogTimeForm() {
  const notes = useAppStore((s) => s.notes);
  const activePath = useAppStore((s) => s.activePath);
  const [path, setPath] = useState(activePath && isNotePath(activePath) ? activePath : "");
  const [date, setDate] = useState(() => formatDate(new Date(), "YYYY-MM-DD"));
  const [time, setTime] = useState(() => formatDate(new Date(), "HH:mm"));
  const [minutes, setMinutes] = useState("30");
  const [task, setTask] = useState("");
  const notePaths = notes.map((n) => n.path).filter(isNotePath);
  const start = parseStamp(`${date}T${time}`);
  const mins = Number(minutes);
  const valid = notePaths.includes(path) && start !== null && Number.isFinite(mins) && mins > 0;

  return (
    <form
      className="time-log-form"
      aria-label="Log time"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const end = new Date(start.getTime() + mins * 60_000);
        editNote(path, (text) =>
          appendEntry(text, {
            start: stamp(start),
            end: stamp(end),
            task: task.trim() || undefined,
          }),
        ).then(() => {
          setTask("");
          useAppStore
            .getState()
            .notify(`Logged ${formatDuration(mins * 60_000)} on ${noteLabel(path)}.`);
        }, report);
      }}
    >
      <strong>Log time</strong>
      <input
        aria-label="Note"
        list="time-notes"
        placeholder="Note path"
        value={path}
        onChange={(e) => setPath(e.target.value)}
      />
      <datalist id="time-notes">
        {notePaths.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      <input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} />
      <input
        type="time"
        aria-label="Start time"
        value={time}
        onChange={(e) => setTime(e.target.value)}
      />
      <input
        type="number"
        aria-label="Minutes"
        min={1}
        value={minutes}
        onChange={(e) => setMinutes(e.target.value)}
      />
      <input
        aria-label="Task (optional)"
        placeholder="Task (optional)"
        value={task}
        onChange={(e) => setTask(e.target.value)}
      />
      <button type="submit" className="primary" disabled={!valid}>
        Log
      </button>
    </form>
  );
}
