import type { TaskRef, VaultEntry } from "../../ipc";

// Dashboards: the vault's Home and any folder's own dashboard. Layouts live in the vault
// config (`.axisnotes/config.json` → `dashboards`), keyed by folder path, "" being Home.
// Pure functions; Dashboard.tsx reads and writes them through `useConfig`.

export type WidgetType = "contents" | "calendar" | "tasks" | "schedule" | "links" | "recent";

/** How far ahead a tasks widget looks: today (and overdue), or the next 7 days too. */
export type TaskRange = "today" | "week";

export interface WidgetOptions {
  /** Tasks widgets. Unset is "today". */
  range?: TaskRange;
  /** Recent widgets: how many files. Unset is 8. */
  count?: number;
}

/** How many of a subfolder's notes its module lists before "N more". */
export const MODULE_PREVIEW = 4;

/** Choices for a recent widget's file count. */
export const RECENT_COUNTS = [4, 8, 16, 24] as const;
export const DEFAULT_RECENT_COUNT = 8;

/** A widget's width: one grid column, or the whole row. */
export type WidgetSize = "normal" | "wide";

export interface Widget {
  id: string;
  type: WidgetType;
  /** The user's own title; unset shows the type's name. */
  title?: string;
  /** Vault paths of pinned files and folders (links widgets). */
  links?: string[];
  options?: WidgetOptions;
  /** Unset follows the type: pinned and recent widgets are wide, the rest normal. */
  size?: WidgetSize;
}

export interface Dashboard {
  /** A removed folder dashboard stays saved, switched off, so adding it back restores it. */
  enabled: boolean;
  widgets: Widget[];
}

export type Dashboards = Record<string, Dashboard>;

/** The vault's Home dashboard key. */
export const HOME = "";

export const WIDGET_TYPES: { type: WidgetType; label: string; description: string }[] = [
  {
    type: "contents",
    label: "Contents",
    description: "This folder's subfolders and notes, as modules",
  },
  { type: "calendar", label: "Calendar", description: "Month view of your daily notes" },
  { type: "tasks", label: "Today's tasks", description: "Due today, overdue and today's note" },
  { type: "schedule", label: "Day schedule", description: "Today's items that have a time" },
  { type: "links", label: "Pinned", description: "Shortcuts to files and folders" },
  { type: "recent", label: "Recent", description: "Recently changed files" },
];

const TYPES = new Set<string>(WIDGET_TYPES.map((w) => w.type));

export const widgetLabel = (w: Widget) =>
  w.title?.trim() || WIDGET_TYPES.find((t) => t.type === w.type)!.label;

let seq = 0;
export const widgetId = () => `w-${Date.now().toString(36)}-${(seq++).toString(36)}`;

export function makeWidget(type: WidgetType): Widget {
  return type === "links" ? { id: widgetId(), type, links: [] } : { id: widgetId(), type };
}

const HOME_DEFAULT = ["calendar", "tasks", "schedule", "links"] as const;

/**
 * A new dashboard. Home gets calendar, today's tasks, day schedule and pinned links; a
 * folder gets only its contents, as modules. The ids are fixed, so an unsaved Home reads
 * the same each time and its first edit finds its widget.
 */
export function defaultDashboard(folder: string = HOME): Dashboard {
  const types: readonly WidgetType[] = folder === HOME ? HOME_DEFAULT : ["contents"];
  return {
    enabled: true,
    widgets: types.map((type) => ({ ...makeWidget(type), id: `default-${type}` })),
  };
}

/**
 * Folder dashboards made before T-106 got Home's widgets. One still exactly as it was
 * created (never customized) becomes the folder default; anything the user changed stays.
 */
