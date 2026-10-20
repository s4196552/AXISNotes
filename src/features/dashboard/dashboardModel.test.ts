import { describe, expect, it } from "vitest";
import type { TaskRef, VaultEntry } from "../../ipc";
import {
  addDashboard,
  addWidget,
  dashboardFor,
  defaultDashboard,
  editWidgets,
  HOME,
  linkCandidates,
  moveWidget,
  normalizeDashboard,
  parseLeadingTime,
  recentFiles,
  removeDashboard,
  removeWidget,
  renameInDashboards,
  selectDailyTasks,
  selectSchedule,
  trashInDashboards,
  type Dashboards,
} from "./dashboardModel";

const task = (path: string, line: number, text: string, extra: Partial<TaskRef> = {}): TaskRef => ({
  path,
  line,
  raw: `- [ ] ${text}`,
  text,
  done: false,
  due: null,
  priority: 0,
  ...extra,
});

const TODAY = "2026-10-20";
const DAILY = "Daily/2026-10-20.md";

describe("dashboard layouts", () => {
  it("gives Home the default widgets until it is saved, and folders none until added", () => {
    const home = dashboardFor({}, HOME)!;
    expect(home.widgets.map((w) => w.type)).toEqual(["calendar", "tasks", "schedule", "links"]);
    expect(dashboardFor({}, "School")).toBeNull();
    const added = addDashboard({}, "School");
    expect(dashboardFor(added, "School")!.widgets).toHaveLength(4);
  });

  it("keeps a removed folder dashboard's layout and brings it back when added again", () => {
    let map: Dashboards = addDashboard({}, "School");
    map = editWidgets(map, "School", (ws) => [ws[1]!]);
    map = removeDashboard(map, "School");
    expect(dashboardFor(map, "School")).toBeNull();
    expect(map.School!.widgets.map((w) => w.type)).toEqual(["tasks"]);
    map = addDashboard(map, "School");
    expect(dashboardFor(map, "School")!.widgets.map((w) => w.type)).toEqual(["tasks"]);
  });

  it("lets the first edit of a never-saved Home find its default widget", () => {
    const links = dashboardFor({}, HOME)!.widgets.find((w) => w.type === "links")!;
    const map = editWidgets({}, HOME, (ws) =>
      ws.map((w) => (w.id === links.id ? { ...w, links: ["A.md"] } : w)),
    );
    expect(dashboardFor(map, HOME)!.widgets.find((w) => w.type === "links")!.links).toEqual([
      "A.md",
    ]);
  });

  it("never removes Home", () => {
    const map = editWidgets({}, HOME, (ws) => ws.slice(0, 1));
    expect(removeDashboard(map, HOME)).toBe(map);
    expect(dashboardFor(map, HOME)!.widgets.map((w) => w.type)).toEqual(["calendar"]);
  });

  it("adds, removes and reorders widgets", () => {
    let ws = defaultDashboard().widgets;
    ws = addWidget(ws, "recent");
    expect(ws.map((w) => w.type)).toEqual(["calendar", "tasks", "schedule", "links", "recent"]);
    const recent = ws.at(-1)!.id;
    ws = moveWidget(ws, recent, -1);
    ws = moveWidget(ws, recent, -1);
    expect(ws.map((w) => w.type)).toEqual(["calendar", "tasks", "recent", "schedule", "links"]);
    expect(moveWidget(ws, ws[0]!.id, -1)).toBe(ws); // already first
    ws = removeWidget(ws, ws[0]!.id);
    expect(ws.map((w) => w.type)).toEqual(["tasks", "recent", "schedule", "links"]);
  });

  it("drops malformed saved widgets and survives a JSON round trip", () => {
    const raw = {
      enabled: true,
      widgets: [
        { id: "a", type: "links", links: ["A.md", 3, "A.md", "B"] },
        { id: "a", type: "calendar" },
        { type: "nonsense" },
        "junk",
      ],
    };
    const d = normalizeDashboard(raw)!;
    expect(d.widgets.map((w) => w.type)).toEqual(["links", "calendar"]);
    expect(d.widgets[0]!.links).toEqual(["A.md", "B"]);
    expect(new Set(d.widgets.map((w) => w.id)).size).toBe(2);
    expect(normalizeDashboard(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(normalizeDashboard("nope")).toBeNull();
  });

  it("follows renames: folder dashboards move and pinned links update", () => {
    let map: Dashboards = addDashboard({}, "School/Bio");
    map = editWidgets(map, HOME, (ws) =>
      ws.map((w) =>
        w.type === "links" ? { ...w, links: ["School/Bio/Cells.md", "Other.md"] } : w,
      ),
    );
    const out = renameInDashboards(map, "School", "Uni")!;
    expect(Object.keys(out).sort()).toEqual(["", "Uni/Bio"]);
    const links = dashboardFor(out, HOME)!.widgets.find((w) => w.type === "links")!.links;
    expect(links).toEqual(["Uni/Bio/Cells.md", "Other.md"]);
    expect(renameInDashboards(map, "Nothing", "Else")).toBeNull();
  });

  it("switches off (but keeps) dashboards inside a trashed folder", () => {
    const map = addDashboard(addDashboard({}, "School/Bio"), "Work");
    const out = trashInDashboards(map, "School")!;
    expect(dashboardFor(out, "School/Bio")).toBeNull();
    expect(out["School/Bio"]!.widgets).toHaveLength(4);
    expect(dashboardFor(out, "Work")).not.toBeNull();
    expect(trashInDashboards(out, "School")).toBeNull();
  });
});

describe("today's tasks", () => {
  const tasks = [
    task("Work.md", 1, "Report", { due: "2026-10-18", priority: 3 }),
    task("Work.md", 2, "Standup", { due: TODAY }),
    task("Work.md", 3, "Later", { due: "2026-10-25" }),
    task("Work.md", 4, "No date"),
    task("Work.md", 5, "Ticked today", { due: TODAY, done: true }),
    task("Work.md", 6, "Ticked overdue", { due: "2026-10-01", done: true }),
    task(DAILY, 4, "From the daily note"),
    task("School/Bio.md", 2, "Read chapter", { due: "2026-10-19" }),
  ];

  it("picks overdue, due today and today's daily note; done ones last", () => {
    const got = selectDailyTasks(tasks, { today: TODAY, folder: HOME, dailyPath: DAILY });
    expect(got.map((t) => t.text)).toEqual([
      "Report",
      "Read chapter",
      "From the daily note",
      "Standup",
      "Ticked today",
    ]);
  });

  it("scopes a folder dashboard to that folder", () => {
    const got = selectDailyTasks(tasks, { today: TODAY, folder: "School", dailyPath: DAILY });
    expect(got.map((t) => t.text)).toEqual(["Read chapter"]);
  });
});

describe("day schedule", () => {
  it("reads leading times in several forms", () => {
    expect(parseLeadingTime("09:00 Standup")).toEqual({ start: "09:00", rest: "Standup" });
    expect(parseLeadingTime("9.30 Coffee")).toEqual({ start: "09:30", rest: "Coffee" });
    expect(parseLeadingTime("2pm Gym")).toEqual({ start: "14:00", rest: "Gym" });
    expect(parseLeadingTime("2-3pm Gym")).toEqual({ start: "14:00", end: "15:00", rest: "Gym" });
    expect(parseLeadingTime("11-1pm Lunch")).toEqual({
      start: "11:00",
      end: "13:00",
      rest: "Lunch",
    });
    expect(parseLeadingTime("13:00–14:30: Lecture")).toEqual({
      start: "13:00",
      end: "14:30",
      rest: "Lecture",
    });
    expect(parseLeadingTime("3 apples")).toBeNull();
    expect(parseLeadingTime("25:00 nope")).toBeNull();
    expect(parseLeadingTime("2026-10-20 notes")).toBeNull();
    expect(parseLeadingTime("Call at 09:00")).toBeNull();
  });

  it("collects timed lines from today's note and timed tasks due today, by time", () => {
    const content = [
      "---",
      "tags: [daily]",
      "---",
      "# 08:00 Not a heading item",
      "- 14:00 Call Sam",
      "- [ ] 09:00 Standup",
      "Plain line",
      "```",
      "10:00 code, not schedule",
      "```",
      "07:30 Run",
    ].join("\n");
    const tasks = [
      task(DAILY, 6, "09:00 Standup"),
      task("Work.md", 3, "11:00 Review PR", { due: TODAY }),
      task("Work.md", 4, "12:00 Not today", { due: "2026-10-21" }),
      task("School/Bio.md", 1, "15:00 Lab", { due: TODAY }),
    ];
    const items = selectSchedule({
      tasks,
      today: TODAY,
      folder: HOME,
      daily: { path: DAILY, content },
    });
    expect(items.map((i) => [i.start, i.rest, i.task ? "task" : "line"])).toEqual([
      ["07:30", "Run", "line"],
      ["09:00", "Standup", "task"],
      ["11:00", "Review PR", "task"],
      ["14:00", "Call Sam", "line"],
      ["15:00", "Lab", "task"],
    ]);
    expect(items.find((i) => i.rest === "Call Sam")!.line).toBe(5);

    const school = selectSchedule({
      tasks,
      today: TODAY,
      folder: "School",
      daily: { path: DAILY, content },
    });
    expect(school.map((i) => i.rest)).toEqual(["Lab"]);
  });
});

describe("links and recent files", () => {
  const tree: VaultEntry = {
    path: "",
    name: "v",
    kind: "dir",
    modifiedMs: 0,
    children: [
      { path: "A.md", name: "A.md", kind: "file", modifiedMs: 5 },
      {
        path: "School",
        name: "School",
        kind: "dir",
        modifiedMs: 1,
        children: [{ path: "School/B.md", name: "B.md", kind: "file", modifiedMs: 9 }],
      },
    ],
  };

  it("offers folders first, scoped to the dashboard's folder", () => {
    expect(linkCandidates(tree, HOME).map((e) => e.path)).toEqual([
      "School",
      "A.md",
      "School/B.md",
    ]);
    expect(linkCandidates(tree, "School").map((e) => e.path)).toEqual(["School/B.md"]);
  });

  it("lists recent files newest first", () => {
    expect(recentFiles(tree, HOME).map((e) => e.path)).toEqual(["School/B.md", "A.md"]);
  });
});
