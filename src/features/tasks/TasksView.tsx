import { useEffect, useMemo, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { backend, isBackendError, type TaskRef } from "../../ipc";
import { useAppStore } from "../../app/store";
import { formatDate } from "../../lib/dates";
import { type Bucket, BUCKETS, bucketOf, matchesFilter, PRIORITY } from "./taskModel";
import { setTaskDone } from "../../lib/tasks";
import { editNote } from "../files/editNote";
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
    const key = `${task.path}:${task.line}`;
    setBusy(key);
    try {
      const changed = await editNote(task.path, (text) => {
        const lines = text.split("\n");
        const current = lines[task.line - 1];
        if (current === undefined || current.replace(/\r$/, "") !== task.raw) return null;
        const cr = current.endsWith("\r") ? "\r" : "";
        lines[task.line - 1] = setTaskDone(task.raw, !task.done, today) + cr;
        return lines.join("\n");
      });
      if (!changed) {
        useAppStore.getState().notify("That task changed in its note; the list was refreshed.");
        useAppStore.getState().bumpIndex();
      }
    } catch (e) {
      useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="tasks-view">
      <header className="graph-toolbar tasks-toolbar">
        <strong>Tasks</strong>
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
        <button
          className="graph-close"
          aria-label="Close tasks"
          onClick={() => useAppStore.getState().setMainView("note")}
        >
          <X size={16} />
        </button>
      </header>

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
                        aria-label={`${t.done ? "Reopen" : "Complete"}: ${t.text}`}
                        onChange={() => void toggle(t)}
                      />
                      <span className="tasks-text">
                        {t.text || <span className="muted">(empty)</span>}
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