function upgradeFolderDefault(d: Dashboard): Dashboard {
  const untouched =
    d.widgets.length === HOME_DEFAULT.length &&
    d.widgets.every(
      (w, i) =>
        w.id === `default-${HOME_DEFAULT[i]}` &&
        w.type === HOME_DEFAULT[i] &&
        !w.title &&
        !w.options &&
        !w.size &&
        !w.links?.length,
    );
  return untouched ? { ...d, widgets: [{ id: "default-contents", type: "contents" }] } : d;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A saved dashboard, with anything malformed dropped (a hand-edited config stays usable). */
export function normalizeDashboard(raw: unknown): Dashboard | null {
  if (!isObject(raw) || !Array.isArray(raw.widgets)) return null;
  const seen = new Set<string>();
  const widgets: Widget[] = [];
  for (const w of raw.widgets) {
    if (!isObject(w) || typeof w.type !== "string" || !TYPES.has(w.type)) continue;
    let id = typeof w.id === "string" && w.id ? w.id : widgetId();
    if (seen.has(id)) id = widgetId();
    seen.add(id);
    const out: Widget = { id, type: w.type as WidgetType };
    if (typeof w.title === "string" && w.title) out.title = w.title;
    const options = normalizeOptions(w.options);
    if (options) out.options = options;
    if (w.size === "normal" || w.size === "wide") out.size = w.size;
    if (w.type === "links") {
      out.links = Array.isArray(w.links)
        ? [...new Set(w.links.filter((l): l is string => typeof l === "string"))]
        : [];
    }
    widgets.push(out);
  }
  return { enabled: raw.enabled !== false, widgets };
}

function normalizeOptions(raw: unknown): WidgetOptions | null {
  if (!isObject(raw)) return null;
  const out: WidgetOptions = {};
  if (raw.range === "today" || raw.range === "week") out.range = raw.range;
  if (typeof raw.count === "number" && Number.isInteger(raw.count)) {
    if (raw.count >= 1 && raw.count <= 48) out.count = raw.count;
  }
  return Object.keys(out).length ? out : null;
}

/** Whether a widget spans the whole row. */
export const isWide = (w: Widget) =>
  w.size ? w.size === "wide" : w.type === "links" || w.type === "recent" || w.type === "contents";

/** A folder's saved dashboard, read and brought up to date (see `upgradeFolderDefault`). */
function savedFolder(map: Dashboards | undefined, folder: string): Dashboard | null {
  const saved = normalizeDashboard(map?.[folder]);
  return saved && upgradeFolderDefault(saved);
}

/** The dashboard to show for `folder`: Home always has one; a folder only when added. */
export function dashboardFor(map: Dashboards | undefined, folder: string): Dashboard | null {
  if (folder === HOME) {
    const saved = normalizeDashboard(map?.[HOME]);
    return saved ? { ...saved, enabled: true } : defaultDashboard();
  }
  const saved = savedFolder(map, folder);
  return saved?.enabled ? saved : null;
}

export const hasDashboard = (map: Dashboards | undefined, folder: string) =>
  dashboardFor(map, folder) !== null;

/** Add a folder's dashboard: the one it had before if it was removed, else the default. */
export function addDashboard(map: Dashboards, folder: string): Dashboards {
  const saved = savedFolder(map, folder);
  return { ...map, [folder]: saved ? { ...saved, enabled: true } : defaultDashboard(folder) };
}

/** Remove a folder's dashboard. Its layout is kept (switched off) for adding it back. */
export function removeDashboard(map: Dashboards, folder: string): Dashboards {
  if (folder === HOME) return map;
  const saved = normalizeDashboard(map[folder]);
  return saved ? { ...map, [folder]: { ...saved, enabled: false } } : map;
}

/** Change one dashboard's widgets (Home starts from the default when never saved). */
export function editWidgets(
  map: Dashboards,
  folder: string,
  fn: (widgets: Widget[]) => Widget[],
): Dashboards {
  const current = dashboardFor(map, folder);
  if (!current) return map;
  return { ...map, [folder]: { ...current, widgets: fn(current.widgets) } };
}

export const addWidget = (widgets: Widget[], type: WidgetType) => [...widgets, makeWidget(type)];

export const removeWidget = (widgets: Widget[], id: string) => widgets.filter((w) => w.id !== id);

/** `list` with the item at `from` moved `delta` places, stopping at the ends. */
function shift<T>(list: T[], from: number, delta: number): T[] {
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (from === -1 || from === to) return list;
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(to, 0, item!);
  return out;
}

/** `list` with `item` moved to just before (or `after`) `target`; unchanged if either is missing. */
function place<T>(list: T[], item: T, target: T, after: boolean): T[] {
  if (item === target || !list.includes(item) || !list.includes(target)) return list;
  const out = list.filter((x) => x !== item);
  out.splice(out.indexOf(target) + (after ? 1 : 0), 0, item);
  return out;
}

/** Move a widget `delta` places (−1 earlier, +1 later), stopping at the ends. */
export const moveWidget = (widgets: Widget[], id: string, delta: number) =>
  shift(
    widgets,
    widgets.findIndex((w) => w.id === id),
    delta,
  );

/** A widget dropped on another: it goes just before it, or after when dropped on its far half. */
export function placeWidget(widgets: Widget[], id: string, target: string, after: boolean) {
  const ids = widgets.map((w) => w.id);
  const next = place(ids, id, target, after);
  if (next === ids) return widgets;
  const byId = new Map(widgets.map((w) => [w.id, w]));
  return next.map((i) => byId.get(i)!);
}

/** Move a pinned link `delta` places. */
export const moveLink = (links: string[], path: string, delta: number) =>
  shift(links, links.indexOf(path), delta);

/** A pinned card dropped on another: just before it, or after on its far half. */
export const placeLink = (links: string[], path: string, target: string, after: boolean) =>
  place(links, path, target, after);

export function updateWidget(widgets: Widget[], id: string, patch: Partial<Widget>): Widget[] {
  return widgets.map((w) => (w.id === id ? { ...w, ...patch, id: w.id, type: w.type } : w));
}

const isSameOrInside = (path: string, dir: string) => path === dir || path.startsWith(dir + "/");

/** Whether `path` belongs to `folder`'s dashboard (Home covers the whole vault). */
export const inScope = (path: string, folder: string) =>
  folder === HOME || path.startsWith(folder + "/");

/**
 * A file or folder was renamed or moved: dashboards of folders inside it move with it, and
 * every pinned link to it (or inside it) follows. Returns null when nothing changed.
 */
export function renameInDashboards(map: Dashboards, from: string, to: string): Dashboards | null {
  let changed = false;
  const move = (p: string) => {
    if (!isSameOrInside(p, from)) return p;
    changed = true;
    return to + p.slice(from.length);
  };
  const out: Dashboards = {};
  for (const [key, value] of Object.entries(map)) {
    const d = normalizeDashboard(value);
    const newKey = key === HOME ? HOME : move(key);
    if (!d) {
      out[newKey] = value;
      continue;
    }
    out[newKey] = {
      ...d,
      widgets: d.widgets.map((w) => (w.links ? { ...w, links: w.links.map(move) } : w)),
    };
  }
  return changed ? out : null;
}

/**
 * A folder was trashed: dashboards inside it are switched off, not deleted, so restoring
 * the folder from the trash and adding its dashboard back brings the layout back. Pinned
 * links to it stay and show as missing until the user relinks or removes them.
 */
export function trashInDashboards(map: Dashboards, path: string): Dashboards | null {
  let changed = false;
  const out: Dashboards = { ...map };
  for (const key of Object.keys(map)) {
    if (key === HOME || !isSameOrInside(key, path)) continue;
    const d = normalizeDashboard(map[key]);
    if (d?.enabled) {
      out[key] = { ...d, enabled: false };
      changed = true;
    }
  }
  return changed ? out : null;
}

// ---- Today's tasks ----

/** `YYYY-MM-DD` `n` days after `day` (a local date, so DST changes don't shift it). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d + n);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Today's tasks for a dashboard over `folder`: open tasks due by `horizon` (today unless
 * given), every task in today's daily note, and tasks due today that were ticked off (so a
 * tick doesn't make the row vanish). Overdue first, then by due date, priority and place.
 */
export function selectDailyTasks(
  tasks: readonly TaskRef[],
  opts: { today: string; folder: string; dailyPath: string; horizon?: string },
): TaskRef[] {
  const { today, folder, dailyPath } = opts;
  const horizon = opts.horizon ?? today;
  return tasks
    .filter((t) => inScope(t.path, folder))
    .filter((t) =>
      t.path === dailyPath ? true : t.done ? t.due === today : t.due !== null && t.due <= horizon,
    )
    .sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        (a.due ?? today).localeCompare(b.due ?? today) ||
        b.priority - a.priority ||
        a.path.localeCompare(b.path) ||
        a.line - b.line,
    );
}

