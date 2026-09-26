import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../../ipc";
import {
  canMove,
  displayName,
  findEntry,
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
    expect(renamedName(dir("Old", []), "New")).toBe("New");
  });

  it("shows notes without .md", () => {
    expect(displayName(file("x/Note.md"))).toBe("Note");
    expect(displayName(file("x/data.csv"))).toBe("data.csv");
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
});
