import { describe, expect, it } from "vitest";
import {
  findTags,
  findWikilinks,
  maskCode,
  noteName,
  splitFrontmatter,
  withFrontmatter,
} from "./markdown";

describe("markdown helpers", () => {
  it("splits frontmatter and parses YAML", () => {
    const text = "---\nstatus: done\ntags: [a, b/c]\n---\n# Body";
    const fm = splitFrontmatter(text);
    expect(fm.props).toEqual({ status: "done", tags: ["a", "b/c"] });
    expect(text.slice(fm.length)).toBe("# Body");
    expect(splitFrontmatter("no\n---\nx: 1\n---").length).toBe(0);
    expect(splitFrontmatter("---\nbad: [\n---\nbody").props).toEqual({});
  });

  it("rewrites frontmatter keeping order and comments, and removes it when empty", () => {
    const text = "---\n# keep me\nb: 1\na: 2\n---\nBody";
    expect(withFrontmatter(text, { b: 3, a: 2, c: "new" })).toBe(
      "---\n# keep me\nb: 3\na: 2\nc: new\n---\nBody",
    );
    expect(withFrontmatter(text, {})).toBe("Body");
    // Untouched values keep their formatting.
    const flow = "---\nstatus: draft\naliases: [PA]\n---\nB";
    expect(withFrontmatter(flow, { status: "done", aliases: ["PA"] })).toBe(
      "---\nstatus: done\naliases: [PA]\n---\nB",
    );
    expect(withFrontmatter("Body", { status: "draft" })).toBe("---\nstatus: draft\n---\n\nBody");
  });

  it("finds wikilinks outside code with headings, blocks, aliases and embeds", () => {
    const text = "[[A]] `[[no]]` ![[B#^x|alias]]\n```\n[[C]]\n```\n[[D#Head]]";
    const links = findWikilinks(text);
    expect(links.map((l) => l.target)).toEqual(["A", "B", "D"]);
    expect(links[1]).toMatchObject({ embed: true, block: "x", alias: "alias" });
    expect(links[2]).toMatchObject({ heading: "Head" });
    expect(text.slice(links[1]!.from, links[1]!.to)).toBe("![[B#^x|alias]]");
  });

  it("finds tags like the Rust indexer", () => {
    const text = "---\ntags: [Work/Beta]\n---\n#real a#b #123 #work/alpha/ `#code` (#paren) ## H";
    expect(findTags(text)).toEqual(["real", "work/alpha", "paren", "work/beta"]);
  });

  it("masks code keeping offsets", () => {
    const t = "a `b` c\n```\nx\n```\nd";
    const m = maskCode(t);
    expect(m.length).toBe(t.length);
    expect(m).toBe("a     c\n   \n \n   \nd");
  });

  it("derives note names", () => {
    expect(noteName("A/B/Note.md")).toBe("Note");
    expect(noteName("pic.png")).toBe("pic.png");
  });
});