export type TaskGroup = "overdue" | "today" | "upcoming";

/** Which heading a task goes under in a week-long tasks widget. */
export function taskGroup(t: TaskRef, today: string): TaskGroup {
  if (t.due === null || t.due === today) return "today";
  if (t.due < today) return t.done ? "today" : "overdue";
  return "upcoming";
}

/** Open tasks in scope by due date, for marking days on the calendar. */
export function dueCounts(tasks: readonly TaskRef[], folder: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of tasks) {
    if (t.done || t.due === null || !inScope(t.path, folder)) continue;
    out.set(t.due, (out.get(t.due) ?? 0) + 1);
  }
  return out;
}

// ---- Day schedule ----

export interface TimeOfDay {
  /** `HH:MM`, 24-hour. */
  start: string;
  end?: string;
  /** The text after the time. */
  rest: string;
}

const TIME = String.raw`(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?`;
const LEADING_TIME = new RegExp(
  String.raw`^${TIME}(?:\s*[-–—]\s*${TIME})?(?=\s|$|[:,])[:,]?\s*`,
  "i",
);

function clock(h: string, m: string | undefined, ampm: string | undefined): string | null {
  let hour = Number(h);
  const minute = m === undefined ? 0 : Number(m);
  const half = ampm?.toLowerCase().replace(/\./g, "");
  if (!m && !half) return null; // "3 apples" is not a time
  if (minute > 59) return null;
  if (half) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (half === "pm" ? 12 : 0);
  } else if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** A time (or time range) at the start of `text`: `09:00 Standup`, `2pm-3pm Gym`, `9.30 …`. */
