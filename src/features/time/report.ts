import type { TimeEntry } from "../../ipc";
import { formatDate } from "../../lib/dates";
import { durationMs } from "./timeLog";

// Totals for the time report: entries in a date range, grouped by note, tag, project or day.

export type GroupBy = "note" | "tag" | "project" | "day";
export type Preset = "today" | "week" | "month" | "30d" | "all";

/** Inclusive `YYYY-MM-DD` bounds; null = unbounded. */
export interface Range {
  from: string | null;
  to: string | null;
}

const ymd = (d: Date) => formatDate(d, "YYYY-MM-DD");

export function presetRange(preset: Preset, now = new Date()): Range {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (preset) {
    case "today":
      return { from: ymd(d), to: ymd(d) };
    case "week": {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: ymd(monday), to: ymd(sunday) };
    }
    case "month":
      return {
        from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)),
        to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      };
    case "30d": {
      const from = new Date(d);
      from.setDate(d.getDate() - 29);
      return { from: ymd(from), to: ymd(d) };
    }
    case "all":
      return { from: null, to: null };
  }
}

export const inRange = (e: Pick<TimeEntry, "start">, r: Range) => {
  const day = e.start.slice(0, 10);
  return (!r.from || day >= r.from) && (!r.to || day <= r.to);
};

export const noteLabel = (path: string) =>
  path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

function keysOf(e: TimeEntry, by: GroupBy): string[] {
  switch (by) {
    case "note":
      return [e.path];
    case "tag":
      return e.tags.length ? e.tags.map((t) => `#${t}`) : ["(untagged)"];
    case "project":
      return [
        e.project ?? (e.path.includes("/") ? e.path.slice(0, e.path.indexOf("/")) : "(no project)"),
      ];
    case "day":
      return [e.start.slice(0, 10)];
  }
}

export interface ReportRow {
  key: string;
  label: string;
  ms: number;
  entries: number;
}

export interface Report {
  rows: ReportRow[];
  /** Each entry counted once (an entry with two tags appears in two tag rows). */
  totalMs: number;
  entries: TimeEntry[];
}

export function summarize(all: TimeEntry[], by: GroupBy, range: Range, now = new Date()): Report {
  const entries = all.filter((e) => inRange(e, range));
  const rows = new Map<string, ReportRow>();
  let totalMs = 0;
  for (const e of entries) {
    const ms = durationMs(e, now);
    totalMs += ms;
    for (const key of keysOf(e, by)) {
      const row = rows.get(key) ?? {
        key,
        label: by === "note" ? noteLabel(key) : key,
        ms: 0,
        entries: 0,
      };
      row.ms += ms;
      row.entries++;
      rows.set(key, row);
    }
  }
  const sorted = [...rows.values()].sort((a, b) =>
    by === "day" ? a.key.localeCompare(b.key) : b.ms - a.ms || a.label.localeCompare(b.label),
  );
  return { rows: sorted, totalMs, entries };
}
