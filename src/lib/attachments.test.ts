import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../ipc";
import { isImagePath, parseImageEmbed, resolveAttachment } from "./attachments";

const f = (path: string): VaultEntry => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  kind: "file",
  modifiedMs: 0,
});
const d = (path: string, children: VaultEntry[]): VaultEntry => ({
  path,
  name: path,
  kind: "dir",
  modifiedMs: 0,
  children,
});

const tree = d("", [
  f("cat.png"),
  d("School", [f("School/Bio.md"), f("School/cat.png"), f("School/diagram.svg")]),
  d("Clippings", [d("Clippings/attachments", [f("Clippings/attachments/Chart 1.png")])]),
]);

describe("attachments", () => {
  it("recognizes images and Obsidian's size syntax", () => {
    expect(isImagePath("a/b.JPG")).toBe(true);
    expect(isImagePath("a/b.md")).toBe(false);
    expect(parseImageEmbed("cat.png|300")).toEqual({ target: "cat.png", width: 300 });
    expect(parseImageEmbed("cat.png|300x200")).toEqual({ target: "cat.png", width: 300 });
    expect(parseImageEmbed("cat.png|a caption")).toEqual({ target: "cat.png", width: null });
  });

  it("resolves full paths, then the note's folder, then anywhere", () => {
    expect(resolveAttachment("School/diagram.svg", "x.md", tree)).toBe("School/diagram.svg");
    expect(resolveAttachment("cat.png", "School/Bio.md", tree)).toBe("School/cat.png");
    expect(resolveAttachment("cat.png", "Other.md", tree)).toBe("cat.png");
    expect(resolveAttachment("Chart 1.png", "Clippings/Chart.md", tree)).toBe(
      "Clippings/attachments/Chart 1.png",
    );
    expect(resolveAttachment("CAT.PNG", "School/Bio.md", tree)).toBe("School/cat.png");
    expect(resolveAttachment("missing.png", "x.md", tree)).toBeNull();
  });
});