export function parseLeadingTime(text: string): TimeOfDay | null {
  const m = LEADING_TIME.exec(text.trim());
  if (!m) return null;
  const end = m[4] ? clock(m[4], m[5], m[6]) : null;
  let start = clock(m[1]!, m[2], m[3]);
  // A range's end may carry the am/pm for both: "2-3pm" is 14:00, "11-1pm" is 11:00.
  if (end && !m[3] && m[6]) {
    const shared = clock(m[1]!, m[2], m[6]);
    start = shared && shared <= end ? shared : clock(m[1]!, m[2], "am");
  }
  if (!start) return null;
  const rest = text.trim().slice(m[0].length).trim();
  return end ? { start, end, rest } : { start, rest };
}

export interface ScheduleItem extends TimeOfDay {
  path: string;
  /** 1-based line. */
  line: number;
  /** Set when the item is a task, so it can be ticked off. */
  task?: TaskRef;
}

const LIST_MARK = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/;

/** Lines of a note's body with their 1-based numbers, skipping frontmatter and code. */
function bodyLines(text: string): [string, number][] {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  let start = 0;
  if (lines[0]?.trimEnd() === "---") {
    const close = lines.findIndex(
      (l, i) => i > 0 && (l.trimEnd() === "---" || l.trimEnd() === "..."),
    );
    if (close > 0) start = close + 1;
  }
  const out: [string, number][] = [];
  let fence: string | null = null;
  lines.forEach((line, i) => {
    if (i < start) return;
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      return;
    }
    if (!fence) out.push([line, i + 1]);
  });
  return out;
}

