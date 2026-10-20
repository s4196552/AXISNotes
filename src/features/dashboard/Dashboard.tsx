import { createElement, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CalendarClock,
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
import { dailyNotePath, openDailyNote } from "../commands/actions";
import { Picker, type PickerItem } from "../commands/Picker";
import { Calendar } from "../daily/Calendar";
import { EntryIcon } from "../icons/EntryIcon";
import { PRIORITY } from "../tasks/taskModel";
import { toggleTask } from "../tasks/toggleTask";
import { kindIcon } from "../tabs/tabInfo";
import { displayName } from "../filetree/treeModel";
import { saveWidgets, setDashboard } from "./setDashboard";
import {
  addWidget,
  dashboardFor,
  defaultDashboard,
  entriesByPath,
  fileCount,
  HOME,
  inScope,
  linkCandidates,
  moveWidget,
  recentFiles,
  removeWidget,
  selectDailyTasks,
  selectSchedule,
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

/** Tasks and today's daily note, shared by the tasks and schedule widgets. */
function useToday(enabled: boolean) {
  const indexVersion = useAppStore((s) => s.indexVersion);
  const notes = useAppStore((s) => s.notes);
  const dailyCfg = useConfig((s) => s.config.dailyNotes);
  const [tasks, setTasks] = useState<TaskRef[] | null>(null);
  const [daily, setDaily] = useState<{ path: string; content: string } | null>(null);
  const now = new Date();
  const today = formatDate(now, "YYYY-MM-DD");
  const dailyPath = dailyNotePath(now, dailyCfg);
  const dailyExists = notes.some((n) => n.path === dailyPath);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    backend.listTasks().then(
      (t) => !cancelled && setTasks(t),
      (e: unknown) => !cancelled && useAppStore.getState().setError(errorText(e)),
    );
    if (dailyExists) {
      backend.readFile(dailyPath).then(
        (f) => !cancelled && setDaily({ path: dailyPath, content: f.content }),
        () => !cancelled && setDaily(null),
      );
    }
    return () => {
      cancelled = true;
    };
  }, [enabled, indexVersion, dailyPath, dailyExists]);

  // Yesterday's note (after midnight) or a note since deleted isn't today's.
  const current = dailyExists && daily?.path === dailyPath ? daily : null;
  return { tasks, daily: current, today, dailyPath };
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
  const needsToday = widgets.some((w) => w.type === "tasks" || w.type === "schedule");
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
      return <Calendar />;
    case "tasks":
      return <TasksWidget folder={folder} data={today} />;
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

function TasksWidget({ folder, data }: { folder: string; data: TodayData }) {
  const { tasks, today, dailyPath } = data;
  const list = useMemo(
    () => (tasks ? selectDailyTasks(tasks, { today, folder, dailyPath }) : null),
    [tasks, today, folder, dailyPath],
  );
  if (!list) return <p className="muted dashboard-note">Loading…</p>;
  const open = list.filter((t) => !t.done).length;
  return (
    <>
      <p className="muted dashboard-note">{open === 0 ? "Nothing due today." : `${open} to do`}</p>
      <ul className="dashboard-list">
        {list.map((t) => {
          const overdue = !t.done && t.due !== null && t.due < today;
          return (
            <li key={`${t.path}:${t.line}`} className={t.done ? "done" : undefined}>
              <TaskCheck task={t} today={today} />
              <span className="dashboard-text">
                {t.text || <span className="muted">(empty)</span>}
              </span>
              {PRIORITY[t.priority] && (
                <span title={PRIORITY[t.priority]!.label} aria-label={PRIORITY[t.priority]!.label}>
                  {PRIORITY[t.priority]!.mark}
                </span>
              )}
              {overdue && (
                <span className="dashboard-overdue" title="Overdue">
                  {formatDate(new Date(`${t.due}T00:00:00`), "MMM D")}
                </span>
              )}
              <SourceButton path={t.path} line={t.line} />
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ScheduleWidget({ folder, data }: { folder: string; data: TodayData }) {
  const { tasks, daily, today } = data;
  const items = useMemo(
    () => (tasks ? selectSchedule({ tasks, today, folder, daily }) : null),
    [tasks, today, folder, daily],
  );
  if (!items) return <p className="muted dashboard-note">Loading…</p>;
  return (
    <>
      <p className="muted dashboard-note">{formatDate(new Date(), "dddd, MMMM D")}</p>
      {items.length === 0 ? (
        <div className="dashboard-hint muted">
          {inScope(data.dailyPath, folder) ? (
            <>
              <p>
                Nothing scheduled. Start a line in today&apos;s daily note with a time, like{" "}
                <code>- 09:00 Standup</code>, or give a task due today a time.
              </p>
              <button className="pill" onClick={() => void openDailyNote()}>
                <CalendarDays size={14} aria-hidden /> Open today&apos;s note
              </button>
            </>
          ) : (
            <p>
              Nothing scheduled. Give a task in this folder that&apos;s due today a time, like{" "}
              <code>- [ ] 14:00 Lab 📅 {today}</code>.
            </p>
          )}
        </div>
      ) : (
        <ol className="dashboard-list dashboard-schedule">
          {items.map((it) => (
            <li key={`${it.path}:${it.line}`} className={it.task?.done ? "done" : undefined}>
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
          ))}
        </ol>
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
