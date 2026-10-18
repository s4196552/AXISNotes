import { describe, expect, it } from "vitest";
import {
  activate,
  activeTab,
  addToGroup,
  back,
  closeGroup,
  closeOthers,
  closeTab,
  closeToRight,
  cycle,
  deserialize,
  forward,
  goTo,
  groupTabs,
  initialTabs,
  type Loc,
  moveGroup,
  moveTab,
  navigate,
  newTab,
  newTabInGroup,
  removeFromGroup,
  removePath,
  renamePath,
  reopenClosed,
  selectTab,
  selection,
  serialize,
  shownTabs,
  type TabsState,
  toggleGroup,
  togglePin,
  ungroup,
  updateGroup,
} from "./tabs";

const note = (path: string): Loc => ({ path, view: "note" });
const paths = (s: TabsState) => s.list.map((t) => t.path ?? (t.view === "note" ? "∅" : t.view));
const current = (s: TabsState) => activeTab(s).path ?? activeTab(s).view;

/** Tabs for a.md, b.md, c.md with the given index active. */
function three(active = 0): TabsState {
  let s = navigate(initialTabs(), note("a.md"));
  s = navigate(s, note("b.md"), { newTab: true });
  s = navigate(s, note("c.md"), { newTab: true });
  return goTo(s, active);
}

describe("opening", () => {
  it("opens in the active tab, remembering history, or in a new tab when asked", () => {
    let s = navigate(initialTabs(), note("a.md"));
    expect(paths(s)).toEqual(["a.md"]);
    expect(activeTab(s).back).toEqual([]); // the empty tab isn't history
    s = navigate(s, note("b.md"));
    expect(paths(s)).toEqual(["b.md"]);
    expect(activeTab(s).back).toEqual([note("a.md")]);
    s = navigate(s, note("c.md"), { newTab: true });
    expect(paths(s)).toEqual(["b.md", "c.md"]);
    expect(current(s)).toBe("c.md");
    expect(navigate(s, note("c.md"))).toBe(s); // already there
  });

  it("opens beside a pinned tab instead of replacing it", () => {
    let s = navigate(initialTabs(), note("a.md"));
    s = togglePin(s, s.active);
    s = navigate(s, note("b.md"));
    expect(paths(s)).toEqual(["a.md", "b.md"]);
    expect(current(s)).toBe("b.md");
    expect(s.list[0]!.pinned).toBe(true);
  });

  it("new tabs go right after the active one", () => {
    const s = newTab(three(0));
    expect(paths(s)).toEqual(["a.md", "∅", "b.md", "c.md"]);
    expect(current(s)).toBe("note");
  });

  it("changes the view in place, so Back returns to the note", () => {
    let s = navigate(initialTabs(), note("a.md"));
    s = navigate(s, { path: "a.md", view: "graph" });
    expect(current(s)).toBe("a.md");
    expect(activeTab(s).view).toBe("graph");
    s = back(s);
    expect(activeTab(s).view).toBe("note");
  });
});

describe("history", () => {
  it("goes back and forward per tab; a new visit clears forward", () => {
    let s = navigate(initialTabs(), note("a.md"));
    s = navigate(s, note("b.md"));
    s = navigate(s, note("c.md"));
    s = back(back(s));
    expect(current(s)).toBe("a.md");
    s = forward(s);
    expect(current(s)).toBe("b.md");
    s = navigate(s, note("d.md"));
    expect(activeTab(s).forward).toEqual([]);
    expect(forward(s)).toBe(s);
    // The first note in a fresh tab has nothing behind it.
    const first = navigate(initialTabs(), note("x.md"));
    expect(back(first)).toBe(first);
  });

  it("does nothing with no history", () => {
    const s = initialTabs();
    expect(back(s)).toBe(s);
    expect(forward(s)).toBe(s);
  });
});

