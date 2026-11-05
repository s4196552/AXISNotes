import { describe, expect, it } from "vitest";
import * as P from "./panes";
import * as T from "./tabs";
import type { TabsState } from "./tabs";

/** Tabs showing `paths`, the first active. */
function tabsFor(...paths: string[]): TabsState {
  let s = T.initialTabs();
  paths.forEach((path, i) => (s = T.navigate(s, { path, view: "note" }, { newTab: i > 0 })));
  return T.activate(s, s.list[0]!.id);
}

const paths = (s: TabsState | undefined) => s?.list.map((t) => t.path);
const shape = (n: P.PaneNode, w: P.Workspace): unknown =>
  n.kind === "pane"
    ? paths(w.tabs[n.id])
    : { [n.dir]: n.children.map((c) => shape(c, w)), sizes: n.sizes.map((x) => +x.toFixed(3)) };

describe("split panes", () => {
  it("splits a pane by dropping a tab on its edge, and moves it back by its middle", () => {
    const w0 = P.singlePane(tabsFor("A.md", "B.md"));
    const a = w0.focused;
    const bTab = w0.tabs[a]!.list[1]!.id;

    const w1 = P.dropOnPane(w0, bTab, a, a, "right");
    expect(shape(w1.root, w1)).toEqual({ row: [["A.md"], ["B.md"]], sizes: [0.5, 0.5] });
    const b = P.paneIds(w1.root)[1]!;
    expect(w1.focused).toBe(b);
    expect(T.activeTab(w1.tabs[b]!).path).toBe("B.md");

    // Below the right pane: a column inside the row.
    const w2 = P.dropOnPane(
      P.dropOnPane(w1, w1.tabs[a]!.list[0]!.id, a, b, "center"),
      w1.tabs[a]!.list[0]!.id,
      b,
      b,
      "bottom",
    );
    // A's only tab went into B, so A closed; then it split B downwards.
    expect(shape(w2.root, w2)).toEqual({ column: [["B.md"], ["A.md"]], sizes: [0.5, 0.5] });
  });

  it("can't split a pane off its only tab, and a middle drop on itself does nothing", () => {
    const w = P.singlePane(tabsFor("A.md"));
    const id = w.tabs[w.focused]!.list[0]!.id;
    expect(P.dropOnPane(w, id, w.focused, w.focused, "left")).toBe(w);
    expect(P.dropOnPane(w, id, w.focused, w.focused, "center")).toBe(w);
  });

  it("adds panes beside each other in the same split, sharing the target's space", () => {
    let w = P.singlePane(tabsFor("A.md", "B.md", "C.md"));
    const a = w.focused;
    w = P.dropOnPane(w, w.tabs[a]!.list[2]!.id, a, a, "right");
    w = P.dropOnPane(w, w.tabs[a]!.list[1]!.id, a, a, "right");
    expect(shape(w.root, w)).toEqual({
      row: [["A.md"], ["B.md"], ["C.md"]],
      sizes: [0.25, 0.25, 0.5],
    });
  });

  it("moves a tab into another pane's tab row, closing the pane it leaves empty", () => {
    let w = P.singlePane(tabsFor("A.md", "B.md", "C.md"));
    const a = w.focused;
    w = P.dropOnPane(w, w.tabs[a]!.list[2]!.id, a, a, "left");
    const c = w.focused;
    w = P.moveToPane(w, w.tabs[a]!.list[1]!.id, a, c, 0);
    expect(paths(w.tabs[c])).toEqual(["B.md", "C.md"]);
    expect(T.activeTab(w.tabs[c]!).path).toBe("B.md");
    w = P.moveToPane(w, w.tabs[a]!.list[0]!.id, a, c, 2);
    expect(P.paneIds(w.root)).toEqual([c]);
    expect(paths(w.tabs[c])).toEqual(["B.md", "C.md", "A.md"]);
    // A moved tab isn't "closed".
    expect(w.tabs[c]!.closed).toEqual([]);
  });

  it("closes a pane, giving its space and focus to a neighbour", () => {
    let w = P.singlePane(tabsFor("A.md", "B.md"));
    const a = w.focused;
    w = P.splitPane(w, a, "bottom");
    expect(shape(w.root, w)).toEqual({ column: [["A.md", "B.md"], ["A.md"]], sizes: [0.5, 0.5] });
    w = P.closePane(w, w.focused);
    expect(w.root).toEqual({ kind: "pane", id: a });
    expect(w.focused).toBe(a);
    expect(P.closePane(w, a)).toBe(w); // the last pane stays
  });

  it("resizes by dragging a divider, keeping each side a minimum share", () => {
    expect(P.dragDivider([0.5, 0.5], 0, 0.3)).toEqual([0.3, 0.7]);
    expect(P.dragDivider([0.5, 0.5], 0, 0.01)).toEqual([P.MIN_SHARE, 1 - P.MIN_SHARE]);
    const out = P.dragDivider([0.2, 0.3, 0.5], 1, 0.6);
    expect(out.map((x) => +x.toFixed(3))).toEqual([0.2, 0.4, 0.4]);
  });

  it("lays panes out with the edges each touches, and the dividers between them", () => {
    let w = P.singlePane(tabsFor("A.md", "B.md", "C.md"));
    const a = w.focused;
    w = P.dropOnPane(w, w.tabs[a]!.list[2]!.id, a, a, "right");
    const c = w.focused;
    w = P.dropOnPane(w, w.tabs[a]!.list[1]!.id, a, c, "bottom");
    const { panes, dividers } = P.layout(w.root);
    expect(panes.map((p) => [p.rect, p.edges])).toEqual([
      [
        { x: 0, y: 0, w: 0.5, h: 1 },
        { top: true, left: true, right: false, bottom: true },
      ],
      [
        { x: 0.5, y: 0, w: 0.5, h: 0.5 },
        { top: true, left: false, right: true, bottom: false },
      ],
      [
        { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
        { top: false, left: false, right: true, bottom: true },
      ],
    ]);
    expect(dividers.map((d) => [d.dir, d.at])).toEqual([
      ["row", 0.5],
      ["column", 0.5],
    ]);
  });

  it("finds the drop zone under the pointer", () => {
    const r = { x: 0, y: 0, w: 100, h: 100 };
    expect(P.zoneAt(r, 50, 50)).toBe("center");
    expect(P.zoneAt(r, 10, 50)).toBe("left");
    expect(P.zoneAt(r, 95, 40)).toBe("right");
    expect(P.zoneAt(r, 50, 5)).toBe("top");
    expect(P.zoneAt(r, 60, 90)).toBe("bottom");
  });

  it("saves and restores the layout and each pane's tabs", () => {
    let w = P.singlePane(tabsFor("A.md", "B.md", "C.md"));
    const a = w.focused;
    w = P.dropOnPane(w, w.tabs[a]!.list[2]!.id, a, a, "right");
    w = P.resizeSplit(w, (w.root as { id: string }).id, [0.3, 0.7]);
    const back = P.deserialize(P.serialize(w))!;
    expect(shape(back.root, back)).toEqual({
      row: [["A.md", "B.md"], ["C.md"]],
      sizes: [0.3, 0.7],
    });
    expect(P.paneIds(back.root).indexOf(back.focused)).toBe(1);
    expect(P.deserialize("nonsense")).toBeNull();
    expect(
      P.deserialize(JSON.stringify({ root: { pane: 3 }, panes: ["{}"], focused: 0 })),
    ).toBeNull();
  });

  it("applies a change to every pane, and knows when one was emptied", () => {
    let w = P.singlePane(tabsFor("A.md", "B.md"));
    const a = w.focused;
    w = P.splitPane(w, a, "right");
    const renamed = P.mapTabs(w, (t) => T.renamePath(t, "A.md", "Z.md"));
    expect(P.paneIds(renamed.root).map((id) => paths(renamed.tabs[id]))).toEqual([
      ["Z.md", "B.md"],
      ["Z.md"],
    ]);
    const b = w.focused;
    const before = w.tabs[b]!;
    expect(P.emptied(before, T.removePath(before, "A.md"))).toBe(true);
    expect(P.emptied(w.tabs[a]!, T.removePath(w.tabs[a]!, "A.md"))).toBe(false);
  });
});
