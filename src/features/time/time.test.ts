import { describe, expect, it } from "vitest";
import type { TimeEntry } from "../../ipc";
import { splitFrontmatter } from "../../lib/markdown";
import { presetRange, summarize } from "./report";
import { appendEntry, closeEntry, durationMs, formatClock, formatDuration } from "./timeLog";

const entry = (over: Partial<TimeEntry>): TimeEntry => ({
  path: "Work/Report.md",
  start: "2026-09-21T09:00:00",
  end: "2026-09-21T10:00:00",
  task: null,
  tags: [],
  project: null,
  ...over,
});

describe("time log", () => {
  it("appends and closes entries in the frontmatter, keeping other properties", () => {
    let text = "---\nstatus: draft\n---\n# Report\n";
    text = appendEntry(text, { start: "2026-09-26T10:00:00", task: "Draft" });
    expect(splitFrontmatter(text).props).toEqual({
      status: "draft",
      time_log: [{ start: "2026-09-26T10:00:00", task: "Draft" }],
    });
    expect(text.endsWith("# Report\n")).toBe(true);
    const closed = closeEntry(text, "2026-09-26T10:00:00", "2026-09-26T10:45:00")!;
    expect(splitFrontmatter(closed).props.time_log).toEqual([
      { start: "2026-09-26T10:00:00", task: "Draft", end: "2026-09-26T10:45:00" },
    ]);
    expect(closeEntry(closed, "2026-09-26T10:00:00", "2026-09-26T11:00:00")).toBeNull();
    expect(splitFrontmatter(appendEntry("plain", { start: "2026-09-26T12:00:00" })).props).toEqual({
      time_log: [{ start: "2026-09-26T12:00:00" }],
    });
  });

  it("measures and formats durations", () => {
    expect(durationMs({ start: "2026-09-26T10:00:00", end: "2026-09-26T11:05:00" })).toBe(
      65 * 60_000,
    );
    expect(durationMs({ start: "2026-09-26T10:00:00" }, new Date("2026-09-26T10:00:30"))).toBe(
      30_000,
    );
    expect(durationMs({ start: "garbage", end: "2026-09-26T11:05:00" })).toBe(0);
    expect([
      formatDuration(65 * 60_000),
      formatDuration(12 * 60_000),
      formatDuration(45_000),
    ]).toEqual(["1h 05m", "12m", "45s"]);
    expect(formatClock(3_723_000)).toBe("01:02:03");
  });
});

describe("time report", () => {
  it("computes preset ranges (weeks start on Monday)", () => {
    const now = new Date(2026, 8, 26); // Saturday, Sep 26 2026
    expect(presetRange("today", now)).toEqual({ from: "2026-09-26", to: "2026-09-26" });
    expect(presetRange("week", now)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(presetRange("month", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("30d", now)).toEqual({ from: "2026-08-28", to: "2026-09-26" });
  });

  it("groups by note, tag, project and day within the range", () => {
    const entries = [
      entry({ tags: ["work", "writing"], project: "Alpha" }),
      entry({ path: "Home.md", start: "2026-09-22T08:00:00", end: "2026-09-22T08:30:00" }),
      entry({ start: "2026-09-01T09:00:00", end: "2026-09-01T12:00:00" }), // out of range
    ];
    const range = { from: "2026-09-21", to: "2026-09-27" };
    const byNote = summarize(entries, "note", range);
    expect(byNote.totalMs).toBe(90 * 60_000);
    expect(byNote.rows.map((r) => [r.label, r.ms / 60_000])).toEqual([
      ["Report", 60],
      ["Home", 30],
    ]);
    expect(summarize(entries, "tag", range).rows.map((r) => r.key)).toEqual([
      "#work",
      "#writing",
      "(untagged)",
    ]);
    expect(summarize(entries, "project", range).rows.map((r) => r.key)).toEqual([
      "Alpha",
      "(no project)",
    ]);
    expect(summarize(entries, "day", range).rows.map((r) => r.key)).toEqual([
      "2026-09-21",
      "2026-09-22",
    ]);
    expect(summarize(entries, "note", { from: null, to: null }).rows[0]!.ms).toBe(240 * 60_000);
  });
});