describe("closing", () => {
  it("activates the tab to the right, else the left, and keeps one empty tab", () => {
    let s = three(1);
    s = closeTab(s, s.active);
    expect(paths(s)).toEqual(["a.md", "c.md"]);
    expect(current(s)).toBe("c.md");
    s = closeTab(s, s.active);
    expect(current(s)).toBe("a.md");
    s = closeTab(s, s.active);
    expect(paths(s)).toEqual(["∅"]);
    // Closing an inactive tab keeps the active one.
    const t = three(0);
    expect(current(closeTab(t, t.list[2]!.id))).toBe("a.md");
  });

  it("reopens closed tabs, newest first, but not empty ones", () => {
    let s = three(0);
    s = closeTab(s, s.list[1]!.id);
    s = closeTab(s, s.list[1]!.id);
    s = reopenClosed(s);
    expect(paths(s)).toEqual(["a.md", "c.md"]);
    // Each comes back next to the active tab (the one just reopened).
    s = reopenClosed(s);
    expect(paths(s)).toEqual(["a.md", "c.md", "b.md"]);
    expect(current(s)).toBe("b.md");
    expect(reopenClosed(s)).toBe(s);
    const e = newTab(initialTabs());
    expect(closeTab(e, e.active).closed).toEqual([]);
  });

  it("closes others and to the right, sparing pinned tabs", () => {
    let s = three(2);
    s = togglePin(s, s.list[0]!.id);
    expect(paths(closeOthers(s, s.list[1]!.id))).toEqual(["a.md", "b.md"]);
    expect(current(closeOthers(s, s.list[1]!.id))).toBe("b.md");
    const r = closeToRight(s, s.list[0]!.id);
    expect(paths(r)).toEqual(["a.md"]);
    expect(current(r)).toBe("a.md");
  });
});

describe("moving between tabs", () => {
  it("cycles with wrap-around and jumps by number", () => {
    const s = three(2);
    expect(current(cycle(s, 1))).toBe("a.md");
    expect(current(cycle(s, -1))).toBe("b.md");
    expect(current(goTo(s, 0))).toBe("a.md");
    expect(current(goTo(three(0), -1))).toBe("c.md");
    expect(goTo(s, 7)).toBe(s);
  });

  it("reorders", () => {
    const s = three(0);
    expect(paths(moveTab(s, s.list[0]!.id, 2))).toEqual(["b.md", "c.md", "a.md"]);
    expect(paths(moveTab(s, s.list[2]!.id, 0))).toEqual(["c.md", "a.md", "b.md"]);
  });
});

describe("files", () => {
  it("follows renames in tabs, history and closed tabs", () => {
    let s = navigate(initialTabs(), note("School/a.md"));
    s = navigate(s, note("School/b.md"));
    s = navigate(s, note("x.md"), { newTab: true });
    s = closeTab(s, s.active);
    s = navigate(s, note("x.md"), { newTab: true });
    s = renamePath(s, "School", "Uni");
    expect(paths(s)).toEqual(["Uni/b.md", "x.md"]);
    expect(s.list[0]!.back).toEqual([note("Uni/a.md")]);
    s = renamePath(s, "x.md", "y.md");
    expect(paths(s)).toEqual(["Uni/b.md", "y.md"]);
    expect(s.closed).toEqual([note("y.md")]);
  });

  it("closes tabs for trashed files and forgets them", () => {
    let s = navigate(initialTabs(), note("School/a.md"));
    s = navigate(s, note("keep.md"));
    s = navigate(s, note("School/b.md"), { newTab: true });
    s = removePath(s, "School");
    expect(paths(s)).toEqual(["keep.md"]);
    expect(s.list[0]!.back).toEqual([]);
    expect(s.closed).toEqual([]);
  });
});

describe("saving", () => {
  it("round-trips tabs, pins and the active tab", () => {
    let s = three(1);
    s = togglePin(s, s.list[0]!.id);
    s = navigate(s, { path: null, view: "graph" }, { newTab: true });
    const back = deserialize(serialize(s));
    expect(paths(back)).toEqual(["a.md", "b.md", "graph", "c.md"]);
    expect(back.list[0]!.pinned).toBe(true);
    expect(current(back)).toBe("graph");
  });

  it("falls back to one empty tab for missing or bad data", () => {
    for (const text of [null, "", "nope", "{}", '{"tabs":[{"path":3,"view":"note"}]}']) {
      expect(paths(deserialize(text))).toEqual(["∅"]);
    }
    expect(current(deserialize('{"tabs":[{"path":"a.md","view":"note"}],"active":9}'))).toBe(
      "a.md",
    );
  });
});

// ---- Selecting and groups ----