/**
 * A day's timed items (Notes has no calendar storage; see DECISIONS.md, T-100): lines in
 * that day's daily note that start with a time (`- 09:00 Standup`, `- [ ] 14:00 Call`),
 * plus tasks anywhere in scope that are due that day and start with a time. Sorted by time.
 * `today` is the day shown, which needn't be the current date.
 */
export function selectSchedule(opts: {
  tasks: readonly TaskRef[];
  today: string;
  folder: string;
  daily: { path: string; content: string } | null;
}): ScheduleItem[] {
  const { tasks, today, folder, daily } = opts;
  const items = new Map<string, ScheduleItem>();
  const taskAt = new Map(tasks.map((t) => [`${t.path}:${t.line}`, t]));

  if (daily && inScope(daily.path, folder)) {
    for (const [line, no] of bodyLines(daily.content)) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const task = taskAt.get(`${daily.path}:${no}`);
      const time = parseLeadingTime(task ? task.text : line.replace(LIST_MARK, ""));
      if (!time) continue;
      items.set(`${daily.path}:${no}`, {
        ...time,
        path: daily.path,
        line: no,
        ...(task ? { task } : {}),
      });
    }
  }
  for (const t of tasks) {
    const key = `${t.path}:${t.line}`;
    if (t.due !== today || !inScope(t.path, folder) || items.has(key)) continue;
    const time = parseLeadingTime(t.text);
    if (time) items.set(key, { ...time, path: t.path, line: t.line, task: t });
  }
  return [...items.values()].sort(
    (a, b) => a.start.localeCompare(b.start) || a.path.localeCompare(b.path) || a.line - b.line,
  );
}

/** Where the "now" line goes in a day's schedule: before the first item that starts later. */
export function nowIndex(items: readonly ScheduleItem[], now: string): number {
  const i = items.findIndex((it) => it.start > now);
  return i === -1 ? items.length : i;
}

// ---- Adding to a note ----

const LIST_LINE = /^\s*(?:[-*+]|\d+[.)])\s/;
const EMPTY_TASK = /^\s*[-*+]\s+\[ \]\s*$/;
const isTimed = (line: string) => parseLeadingTime(line.replace(LIST_MARK, "")) !== null;

/**
 * `content` with `line` added where it belongs, for quick add from a dashboard:
 * - a task replaces the template's empty `- [ ] ` or goes after the note's last task;
 * - a timed line goes after the last timed line;
 * - otherwise it goes after the last list item under the last heading, else at the end.
 * Frontmatter and code blocks are skipped. Line endings follow the note's.
 */
