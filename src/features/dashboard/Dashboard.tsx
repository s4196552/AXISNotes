import { createElement, type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  Folder,
  History,
  House,
  LayoutDashboard,
  ListChecks,
  Pin,
  Plus,
  RotateCcw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { backend, isBackendError, type TaskRef, type VaultEntry } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { dailyNotePath, ensureDailyNote, openDailyNote } from "../commands/actions";
import { editNote } from "../files/editNote";
import { Picker, type PickerItem } from "../commands/Picker";
import { Calendar } from "../daily/Calendar";
import { EntryIcon } from "../icons/EntryIcon";
import { PRIORITY } from "../tasks/taskModel";
import { toggleTask } from "../tasks/toggleTask";
import { kindIcon } from "../tabs/tabInfo";
import { displayName } from "../filetree/treeModel";
import { saveWidgets, setDashboard } from "./setDashboard";
import {
  addDays,
  addWidget,
  appendToNote,
  dashboardFor,
  defaultDashboard,
  dueCounts,
  entriesByPath,
  fileCount,
  HOME,
  inScope,
  linkCandidates,
  moveWidget,
  nowIndex,
  recentFiles,
  removeWidget,
  selectDailyTasks,
  selectSchedule,
  type TaskGroup,
  taskGroup,
  type TaskRange,
  updateWidget,
  type Widget,
  WIDGET_TYPES,
  type WidgetType,
  widgetLabel,
} from "./dashboardModel";
import "./dashboard.css";

// The vault's Home and folder dashboards: a grid of widgets the user can add, remove and
// reorder. Layouts are saved in the vault config (see dashboardModel.ts).

const WIDGET_ICONS: Record<WidgetType, typeof Pin> = {
  calendar: CalendarDays,
  tasks: ListChecks,
  schedule: CalendarClock,
  links: Pin,
  recent: History,
};

const errorText = (e: unknown) => (isBackendError(e) ? e.message : String(e));
const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

const dayOf = (date: Date) => formatDate(date, "YYYY-MM-DD");
const dateOf = (day: string) => new Date(`${day}T00:00:00`);

/** Today's date, which moves on at midnight (and on waking, if the computer slept past it). */
function useDay(): string {
  const [day, setDay] = useState(() => dayOf(new Date()));
  useEffect(() => {
    const check = () => setDay(dayOf(new Date()));
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = window.setTimeout(check, midnight.getTime() - now.getTime());
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [day]);
  return day;
}

/** The time now as `HH:MM`, kept current while `enabled`. */
function useClock(enabled: boolean): string {
  const [now, setNow] = useState(() => formatDate(new Date(), "HH:mm"));
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(formatDate(new Date(), "HH:mm"));
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

/** The vault's tasks and today's date and daily note path, for the planning widgets. */
function useToday(enabled: boolean) {
  const indexVersion = useAppStore((s) => s.indexVersion);
  const dailyCfg = useConfig((s) => s.config.dailyNotes);
  const [tasks, setTasks] = useState<TaskRef[] | null>(null);
  const today = useDay();
  const dailyPath = dailyNotePath(dateOf(today), dailyCfg);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    backend.listTasks().then(
      (t) => !cancelled && setTasks(t),
      (e: unknown) => !cancelled && useAppStore.getState().setError(errorText(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, indexVersion]);

  return { tasks, today, dailyPath };
}

/** A note's text, or null while loading or when it doesn't exist. */
function useNote(path: string) {
  const indexVersion = useAppStore((s) => s.indexVersion);
  const exists = useAppStore((s) => s.notes.some((n) => n.path === path));
  const [note, setNote] = useState<{ path: string; content: string } | null>(null);
  useEffect(() => {
    if (!exists) return;
    let cancelled = false;
    backend.readFile(path).then(
      (f) => !cancelled && setNote({ path, content: f.content }),
      () => !cancelled && setNote(null),
    );
    return () => {
      cancelled = true;
    };
  }, [exists, path, indexVersion]);
  // A note since deleted, or another day's, isn't this one.
  return exists && note?.path === path ? note : null;
}

/** Add a line to the daily note for `day` (creating it from the template), where it fits. */
async function addToDailyNote(day: string, line: string): Promise<boolean> {
  try {
    const { path } = await ensureDailyNote(dateOf(day));
    await editNote(path, (text) => appendToNote(text, line));
    return true;
  } catch (e) {
    useAppStore.getState().setError(errorText(e));
    return false;
  }
}

export function Dashboard({ folder }: { folder: string }) {
  const saved = useConfig((s) => s.config.dashboards);
  const loaded = useConfig((s) => s.loaded);
  const vault = useAppStore((s) => s.vault);
  const tree = useAppStore((s) => s.tree);
  const [editing, setEditing] = useState(false);
  const dashboard = useMemo(() => dashboardFor(saved, folder), [saved, folder]);
  const entries = useMemo(() => entriesByPath(tree), [tree]);
  const widgets = dashboard?.widgets ?? [];
  // The calendar marks days with tasks due, so it needs the tasks too.
  const needsToday = widgets.some(
    (w) => w.type === "tasks" || w.type === "schedule" || w.type === "calendar",
  );
  const today = useToday(needsToday);

  const isHome = folder === HOME;
  const title = isHome ? "Home" : folder.slice(folder.lastIndexOf("/") + 1);
  const folderEntry = isHome ? tree : entries.get(folder);

  if (!loaded) return <div className="empty muted">Loading…</div>;
  if (!isHome && tree && !folderEntry) {
    return (
      <div className="dashboard">
        <p className="dashboard-empty muted">The folder “{folder}” no longer exists.</p>
      </div>
    );
  }

  return (
    <div className="dashboard" data-editing={editing ? "" : undefined}>
      <header className="dashboard-header">
        <span className="dashboard-title-icon" aria-hidden>
          {isHome ? <House size={22} /> : <LayoutDashboard size={22} />}
        </span>
        <div className="dashboard-heading">
          <h1>{title}</h1>
          <span className="muted">{isHome ? vault?.name : folder}</span>
        </div>
        {dashboard && (
          <div className="dashboard-actions">
            {editing && (
              <>
                <button
                  className="pill"
                  title="Put back the default widgets"
                  onClick={() => {
                    if (window.confirm("Replace this dashboard's widgets with the default ones?")) {
                      saveWidgets(folder, () => defaultDashboard().widgets);
                    }
                  }}
                >
                  <RotateCcw size={14} aria-hidden /> Reset
                </button>
                {!isHome && (
                  <button
                    className="pill"
                    title="Remove this folder's dashboard (its layout is kept if you add it back)"
                    onClick={() => {
                      setEditing(false);
                      setDashboard(folder, false);
                    }}
                  >
                    <Trash2 size={14} aria-hidden /> Remove dashboard
                  </button>
                )}
              </>
            )}
            <button
              className={editing ? "pill primary" : "pill"}
              aria-pressed={editing}
              onClick={() => setEditing(!editing)}
            >
              <Settings2 size={14} aria-hidden /> {editing ? "Done" : "Customize"}
            </button>
          </div>
        )}
      </header>

      {!dashboard ? (
        <NoDashboard folder={folder} entry={folderEntry ?? null} />
      ) : (
        <div className="dashboard-grid">
          {widgets.map((w, i) => (
            <WidgetFrame
              key={w.id}
              widget={w}
              folder={folder}
              editing={editing}
              first={i === 0}
              last={i === widgets.length - 1}
            >
              <WidgetBody widget={w} folder={folder} editing={editing} today={today} />
            </WidgetFrame>
          ))}
          {widgets.length === 0 && !editing && (
            <p className="dashboard-empty muted">
              No widgets. Choose <strong>Customize</strong> to add some.
            </p>
          )}
          {editing && <AddWidget folder={folder} />}
        </div>
      )}
    </div>
  );
}

/** A folder without a dashboard: offer one, and show what's in the folder meanwhile. */
function NoDashboard({ folder, entry }: { folder: string; entry: VaultEntry | null }) {
  const tree = useAppStore((s) => s.tree);
  const files = useMemo(() => recentFiles(tree, folder, 24), [tree, folder]);
  return (
    <div className="dashboard-grid">
      <section className="dashboard-widget wide dashboard-offer">
        <p>
          This folder has no dashboard.{" "}
          {entry?.children && <span className="muted">{fileCount(entry)} files inside.</span>}
        </p>
        <button className="pill primary" onClick={() => setDashboard(folder, true)}>
          <Plus size={14} aria-hidden /> Add dashboard
        </button>
      </section>
      {files.length > 0 && (
        <section className="dashboard-widget wide" aria-label="Recently changed">
          <h2 className="dashboard-widget-title">
            <History size={15} aria-hidden /> Recently changed
          </h2>
          <CardGrid paths={files.map((f) => f.path)} />
        </section>
      )}
    </div>
  );
}

function WidgetFrame(props: {
  widget: Widget;
  folder: string;
  editing: boolean;
  first: boolean;
  last: boolean;
  children: ReactNode;
}) {
  const { widget: w, folder, editing } = props;
  const Icon = WIDGET_ICONS[w.type];
  const label = widgetLabel(w);
  const wide = w.type === "links" || w.type === "recent";
  return (
    <section
      className={`dashboard-widget widget-${w.type}${wide ? " wide" : ""}`}
      aria-label={label}
    >
      <header className="dashboard-widget-header">
        <h2 className="dashboard-widget-title">
          <Icon size={15} aria-hidden />
          {editing && w.type === "links" ? (
            <input
              className="dashboard-title-input"
              aria-label="Widget title"
              defaultValue={w.title ?? ""}
              placeholder={label}
              onBlur={(e) => {
                const title = e.target.value.trim();
                if (title !== (w.title ?? "")) {
                  saveWidgets(folder, (ws) =>
                    updateWidget(ws, w.id, { title: title || undefined }),
                  );
                }
              }}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
            />
          ) : (
            label
          )}
        </h2>
        {editing && (
          <div className="dashboard-widget-tools">
            <button
              aria-label={`Move ${label} earlier`}
              title="Move earlier"
              disabled={props.first}
              onClick={() => saveWidgets(folder, (ws) => moveWidget(ws, w.id, -1))}
            >
              <ArrowUp size={14} />
            </button>
            <button
              aria-label={`Move ${label} later`}
              title="Move later"
              disabled={props.last}
              onClick={() => saveWidgets(folder, (ws) => moveWidget(ws, w.id, 1))}
            >
              <ArrowDown size={14} />
            </button>
            <button
              aria-label={`Remove ${label}`}
              title="Remove widget"
              onClick={() => saveWidgets(folder, (ws) => removeWidget(ws, w.id))}
            >
              <X size={14} />
            </button>
          </div>
        )}
      </header>
      {props.children}
    </section>
  );
}

function AddWidget({ folder }: { folder: string }) {
  return (
    <section className="dashboard-widget wide dashboard-add" aria-label="Add a widget">
      <h2 className="dashboard-widget-title">
        <Plus size={15} aria-hidden /> Add a widget
      </h2>
      <div className="dashboard-add-list">
        {WIDGET_TYPES.map(({ type, label, description }) => {
          const Icon = WIDGET_ICONS[type];
          return (
            <button
              key={type}
              className="dashboard-add-item"
              onClick={() => saveWidgets(folder, (ws) => addWidget(ws, type))}
            >
              <Icon size={16} aria-hidden />
              <span>
                <strong>{label}</strong>
                <span className="muted">{description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

type TodayData = ReturnType<typeof useToday>;

function WidgetBody(props: { widget: Widget; folder: string; editing: boolean; today: TodayData }) {
  const { widget, folder, today } = props;
  switch (widget.type) {
    case "calendar":
      return <CalendarWidget folder={folder} data={today} />;
    case "tasks":
      return <TasksWidget widget={widget} folder={folder} data={today} />;
    case "schedule":
      return <ScheduleWidget folder={folder} data={today} />;
    case "links":
      return <LinksWidget widget={widget} folder={folder} editing={props.editing} />;
    case "recent":
      return <RecentWidget folder={folder} />;
  }
}

function TaskCheck({ task, today }: { task: TaskRef; today: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <input
      type="checkbox"
      checked={task.done}
      disabled={busy}
      aria-label={`${task.done ? "Reopen" : "Complete"}: ${task.text}`}
      onChange={() => {
        setBusy(true);
        void toggleTask(task, today).finally(() => setBusy(false));
      }}
    />
  );
}

function SourceButton({ path, line }: { path: string; line: number }) {
  return (
    <button
      className="dashboard-source"
      title={`${path}, line ${line}`}
      onClick={() => useAppStore.getState().openFile(path, { line })}
    >
      {noteName(path)}
    </button>
  );
}

function CalendarWidget({ folder, data }: { folder: string; data: TodayData }) {
  const marks = useMemo(
    () => (data.tasks ? dueCounts(data.tasks, folder) : undefined),
    [data.tasks, folder],
  );
  // Keyed by the day, so it moves to the new month at midnight.
  return <Calendar key={data.today} today={dateOf(data.today)} marks={marks} />;
}

/** A one-line form that adds what's typed to a daily note; it clears once added. */
function QuickAdd(props: {
  label: string;
  placeholder: string;
  withTime?: boolean;
  onAdd(text: string, time: string): Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [time, setTime] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value || busy || (props.withTime && !time)) return;
    setBusy(true);
    void props.onAdd(value, time).then((ok) => {
      setBusy(false);
      if (ok) {
        setText("");
        setTime("");
      }
    });
  };
  return (
    <form className="dashboard-quick-add" onSubmit={submit}>
      {props.withTime && (
        <input
          type="time"
          aria-label="Time"
          value={time}
          required
          onChange={(e) => setTime(e.target.value)}
        />
      )}
      <input
        aria-label={props.label}
        placeholder={props.placeholder}
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
      />
      <button type="submit" title={props.label} disabled={busy}>
        <Plus size={14} aria-hidden />
        <span className="visually-hidden">{props.label}</span>
      </button>
    </form>
  );
}

const GROUP_LABELS: Record<TaskGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  upcoming: "Next 7 days",
};

function TaskRow({ task: t, today }: { task: TaskRef; today: string }) {
  const group = taskGroup(t, today);
  return (
    <li className={t.done ? "done" : undefined}>
      <TaskCheck task={t} today={today} />
      <span className="dashboard-text">{t.text || <span className="muted">(empty)</span>}</span>
      {PRIORITY[t.priority] && (
        <span title={PRIORITY[t.priority]!.label} aria-label={PRIORITY[t.priority]!.label}>
          {PRIORITY[t.priority]!.mark}
        </span>
      )}
      {group !== "today" && t.due && (
        <span
          className={group === "overdue" ? "dashboard-overdue" : "dashboard-due"}
          title={group === "overdue" ? "Overdue" : "Due"}
        >
          {formatDate(dateOf(t.due), group === "overdue" ? "MMM D" : "ddd D")}
        </span>
      )}
      <SourceButton path={t.path} line={t.line} />
    </li>
  );
}

function TasksWidget(props: { widget: Widget; folder: string; data: TodayData }) {
  const { widget, folder, data } = props;
  const { tasks, today, dailyPath } = data;
  const range: TaskRange = widget.options?.range ?? "today";
  const list = useMemo(() => {
    if (!tasks) return null;
    const horizon = range === "week" ? addDays(today, 7) : today;
    return selectDailyTasks(tasks, { today, folder, dailyPath, horizon });
  }, [tasks, today, folder, dailyPath, range]);
  if (!list) return <p className="muted dashboard-note">Loading…</p>;

  const open = list.filter((t) => !t.done).length;
  const setRange = (r: TaskRange) =>
    saveWidgets(folder, (ws) =>
      updateWidget(ws, widget.id, { options: { ...widget.options, range: r } }),
    );
  // The week under Overdue / Today / Next 7 days headings; today's tasks as one list.
  const groups: [TaskGroup | null, TaskRef[]][] =
    range === "week"
      ? (["overdue", "today", "upcoming"] as const)
          .map((g): [TaskGroup, TaskRef[]] => [g, list.filter((t) => taskGroup(t, today) === g)])
          .filter(([, ts]) => ts.length > 0)
      : [[null, list]];
  const none = range === "week" ? "Nothing due this week." : "Nothing due today.";

  return (
    <>
      <div className="dashboard-note dashboard-row">
        <span className="muted">{open === 0 ? none : `${open} to do`}</span>
        <div className="dashboard-segmented" role="group" aria-label="Show tasks for">
          {(["today", "week"] as const).map((r) => (
            <button key={r} aria-pressed={range === r} onClick={() => setRange(r)}>
              {r === "today" ? "Today" : "7 days"}
            </button>
          ))}
        </div>
      </div>
      {groups.map(([g, ts]) => (
        <div key={g ?? "all"}>
          {g && <h3 className="dashboard-group">{GROUP_LABELS[g]}</h3>}
          <ul className="dashboard-list">
            {ts.map((t) => (
              <TaskRow key={`${t.path}:${t.line}`} task={t} today={today} />
            ))}
          </ul>
        </div>
      ))}
      {inScope(dailyPath, folder) && (
        <QuickAdd
          label="Add a task"
          placeholder="Add a task to today's note…"
          onAdd={(text) => addToDailyNote(today, `- [ ] ${text}`)}
        />
      )}
    </>
  );
}

function ScheduleWidget({ folder, data }: { folder: string; data: TodayData }) {
  const { tasks, today } = data;
  const dailyCfg = useConfig((s) => s.config.dailyNotes);
  const [offset, setOffset] = useState(0);
  const day = addDays(today, offset);
  const isToday = offset === 0;
  const dailyPath = dailyNotePath(dateOf(day), dailyCfg);
  const daily = useNote(dailyPath);
  const now = useClock(isToday);
  const items = useMemo(
    () => (tasks ? selectSchedule({ tasks, today: day, folder, daily }) : null),
    [tasks, day, folder, daily],
  );
  const canAdd = inScope(dailyPath, folder);
  const nowAt = isToday && items ? nowIndex(items, now) : -1;
  const nowLine = (
    <li key="now" className="dashboard-now" role="separator" aria-label={`Now, ${now}`}>
      <span>{now}</span>
    </li>
  );

  return (
    <>
      <div className="dashboard-note dashboard-row">
        <span className="muted">{formatDate(dateOf(day), "dddd, MMMM D")}</span>
        <div className="dashboard-day-nav">
          <button
            aria-label="Previous day"
            title="Previous day"
            onClick={() => setOffset(offset - 1)}
          >
            <ChevronLeft size={14} />
          </button>
          <button disabled={isToday} onClick={() => setOffset(0)}>
            Today
          </button>
          <button aria-label="Next day" title="Next day" onClick={() => setOffset(offset + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
      {!items ? (
        <p className="muted dashboard-note">Loading…</p>
      ) : items.length === 0 ? (
        <div className="dashboard-hint muted">
          {canAdd ? (
            <p>
              Nothing scheduled. Add a time below, or start a line in the daily note with one, like{" "}
              <code>- 09:00 Standup</code>.
            </p>
          ) : (
            <p>
              Nothing scheduled. Give a task in this folder that&apos;s due that day a time, like{" "}
              <code>- [ ] 14:00 Lab 📅 {day}</code>.
            </p>
          )}
          {canAdd && isToday && (
            <button className="pill" onClick={() => void openDailyNote()}>
              <CalendarDays size={14} aria-hidden /> Open today&apos;s note
            </button>
          )}
        </div>
      ) : (
        <ol className="dashboard-list dashboard-schedule">
          {items.flatMap((it, i) => {
            const classes = [it.task?.done && "done", i < nowAt && "past"].filter(Boolean);
            const row = (
              <li key={`${it.path}:${it.line}`} className={classes.join(" ") || undefined}>
                <time className="dashboard-time">
                  <Clock size={12} aria-hidden /> {it.start}
                  {it.end && `–${it.end}`}
                </time>
                {it.task && <TaskCheck task={it.task} today={today} />}
                <span className="dashboard-text">
                  {it.rest || <span className="muted">(no title)</span>}
                </span>
                <SourceButton path={it.path} line={it.line} />
              </li>
            );
            return i === nowAt ? [nowLine, row] : [row];
          })}
          {nowAt === items.length && nowLine}
        </ol>
      )}
      {canAdd && (
        <QuickAdd
          label="Add to schedule"
          placeholder={
            isToday ? "Add to today…" : `Add to ${formatDate(dateOf(day), "ddd, MMM D")}…`
          }
          withTime
          onAdd={(text, time) => addToDailyNote(day, `- ${time} ${text}`)}
        />
      )}
    </>
  );
}

function LinksWidget(props: { widget: Widget; folder: string; editing: boolean }) {
  const { widget, folder, editing } = props;
  const tree = useAppStore((s) => s.tree);
  const [picking, setPicking] = useState<{ replace?: string } | null>(null);
  const links = useMemo(() => widget.links ?? [], [widget.links]);

  const items = useMemo<PickerItem[]>(() => {
    if (!picking) return [];
    return linkCandidates(tree, folder)
      .filter((e) => !links.includes(e.path))
      .map((e) => ({
        id: e.path,
        label: displayName(e),
        detail: `${e.kind === "dir" ? "Folder" : "File"}${e.path.includes("/") ? ` · ${e.path.slice(0, e.path.lastIndexOf("/"))}` : ""}`,
        keywords: e.path,
      }));
  }, [picking, tree, folder, links]);

  const setLinks = (fn: (l: string[]) => string[]) =>
    saveWidgets(folder, (ws) => updateWidget(ws, widget.id, { links: fn(widget.links ?? []) }));

  return (
    <>
      <CardGrid
        paths={links}
        editing={editing}
        onRemove={(p) => setLinks((l) => l.filter((x) => x !== p))}
        onRelink={(p) => setPicking({ replace: p })}
      >
        <button className="dashboard-card dashboard-card-add" onClick={() => setPicking({})}>
          <Plus size={18} aria-hidden />
          <span>Pin a file or folder</span>
        </button>
      </CardGrid>
      {picking && (
        <Picker
          title={picking.replace ? `Relink “${picking.replace}”` : "Pin a file or folder"}
          placeholder={folder ? `Find in ${folder}…` : "Find a file or folder…"}
          items={items}
          limit={100}
          onClose={() => setPicking(null)}
          onPick={(item) => {
            const { replace } = picking;
            setPicking(null);
            setLinks((l) =>
              replace ? l.map((x) => (x === replace ? item.id : x)) : [...l, item.id],
            );
          }}
        />
      )}
    </>
  );
}

function RecentWidget({ folder }: { folder: string }) {
  const tree = useAppStore((s) => s.tree);
  const files = useMemo(() => recentFiles(tree, folder), [tree, folder]);
  if (!files.length) return <p className="muted dashboard-note">No files yet.</p>;
  return <CardGrid paths={files.map((f) => f.path)} />;
}

/** Cards for files and folders, like a notebook grid: icon, name, date · details. */
function CardGrid(props: {
  paths: string[];
  editing?: boolean;
  onRemove?(path: string): void;
  onRelink?(path: string): void;
  children?: ReactNode;
}) {
  const tree = useAppStore((s) => s.tree);
  const entries = useMemo(() => entriesByPath(tree), [tree]);
  return (
    <div className="dashboard-cards">
      {props.paths.map((p) => (
        <Card
          key={p}
          path={p}
          entry={entries.get(p) ?? null}
          editing={props.editing}
          onRemove={props.onRemove}
          onRelink={props.onRelink}
        />
      ))}
      {props.children}
    </div>
  );
}

function latestChange(e: VaultEntry): number {
  return e.children ? Math.max(e.modifiedMs, ...e.children.map(latestChange)) : e.modifiedMs;
}

function Card(props: {
  path: string;
  entry: VaultEntry | null;
  editing?: boolean;
  onRemove?(path: string): void;
  onRelink?(path: string): void;
}) {
  const { path, entry } = props;
  const customIcon = useConfig((s) => s.config.folderIcons[path]);
  const hasDashboard = useConfig(
    (s) => entry?.kind === "dir" && dashboardFor(s.config.dashboards, path) !== null,
  );
  const name = entry ? displayName(entry) : path.slice(path.lastIndexOf("/") + 1);
  // Looked up from a fixed table, not created during render.
  const fallback = createElement(
    entry?.kind === "dir" ? Folder : (kindIcon({ path, view: "note" }) ?? Folder),
    { size: 20, "aria-hidden": true },
  );

  let meta: string;
  if (!entry) meta = "Missing · relink or remove";
  else if (entry.kind === "dir") {
    const n = fileCount(entry);
    meta = `${formatDate(new Date(latestChange(entry)), "MMM D, YYYY")} · ${n} file${n === 1 ? "" : "s"}`;
  } else {
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    meta = `${formatDate(new Date(entry.modifiedMs), "MMM D, YYYY")}${dir ? ` · ${dir}` : ""}`;
  }

  const open = (newTab: boolean) => {
    const store = useAppStore.getState();
    if (!entry) props.onRelink?.(path);
    else if (entry.kind === "dir") store.openDashboard(path, { newTab });
    else store.openFile(path, undefined, { newTab });
  };

  return (
    <div className={`dashboard-card${entry ? "" : " missing"}`}>
      <button
        className="dashboard-card-main"
        title={path}
        onClick={(e) => open(e.ctrlKey || e.metaKey)}
        onAuxClick={(e) => e.button === 1 && open(true)}
      >
        <span className="dashboard-card-icon">
          {customIcon ? <EntryIcon icon={customIcon} size={20} fallback={fallback} /> : fallback}
        </span>
        <span className="dashboard-card-name">{name}</span>
        <span className="dashboard-card-meta muted">
          {meta}
          {hasDashboard && (
            <LayoutDashboard
              size={11}
              aria-label=", has a dashboard"
              className="dashboard-card-badge"
            />
          )}
        </span>
      </button>
      {props.onRemove && (
        <div className="dashboard-card-tools">
          {!entry && props.onRelink && (
            <button
              aria-label={`Relink ${name}`}
              title="Relink"
              onClick={() => props.onRelink!(path)}
            >
              <RotateCcw size={13} />
            </button>
          )}
          <button
            aria-label={`Unpin ${name}`}
            title="Unpin"
            onClick={() => props.onRemove!(path)}
            data-always={props.editing ? "" : undefined}
          >
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