/** Tabs a.md … e.md, the first active. */
function five(): TabsState {
  let s = navigate(initialTabs(), note("a.md"));
  for (const p of ["b.md", "c.md", "d.md", "e.md"]) s = navigate(s, note(p), { newTab: true });
  return goTo(s, 0);
}
const id = (s: TabsState, path: string) => s.list.find((t) => t.path === path)!.id;
const ids = (s: TabsState, ...p: string[]) => p.map((x) => id(s, x));
/** Paths with their group's name (or colour), e.g. "a.md:blue". */
const layout = (s: TabsState) =>
  s.list.map((t) => {
    const g = s.groups.find((x) => x.id === t.group);
    return g ? `${t.path}:${g.name || g.color}` : t.path;
  });

describe("selecting", () => {
  it("Ctrl+click toggles a tab; Shift+click selects a range from the active tab", () => {
    let s = goTo(five(), 1); // b
    s = selectTab(s, id(s, "d.md"), "toggle");
    expect(selection(s)).toEqual(ids(s, "b.md", "d.md"));
    s = selectTab(s, id(s, "d.md"), "toggle");
    expect(selection(s)).toEqual(ids(s, "b.md"));
    s = selectTab(s, id(s, "e.md"), "range");
    expect(selection(s)).toEqual(ids(s, "b.md", "c.md", "d.md", "e.md"));
    s = selectTab(s, id(s, "a.md"), "range");
    expect(selection(s)).toEqual(ids(s, "a.md", "b.md"));
    // The active tab is always part of it and can't be toggled off.
    expect(selectTab(s, s.active, "toggle")).toBe(s);
    // Opening a tab clears it.
    expect(selection(activate(s, id(s, "c.md")))).toEqual(ids(s, "c.md"));
  });
});