export function appendToNote(content: string, line: string): string {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split("\n").map((l) => l.replace(/\r$/, ""));
  const body = bodyLines(content);
  const isTask = /^\s*[-*+]\s+\[[ xX]\]\s/.test(line);
  const last = (test: (l: string) => boolean, from = 0) => {
    for (let i = body.length - 1; i >= from; i--) if (test(body[i]![0])) return i;
    return -1;
  };

  let at = -1;
  if (isTask) {
    const empty = last((l) => EMPTY_TASK.test(l));
    if (empty !== -1) {
      lines[body[empty]![1] - 1] = line;
      return lines.join(eol);
    }
    at = last((l) => /^\s*[-*+]\s+\[[ xX]\]\s/.test(l));
  } else if (isTimed(line)) {
    at = last((l) => LIST_LINE.test(l) && isTimed(l));
  }
  if (at === -1) {
    const heading = last((l) => /^#{1,6}\s/.test(l));
    at = last((l) => LIST_LINE.test(l), Math.max(heading, 0));
  }
  if (at !== -1) {
    lines.splice(body[at]![1], 0, line);
    return lines.join(eol);
  }
  // At the end, after a blank line unless the note ends with one or is empty.
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  const head = lines.length ? [...lines, ""] : [];
  return [...head, line, ""].join(eol);
}

// ---- Links and recent files ----

export interface LinkInfo {
  path: string;
  entry: VaultEntry | null;
}

/** Every file and folder in the tree (not the root), by path. */
export function entriesByPath(tree: VaultEntry | null): Map<string, VaultEntry> {
  const out = new Map<string, VaultEntry>();
  const walk = (e: VaultEntry) => {
    if (e.path) out.set(e.path, e);
    e.children?.forEach(walk);
  };
  if (tree) walk(tree);
  return out;
}

/** Files and folders a links widget can pin: everything in scope, folders first. */
export function linkCandidates(tree: VaultEntry | null, folder: string): VaultEntry[] {
  return [...entriesByPath(tree).values()]
    .filter((e) => inScope(e.path, folder))
    .sort(
      (a, b) => Number(a.kind !== "dir") - Number(b.kind !== "dir") || a.path.localeCompare(b.path),
    );
}

/** Files in scope, most recently changed first. */
export function recentFiles(tree: VaultEntry | null, folder: string, limit = 8): VaultEntry[] {
  return [...entriesByPath(tree).values()]
    .filter((e) => e.kind !== "dir" && inScope(e.path, folder))
    .sort((a, b) => b.modifiedMs - a.modifiedMs || a.path.localeCompare(b.path))
    .slice(0, limit);
}

/** How many files are inside a folder entry, at any depth. */
export function fileCount(entry: VaultEntry): number {
  return (entry.children ?? []).reduce((n, c) => n + (c.children ? fileCount(c) : 1), 0);
}

export interface FolderStats {
  /** Files inside, at any depth. */
  files: number;
  /** The latest change to the folder or anything in it (ms). */
  latest: number;
}

export interface TreeIndex {
  entries: Map<string, VaultEntry>;
  /** By folder path ("" is the vault). */
  folders: Map<string, FolderStats>;
}

/**
 * Every file and folder by path, plus each folder's file count and latest change, from one
 * walk of the tree. A dashboard builds this once per tree and its cards look things up.
 */
export function indexTree(tree: VaultEntry | null): TreeIndex {
  const entries = new Map<string, VaultEntry>();
  const folders = new Map<string, FolderStats>();
  const walk = (e: VaultEntry): FolderStats => {
    if (e.path) entries.set(e.path, e);
    if (!e.children) return { files: 1, latest: e.modifiedMs };
    const stats = { files: 0, latest: e.modifiedMs };
    for (const c of e.children) {
      const s = walk(c);
      stats.files += s.files;
      stats.latest = Math.max(stats.latest, s.latest);
    }
    folders.set(e.path, stats);
    return stats;
  };
  if (tree) walk(tree);
  return { entries, folders };
}

// ---- A folder's contents, as modules ----

const byName = (a: VaultEntry, b: VaultEntry) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

/** What's directly in a folder: its subfolders and its files, each by name. */
export function folderContents(folder: VaultEntry | null | undefined): {
  folders: VaultEntry[];
  files: VaultEntry[];
} {
  const children = folder?.children ?? [];
  return {
    folders: children.filter((c) => c.kind === "dir").sort(byName),
    files: children.filter((c) => c.kind !== "dir").sort(byName),
  };
}

/** Files anywhere inside a folder, most recently changed first. */
export function recentInside(folder: VaultEntry, limit: number): VaultEntry[] {
  const files: VaultEntry[] = [];
  const walk = (e: VaultEntry) => {
    for (const c of e.children ?? []) {
      if (c.children) walk(c);
      else files.push(c);
    }
  };
  walk(folder);
  return files
    .sort((a, b) => b.modifiedMs - a.modifiedMs || a.path.localeCompare(b.path))
    .slice(0, limit);
}
