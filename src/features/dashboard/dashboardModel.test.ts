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
  addDays,
  appendToNote,
  dueCounts,
  nowIndex,
  taskGroup,
  isWide,
  makeWidget,
  moveLink,
  placeLink,
  placeWidget,
  indexTree,
} from "./dashboardModel";

describe("tree index", () => {
  const file = (path: string, modifiedMs: number): VaultEntry =>
    ({ path, name: path.split("/").pop()!, kind: "file", modifiedMs }) as VaultEntry;
  const dir = (path: string, modifiedMs: number, children: VaultEntry[]): VaultEntry =>
    ({ path, name: path.split("/").pop()!, kind: "dir", modifiedMs, children }) as VaultEntry;

  it("counts files and finds the latest change for every folder in one walk", () => {
    const tree = dir("", 1, [
      dir("School", 5, [
        file("School/A.md", 10),
        dir("School/Old", 2, [file("School/Old/B.md", 30)]),
      ]),
      dir("Empty", 7, []),
      file("Top.md", 3),
    ]);
    const { entries, folders } = indexTree(tree);
    expect([...entries.keys()].sort()).toEqual(
      ["Empty", "School", "School/A.md", "School/Old", "School/Old/B.md", "Top.md"].sort(),
    );
    expect(folders.get("School")).toEqual({ files: 2, latest: 30 });
    expect(folders.get("School/Old")).toEqual({ files: 1, latest: 30 });
    expect(folders.get("Empty")).toEqual({ files: 0, latest: 7 });
    expect(folders.get("")).toEqual({ files: 3, latest: 30 });
    expect(indexTree(null).entries.size).toBe(0);
  });
});