describe("groups", () => {
  it("gathers grouped tabs where the first one is, with the next free colour", () => {
    let s = five();
    s = groupTabs(s, ids(s, "b.md", "d.md"));
    expect(layout(s)).toEqual(["a.md", "b.md:grey", "d.md:grey", "c.md", "e.md"]);
    s = groupTabs(s, ids(s, "e.md"), { name: "Later" });
    expect(s.groups.map((g) => g.color)).toEqual(["grey", "blue"]);
    expect(layout(s).at(-1)).toBe("e.md:Later");
    expect(s.selected).toEqual([]);
  });

  it("adds tabs to the end of a group and takes them out beside it", () => {
    let s = five();
    s = groupTabs(s, ids(s, "b.md", "c.md", "d.md"), { name: "G" });
    const g = s.groups[0]!.id;
    s = addToGroup(s, ids(s, "a.md"), g);
    expect(layout(s)).toEqual(["b.md:G", "c.md:G", "d.md:G", "a.md:G", "e.md"]);
    // A middle tab leaves to just after the group; the first one stays just before it.
    s = removeFromGroup(s, ids(s, "c.md"));
    expect(layout(s)).toEqual(["b.md:G", "d.md:G", "a.md:G", "c.md", "e.md"]);
    s = removeFromGroup(s, ids(s, "b.md"));
    expect(layout(s)).toEqual(["b.md", "d.md:G", "a.md:G", "c.md", "e.md"]);
    // Several keep their order.
    s = removeFromGroup(s, ids(s, "d.md", "a.md"));
    expect(layout(s)).toEqual(["b.md", "d.md", "a.md", "c.md", "e.md"]);
    expect(s.groups).toEqual([]); // empty groups go
  });

  it("renames, recolours, ungroups and closes groups", () => {
    let s = five();
    s = groupTabs(s, ids(s, "c.md", "d.md"));
    const g = s.groups[0]!.id;
    s = updateGroup(s, g, { name: "Work", color: "green" });
    expect(s.groups[0]).toMatchObject({ name: "Work", color: "green" });
    expect(layout(ungroup(s, g))).toEqual(["a.md", "b.md", "c.md", "d.md", "e.md"]);
    s = closeGroup(goTo(s, 2), g); // c active
    expect(paths(s)).toEqual(["a.md", "b.md", "e.md"]);
    expect(current(s)).toBe("e.md");
    expect(s.groups).toEqual([]);
  });

  it("collapsing hides the tabs and moves off the active one; opening one expands it", () => {
    let s = five();
    s = groupTabs(s, ids(s, "b.md", "c.md"));
    const g = s.groups[0]!.id;
    s = goTo(s, 2); // c, in the group
    s = toggleGroup(s, g);
    expect(s.groups[0]!.collapsed).toBe(true);
    expect(current(s)).toBe("d.md"); // the nearest tab to the right outside it
    expect(shownTabs(s).map((t) => t.path)).toEqual(["a.md", "d.md", "e.md"]);
    // Next tab and Go to tab skip hidden tabs.
    expect(current(cycle(goTo(s, 0), 1))).toBe("d.md");
    expect(current(goTo(s, 1))).toBe("d.md");
    // Opening a hidden tab another way expands the group.
    expect(activate(s, id(s, "b.md")).groups[0]!.collapsed).toBe(false);
    // Expanding keeps the active tab.
    expect(current(toggleGroup(s, g))).toBe("d.md");
  });

  it("collapsing the only tabs leaves a new empty tab", () => {
    let s = navigate(initialTabs(), note("a.md"));
    s = groupTabs(s, [s.active]);
    s = toggleGroup(s, s.groups[0]!.id);
    expect(paths(s)).toEqual(["a.md", "∅"]);
    expect(activeTab(s).path).toBeNull();
  });

  it("closing the active tab skips hidden tabs", () => {
    let s = five();
    s = groupTabs(s, ids(s, "c.md", "d.md"));
    s = toggleGroup(s, s.groups[0]!.id);
    s = closeTab(goTo(s, 1), id(s, "b.md"));
    expect(current(s)).toBe("e.md");
  });

  it("new tabs opened from a grouped tab join its group", () => {
    let s = five();
    s = groupTabs(s, ids(s, "a.md", "b.md"));
    const g = s.groups[0]!.id;
    s = navigate(s, note("x.md"), { newTab: true }); // from a
    expect(layout(s).slice(0, 3)).toEqual(["a.md:grey", "x.md:grey", "b.md:grey"]);
    s = newTabInGroup(s, g);
    expect(layout(s)[3]).toBe("null:grey");
    expect(activeTab(s).group).toBe(g);
  });

  it("moves tabs into and out of groups, keeping each group together", () => {
    let s = five();
    s = groupTabs(s, ids(s, "b.md", "c.md"));
    const g = s.groups[0]!.id;
    // e dropped between b and c joins the group.
    s = moveTab(s, id(s, "e.md"), 2, g);
    expect(layout(s)).toEqual(["a.md", "b.md:grey", "e.md:grey", "c.md:grey", "d.md"]);
    // b dropped at the end leaves it.
    s = moveTab(s, id(s, "b.md"), 4, null);
    expect(layout(s)).toEqual(["a.md", "e.md:grey", "c.md:grey", "d.md", "b.md"]);
    // A tab dropped inside a group without joining it ends up after the group.
    s = moveTab(s, id(s, "a.md"), 1, null);
    expect(layout(s)).toEqual(["e.md:grey", "c.md:grey", "a.md", "d.md", "b.md"]);
  });

  it("moves a whole group, never into another group", () => {
    let s = five();
    s = groupTabs(s, ids(s, "a.md", "b.md"), { name: "A" });
    s = groupTabs(s, ids(s, "d.md", "e.md"), { name: "D" });
    const a = s.groups[0]!.id;
    expect(layout(moveGroup(s, a, 5))).toEqual(["c.md", "d.md:D", "e.md:D", "a.md:A", "b.md:A"]);
    // Dropped inside D (before e): goes after D.
    expect(layout(moveGroup(s, a, 4))).toEqual(["c.md", "d.md:D", "e.md:D", "a.md:A", "b.md:A"]);
    expect(layout(moveGroup(s, a, 3))).toEqual(["c.md", "a.md:A", "b.md:A", "d.md:D", "e.md:D"]);
  });

  it("saves and restores groups, keeping the active tab visible", () => {
    let s = five();
    s = groupTabs(s, ids(s, "b.md", "c.md"), { name: "Work", color: "red" });
    s = groupTabs(s, ids(s, "e.md"));
    s = toggleGroup(s, s.groups[1]!.id);
    const restored = deserialize(serialize(s));
    expect(layout(restored)).toEqual(layout(s));
    const plain = (x: TabsState) =>
      x.groups.map(({ name, color, collapsed }) => [name, color, collapsed]);
    expect(plain(restored)).toEqual(plain(s));
    // A saved active tab inside a collapsed group expands it.
    const saved = JSON.parse(serialize(s)) as { active: number };
    saved.active = 4;
    expect(deserialize(JSON.stringify(saved)).groups[1]!.collapsed).toBe(false);
    // Bad group data is ignored.
    const bad = deserialize(
      JSON.stringify({ tabs: [{ path: "a.md", view: "note", group: 7 }], active: 0, groups: 3 }),
    );
    expect(layout(bad)).toEqual(["a.md"]);
  });
});
