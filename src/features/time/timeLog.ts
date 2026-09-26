import { formatDate } from "../../lib/dates";
import { type Props, splitFrontmatter, withFrontmatter } from "../../lib/markdown";

// Time entries live in a note's frontmatter:
//   time_log:
//     - start: 2026-09-26T10:00:00
//       end: 2026-09-26T10:45:00
//       task: Write report        # optional
// Times are local, to the second. An entry without `end` is a running timer.

export const TIME_LOG = "time_log";
export const STAMP = "YYYY-MM-DD[T]HH:mm:ss";

export interface LogEntry {
  start: string;
  end?: string;
  task?: string;
}

export const stamp = (d: Date) => formatDate(d, STAMP);

/** Parse a local `YYYY-MM-DDTHH:mm(:ss)` stamp; null if malformed. */
export function parseStamp(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function durationMs(
  entry: { start: string; end?: string | null },
  now = new Date(),
): number {
  const start = parseStamp(entry.start);
  const end = entry.end ? parseStamp(entry.end) : now;
  if (!start || !end) return 0;
  return Math.max(0, end.getTime() - start.getTime());
}

/** `1h 05m`, `12m`, `45s`. */
export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** `00:12:34` for a running clock. */
export function formatClock(ms: number): string {
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function logOf(props: Props): LogEntry[] {
  const v = props[TIME_LOG];
  return Array.isArray(v)
    ? v.filter((e): e is LogEntry => !!e && typeof e === "object" && typeof e.start === "string")
    : [];
}

/** The note text with `entry` appended to its time log. */
export function appendEntry(text: string, entry: LogEntry): string {
  const props = splitFrontmatter(text).props;
  const clean: LogEntry = { start: entry.start };
  if (entry.end) clean.end = entry.end;
  if (entry.task) clean.task = entry.task;
  return withFrontmatter(text, { ...props, [TIME_LOG]: [...logOf(props), clean] });
}

/** Close the running entry that started at `start`; null if there is none. */
export function closeEntry(text: string, start: string, end: string): string | null {
  const props = splitFrontmatter(text).props;
  const log = logOf(props);
  const i = log.findIndex((e) => e.start === start && !e.end);
  if (i < 0) return null;
  const next = log.map((e, j) => (j === i ? { ...e, end } : e));
  return withFrontmatter(text, { ...props, [TIME_LOG]: next });
}
