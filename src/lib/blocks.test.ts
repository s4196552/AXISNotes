import { describe, expect, it } from "vitest";
import {
  embedRange,
  ensureBlockId,
  findBlock,
  findSection,
  listBlocks,
  listHeadings,
} from "./blocks";

const NOTE = [
  "---",
  "a: 1",
  "---",
  "# Title",
  "",
  "Intro line one",
  "intro line two ^intro",
  "",
  "- first",
  "- second ^sec",
  "  - child",
  "- third",
  "",
  "## Goals",
  "Ship it.",
  "",
  "## Other",
  "```",
  "code ^nope",
  "```",
].join("\n");

const slice = (r: { from: number; to: number } | null) => (r ? NOTE.slice(r.from, r.to) : null);

describe("blocks", () => {
  it("finds paragraphs and list items (with children) by id, ignoring code", () => {
    expect(slice(findBlock(NOTE, "intro"))).toBe("Intro line one\nintro line two ^intro");
    expect(slice(findBlock(NOTE, "sec"))).toBe("- second ^sec\n  - child");
    expect(findBlock(NOTE, "nope")).toBeNull();
    expect(findBlock(NOTE, "missing")).toBeNull();
    const own = "para\n^solo";
    expect(own.slice(findBlock(own, "solo")!.from, findBlock(own, "solo")!.to)).toBe("para\n^solo");
  });

  it("finds heading sections and whole-note bodies", () => {
    expect(slice(findSection(NOTE, "goals"))).toBe("## Goals\nShip it.");
    expect(findSection(NOTE, "missing")).toBeNull();
    expect(slice(embedRange(NOTE, {}))!.startsWith("# Title")).toBe(true);
    expect(slice(embedRange(NOTE, { heading: "Goals" }))).toBe("## Goals\nShip it.");
  });

  it("adds a block id where Obsidian would, or reuses the existing one", () => {
    const pos = NOTE.indexOf("third");
    const r = ensureBlockId(NOTE, pos, () => "abc123")!;
    expect(r.id).toBe("abc123");
    expect(r.text).toContain("- third ^abc123");
    expect(ensureBlockId(NOTE, NOTE.indexOf("child"), () => "zzz")!.text).toContain(
      "  - child ^zzz",
    );
    expect(ensureBlockId(NOTE, NOTE.indexOf("Intro"))).toEqual({ text: NOTE, id: "intro" });
    const para = "one\ntwo";
    expect(ensureBlockId(para, 1, () => "p1")!.text).toBe("one\ntwo ^p1");
    expect(ensureBlockId(NOTE, NOTE.indexOf("# Title"))).toBeNull();
  });

  it("lists referenceable blocks and headings", () => {
    const blocks = listBlocks(NOTE);
    expect(blocks.map((b) => [b.label, b.id])).toEqual([
      ["Intro line one", "intro"],
      ["first", null],
      ["second", "sec"],
      ["child", null],
      ["third", null],
      ["Ship it.", null],
    ]);
    expect(listHeadings(NOTE)).toEqual(["Title", "Goals", "Other"]);
  });
});
