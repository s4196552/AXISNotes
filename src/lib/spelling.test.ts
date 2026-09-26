import { describe, expect, it } from "vitest";
import { normalizeWord, proseWords } from "./spelling";

const words = (line: string) => proseWords(line).map((w) => w.word);

describe("proseWords", () => {
  it("finds plain words with positions", () => {
    expect(proseWords("Helo world", 10)).toEqual([
      { from: 10, to: 14, word: "Helo" },
      { from: 15, to: 20, word: "world" },
    ]);
  });

  it("keeps apostrophes and hyphenated parts", () => {
    expect(words("don’t well-knwn")).toEqual(["don’t", "well", "knwn"]);
  });

  it("skips links, tags, code, URLs, emails, block ids and math", () => {
    const line =
      "See [[Some Notte|alias]] and [text](http://exmple.com) `cde` #tagg https://x.io/pth mail@exmple.org $x^2 + yy$ end ^blk-1";
    expect(words(line)).toEqual(["See", "and", "text", "end"]);
  });

  it("skips identifiers, acronyms and words glued to digits", () => {
    expect(words("JavaScript NASA iPhone 3rd v2beta snake_case file.txt ok")).toEqual(["ok"]);
  });

  it("skips single letters, emoji codes, template variables and paths", () => {
    expect(words("a :rocket: {{date}} /usr/lib/thing done")).toEqual(["done"]);
  });

  it("honors extra skip ranges (absolute positions)", () => {
    expect(proseWords("one two three", 100, [[104, 107]]).map((w) => w.word)).toEqual([
      "one",
      "three",
    ]);
  });

  it("normalizes curly apostrophes", () => {
    expect(normalizeWord("don’t")).toBe("don't");
  });
});
