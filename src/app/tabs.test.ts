import { describe, expect, it } from "vitest";
import {
  activeTab,
  back,
  closeOthers,
  closeTab,
  closeToRight,
  cycle,
  deserialize,
  forward,
  goTo,
  initialTabs,
  type Loc,
  moveTab,
  navigate,
  newTab,
  removePath,
  renamePath,
  reopenClosed,
  serialize,
  type TabsState,
  togglePin,
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
