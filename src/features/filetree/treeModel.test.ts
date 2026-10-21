import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../../ipc";
import {
  canMove,
  displayName,
  dropSide,
  findEntry,
  orderedChildren,
  placeName,
  remapOrder,
  remapPaths,
  renamedName,
  uniqueName,
  visibleRows,
} from "./treeModel";

const file = (path: string): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind: "file",
  modifiedMs: 0,
});
const dir = (path: string, children: VaultEntry[]): VaultEntry => ({
  path,
  name: path.split("/").pop()!,
  kind: "dir",
  modifiedMs: 0,
  children,
});

const tree = dir("", [
  dir("School", [dir("School/Math", [file("School/Math/Calc.md")]), file("School/Bio.md")]),
  file("Ideas.md"),
]);
tree.name = "Vault";

describe("treeModel", () => {
  it("lists only rows under expanded folders, with depth", () => {
    expect(visibleRows(tree, new Set()).map((r) => r.entry.path)).toEqual(["School", "Ideas.md"]);
    const rows = visibleRows(tree, new Set(["School", "School/Math"]));
    expect(rows.map((r) => [r.entry.path, r.depth])).toEqual([
      ["School", 1],
      ["School/Math", 2],
      ["School/Math/Calc.md", 3],
      ["School/Bio.md", 2],
      ["Ideas.md", 1],
    ]);
  });

  it("finds entries by path", () => {
    expect(findEntry(tree, "School/Math/Calc.md")?.name).toBe("Calc.md");
    expect(findEntry(tree, "")).toBe(tree);
    expect(findEntry(tree, "Nope.md")).toBeNull();
  });

  it("picks the first free Untitled name, case-insensitively", () => {
    expect(uniqueName(["a.md"], "Untitled", ".md")).toBe("Untitled.md");
    expect(uniqueName(["untitled.md", "Untitled 1.md"], "Untitled", ".md")).toBe("Untitled 2.md");
    expect(uniqueName(["Untitled folder"], "Untitled folder")).toBe("Untitled folder 1");
  });

  it("keeps .md on rename and ignores no-op renames", () => {
    expect(renamedName(file("a.md"), "Plan")).toBe("Plan.md");
    expect(renamedName(file("a.md"), "Plan.md")).toBe("Plan.md");
    expect(renamedName(file("a.md"), "  a ")).toBeNull();
    expect(renamedName(file("a.md"), "   ")).toBeNull();
    expect(renamedName(file("pic.png"), "photo.png")).toBe("photo.png");
    expect(renamedName(file("Budget.axgrid"), "Costs")).toBe("Costs.axgrid");
    expect(renamedName(dir("Old", []), "New")).toBe("New");
  });

  it("shows notes without .md", () => {
    expect(displayName(file("x/Note.md"))).toBe("Note");
    expect(displayName(file("x/data.csv"))).toBe("data.csv");
    expect(displayName(file("Budget.axgrid"))).toBe("Budget");
  });

  it("rejects moves into self, descendants, or the current folder", () => {
    expect(canMove("School", "School/Math")).toBe(false);
    expect(canMove("School", "School")).toBe(false);
    expect(canMove("School/Bio.md", "School")).toBe(false);
    expect(canMove("Ideas.md", "")).toBe(false);
    expect(canMove("Ideas.md", "School")).toBe(true);
    expect(canMove("School/Bio.md", "")).toBe(true);
    // A sibling whose name shares a prefix is not a descendant.
    expect(canMove("School", "Schoolwork")).toBe(true);
  });

  it("remaps expanded paths after a folder rename", () => {
    const out = remapPaths(["School", "School/Math", "Schoolwork", "Other"], "School", "Uni");
    expect([...out].sort()).toEqual(["Other", "Schoolwork", "Uni", "Uni/Math"]);
  });

  it("puts items in the custom order, unlisted ones after", () => {
    const rows = visibleRows(tree, new Set(["School"]), {
      "": ["Ideas.md", "Gone.md"],
      School: ["Bio.md"],
    });
    expect(rows.map((r) => r.entry.path)).toEqual([
      "Ideas.md",
      "School",
      "School/Bio.md",
      "School/Math",
    ]);
    // A hand-edited order that isn't a list is ignored.
    expect(orderedChildren(tree.children!, "Ideas.md")).toBe(tree.children);
  });

  it("drops into the middle of a folder, otherwise before or after", () => {
    expect(dropSide(101, 100, 20, true)).toBe("before");
    expect(dropSide(110, 100, 20, true)).toBe("into");
    expect(dropSide(119, 100, 20, true)).toBe("after");
    expect(dropSide(109, 100, 20, false)).toBe("before");
    expect(dropSide(111, 100, 20, false)).toBe("after");
  });

  it("places a name before or after another", () => {
    expect(placeName(["A", "B", "C"], "C", "A", "before")).toEqual(["C", "A", "B"]);
    expect(placeName(["A", "B", "C"], "A", "C", "after")).toEqual(["B", "C", "A"]);
    expect(placeName(["A", "B"], "New", "B", "before")).toEqual(["A", "New", "B"]);
    expect(placeName(["A"], "New", "Missing", "after")).toEqual(["A", "New"]);
  });

  it("keeps the order through renames, moves and deletes", () => {
    const order = { "": ["School", "Ideas.md"], School: ["Bio.md", "Math"], "School/Math": ["x"] };
    // Renamed in place: the new name keeps its place.
    expect(remapOrder(order, "Ideas.md", "Thoughts.md")).toEqual({
      ...order,
      "": ["School", "Thoughts.md"],
    });
    // A folder renamed: its lists follow it.
    expect(remapOrder(order, "School", "Uni")).toEqual({
      "": ["Uni", "Ideas.md"],
      Uni: ["Bio.md", "Math"],
      "Uni/Math": ["x"],
    });
    // Moved elsewhere or deleted: it leaves its old list.
    expect(remapOrder(order, "School/Bio.md", "Bio.md")?.School).toEqual(["Math"]);
    expect(remapOrder(order, "School/Math", null)).toEqual({
      "": ["School", "Ideas.md"],
      School: ["Bio.md"],
    });
    expect(remapOrder(order, "Other.md", "New.md")).toBeNull();
  });
});