describe("customizing", () => {
  const ws = (["calendar", "tasks", "schedule", "links"] as const).map((t) => ({
    ...makeWidget(t),
    id: t,
  }));
  const ids = (list: { id: string }[]) => list.map((w) => w.id);

  it("drops a widget before or after another", () => {
    expect(ids(placeWidget(ws, "links", "tasks", false))).toEqual([
      "calendar",
      "links",
      "tasks",
      "schedule",
    ]);
    expect(ids(placeWidget(ws, "calendar", "schedule", true))).toEqual([
      "tasks",
      "schedule",
      "calendar",
      "links",
    ]);
    // Onto itself or an unknown widget: unchanged, and the same array.
    expect(placeWidget(ws, "tasks", "tasks", true)).toBe(ws);
    expect(placeWidget(ws, "tasks", "gone", false)).toBe(ws);
  });

  it("moves and drops pinned links", () => {
    const links = ["a.md", "b.md", "c.md"];
    expect(moveLink(links, "c.md", -1)).toEqual(["a.md", "c.md", "b.md"]);
    expect(moveLink(links, "a.md", -1)).toBe(links);
    expect(placeLink(links, "a.md", "c.md", true)).toEqual(["b.md", "c.md", "a.md"]);
    expect(placeLink(links, "c.md", "a.md", false)).toEqual(["c.md", "a.md", "b.md"]);
  });

  it("sizes widgets by type unless the user chose, and keeps size and count through a save", () => {
    expect(isWide(makeWidget("links"))).toBe(true);
    expect(isWide(makeWidget("calendar"))).toBe(false);
    expect(isWide({ ...makeWidget("links"), size: "normal" })).toBe(false);
    const d = normalizeDashboard({
      widgets: [
        { id: "r", type: "recent", size: "normal", options: { count: 16 } },
        { id: "s", type: "recent", size: "huge", options: { count: 2.5 } },
        { id: "t", type: "recent", options: { count: 500 } },
      ],
    })!;
    expect(d.widgets[0]).toMatchObject({ size: "normal", options: { count: 16 } });
    expect(d.widgets[1]!.size).toBeUndefined();
    expect(d.widgets[1]!.options).toBeUndefined();
    expect(d.widgets[2]!.options).toBeUndefined();
  });
});

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
    // A folder's dashboard shows only its contents, as modules.
    const added = addDashboard({}, "School");
    expect(dashboardFor(added, "School")!.widgets.map((w) => w.type)).toEqual(["contents"]);
  });

  it("turns a never-customized folder dashboard from before T-106 into the contents one", () => {
    const old = {
      enabled: true,
      widgets: (["calendar", "tasks", "schedule", "links"] as const).map((type) => ({
        id: `default-${type}`,
        type,
        ...(type === "links" ? { links: [] } : {}),
      })),
    };
    expect(dashboardFor({ School: old }, "School")!.widgets.map((w) => w.type)).toEqual([
      "contents",
    ]);
    // Re-adding a removed one, or editing it, also starts from the contents layout.
    const off = { School: { ...old, enabled: false } };
    expect(addDashboard(off, "School").School!.widgets.map((w) => w.type)).toEqual(["contents"]);
    // Anything the user changed is kept as it is.
    const pinned = {
      ...old,
      widgets: old.widgets.map((w) => (w.type === "links" ? { ...w, links: ["A.md"] } : w)),
    };
    expect(dashboardFor({ School: pinned }, "School")!.widgets).toHaveLength(4);
    const renamed = {
      ...old,
      widgets: [{ ...old.widgets[0]!, title: "Month" }, ...old.widgets.slice(1)],
    };
    expect(dashboardFor({ School: renamed }, "School")!.widgets).toHaveLength(4);
    // Home keeps its widgets.
    expect(dashboardFor({ "": old }, HOME)!.widgets).toHaveLength(4);
  });

  it("keeps a removed folder dashboard's layout and brings it back when added again", () => {
    let map: Dashboards = addDashboard({}, "School");
    map = editWidgets(map, "School", (ws) => [...ws, makeWidget("tasks")]);
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
    expect(out["School/Bio"]!.widgets).toHaveLength(1);
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

describe("planning ahead", () => {
  it("adds days across month ends and DST changes", () => {
    expect(addDays(TODAY, 7)).toBe("2026-10-27");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    // Sydney's clocks go forward on 2026-10-04 and back on 2026-04-05.
    expect(addDays("2026-10-03", 1)).toBe("2026-10-04");
    expect(addDays("2026-04-04", 2)).toBe("2026-04-06");
  });

  it("looks a week ahead and groups tasks as overdue, today and upcoming", () => {
    const tasks = [
      task("A.md", 1, "Late", { due: "2026-10-18" }),
      task("A.md", 2, "Now", { due: TODAY }),
      task("A.md", 3, "Soon", { due: "2026-10-24" }),
      task("A.md", 4, "Later", { due: "2026-11-30" }),
      task(DAILY, 1, "Undated"),
    ];
    const week = selectDailyTasks(tasks, {
      today: TODAY,
      folder: HOME,
      dailyPath: DAILY,
      horizon: addDays(TODAY, 7),
    });
    expect(week.map((t) => t.text)).toEqual(["Late", "Now", "Undated", "Soon"]);
    expect(week.map((t) => taskGroup(t, TODAY))).toEqual(["overdue", "today", "today", "upcoming"]);
    // Without a horizon it is today only, as before.
    expect(
      selectDailyTasks(tasks, { today: TODAY, folder: HOME, dailyPath: DAILY }).map((t) => t.text),
    ).toEqual(["Late", "Now", "Undated"]);
  });

  it("counts open tasks by due date in scope for the calendar", () => {
    const counts = dueCounts(
      [
        task("School/A.md", 1, "a", { due: TODAY }),
        task("School/A.md", 2, "b", { due: TODAY }),
        task("School/A.md", 3, "c", { due: TODAY, done: true }),
        task("Work.md", 1, "d", { due: TODAY }),
        task("School/A.md", 4, "e"),
      ],
      "School",
    );
    expect([...counts]).toEqual([[TODAY, 2]]);
  });

  it("puts the now line before the first item that starts later", () => {
    const items = ["09:00", "12:30", "17:00"].map((start, i) => ({
      start,
      rest: "",
      path: DAILY,
      line: i + 1,
    }));
    expect(nowIndex(items, "08:59")).toBe(0);
    expect(nowIndex(items, "12:30")).toBe(2);
    expect(nowIndex(items, "23:00")).toBe(3);
    expect(nowIndex([], "10:00")).toBe(0);
  });

  it("keeps a tasks widget's range through a save, dropping unknown options", () => {
    const d = normalizeDashboard({
      widgets: [
        { id: "t", type: "tasks", options: { range: "week", colour: "red" } },
        { id: "u", type: "tasks", options: { range: "year" } },
      ],
    })!;
    expect(d.widgets[0]!.options).toEqual({ range: "week" });
    expect(d.widgets[1]!.options).toBeUndefined();
  });
});

describe("quick add", () => {
  const daily = "# Tuesday\n\n## Tasks\n\n- [ ] \n\n## Notes\n\n";

  it("fills the template's empty task first, then adds after the last task", () => {
    const once = appendToNote(daily, "- [ ] Buy milk");
    expect(once).toBe("# Tuesday\n\n## Tasks\n\n- [ ] Buy milk\n\n## Notes\n\n");
    expect(appendToNote(once, "- [ ] Call Sam")).toBe(
      "# Tuesday\n\n## Tasks\n\n- [ ] Buy milk\n- [ ] Call Sam\n\n## Notes\n\n",
    );
  });

  it("puts a timed line after the last timed line, else at the end", () => {
    const first = appendToNote(daily, "- 09:00 Standup");
    expect(first).toBe(`${daily.trimEnd()}\n\n- 09:00 Standup\n`);
    expect(appendToNote(first, "- 14:00 Lab")).toBe(
      `${daily.trimEnd()}\n\n- 09:00 Standup\n- 14:00 Lab\n`,
    );
  });

  it("goes after the last list under the last heading, skipping code and frontmatter", () => {
    const note = "---\ntags: [a]\n---\n# Log\n- one\n```\n- [ ] not a task\n```\nText\n";
    expect(appendToNote(note, "- [ ] New")).toBe(
      "---\ntags: [a]\n---\n# Log\n- one\n- [ ] New\n```\n- [ ] not a task\n```\nText\n",
    );
    expect(appendToNote("", "- [ ] First")).toBe("- [ ] First\n");
    expect(appendToNote("Just text", "- [ ] Next")).toBe("Just text\n\n- [ ] Next\n");
  });

  it("keeps Windows line endings", () => {
    expect(appendToNote("- [ ] a\r\n- [ ] b\r\n", "- [ ] c")).toBe(
      "- [ ] a\r\n- [ ] b\r\n- [ ] c\r\n",
    );
  });
});
