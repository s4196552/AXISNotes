import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ListChecks } from "lucide-react";
import { ViewHeader } from "../tabs/ViewHeader";
import { backend, isBackendError, type TaskRef } from "../../ipc";
import { useAppStore } from "../../app/store";
import { formatDate } from "../../lib/dates";
import { plainInline } from "../../lib/inlineMarkdown";
import { InlineText } from "./InlineText";
import { type Bucket, BUCKETS, bucketOf, matchesFilter, PRIORITY } from "./taskModel";
import { toggleTask } from "./toggleTask";
import { TaskTimerButton } from "../time/TimerControls";
import "./tasks.css";

// Every task in the vault, grouped by due date. Checking a task edits its note.

const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

export function TasksView() {
  const indexVersion = useAppStore((s) => s.indexVersion);
  const [tasks, setTasks] = useState<TaskRef[] | null>(null);
  const [query, setQuery] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const today = formatDate(new Date(), "YYYY-MM-DD");

  useEffect(() => {
    let cancelled = false;
    backend.listTasks().then(
      (t) => !cancelled && setTasks(t),
      (e: unknown) =>
        !cancelled && useAppStore.getState().setError(isBackendError(e) ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [indexVersion]);

  const groups = useMemo(() => {
    const out = new Map<Bucket, TaskRef[]>(BUCKETS.map((b) => [b.id, []]));
    for (const t of tasks ?? []) {
      if (query && !matchesFilter(t, query)) continue;
      out.get(bucketOf(t, today))!.push(t);
    }
    return out;
  }, [tasks, query, today]);

  const open = [...groups.entries()]
    .filter(([b]) => b !== "done")
    .reduce((n, [, list]) => n + list.length, 0);

  async function toggle(task: TaskRef) {
    setBusy(`${task.path}:${task.line}`);
    try {
      await toggleTask(task, today);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tasks-view">
      <ViewHeader icon={ListChecks} title="Tasks">
        <input
          type="search"
          aria-label="Filter tasks"
          placeholder="Filter: text, tag:x, path:x"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label>
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
          />
          Show done
        </label>
        <span className="graph-count muted" aria-live="polite">
          {tasks ? `${open} open` : "Loading…"}
        </span>
      </ViewHeader>

      <div className="tasks-body">
        {tasks && tasks.length === 0 && (
          <p className="muted tasks-empty">
            No tasks yet. Write <code>- [ ] something</code> in any note; add{" "}
            <code>📅 2026-10-01</code> for a due date and <code>⏫</code> / <code>🔼</code> /{" "}
            <code>🔽</code> for priority.
          </p>
        )}
        {BUCKETS.filter((b) => b.id !== "done" || showDone).map(({ id, label }) => {
          const list = groups.get(id)!;
          if (list.length === 0) return null;
          return (
            <section key={id} className={`tasks-group tasks-${id}`} aria-label={label}>
              <h2>
                {label} <span className="muted">{list.length}</span>
              </h2>
              <ul>
                {list.map((t) => {
                  const key = `${t.path}:${t.line}`;
                  return (
                    <li key={key} className={t.done ? "done" : undefined}>
                      <input
                        type="checkbox"
                        checked={t.done}
                        disabled={busy === key}
                        aria-label={`${t.done ? "Reopen" : "Complete"}: ${plainInline(t.text)}`}
                        onChange={() => void toggle(t)}
                      />
                      <span className="tasks-text">
                        {t.text ? (
                          <InlineText text={t.text} from={t.path} />
                        ) : (
                          <span className="muted">(empty)</span>
                        )}
                      </span>
                      {PRIORITY[t.priority] && (
                        <span
                          className={`tasks-priority p${t.priority}`}
                          title={PRIORITY[t.priority]!.label}
                          aria-label={PRIORITY[t.priority]!.label}
                        >
                          {PRIORITY[t.priority]!.mark}
                        </span>
                      )}
                      {t.due && (
                        <span className="tasks-due" title="Due date">
                          <CalendarDays size={12} /> {t.due}
                        </span>
                      )}
                      {!t.done && <TaskTimerButton path={t.path} task={t.text} />}
                      <button
                        className="tasks-source"
                        title={`${t.path}, line ${t.line}`}
                        onClick={() => useAppStore.getState().openFile(t.path, { line: t.line })}
                      >
                        {noteName(t.path)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
