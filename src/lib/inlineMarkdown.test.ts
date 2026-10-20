import { describe, expect, it } from "vitest";
import { plainInline, tokenizeInline, wikilinkLabel } from "./inlineMarkdown";

describe("inline Markdown", () => {
  it("splits links, code and emphasis from plain text", () => {
    expect(tokenizeInline("Read [[Biology#Cells|cells]] and `npm i` **now**")).toEqual([
      { kind: "text", text: "Read " },
      { kind: "wikilink", text: "cells", inner: "Biology#Cells|cells" },
      { kind: "text", text: " and " },
      { kind: "code", text: "npm i" },
      { kind: "text", text: " " },
      { kind: "bold", text: "now" },
    ]);
    expect(tokenizeInline("*a* _b_ ~~c~~ __d__ [site](https://x.dev)")).toEqual([
      { kind: "italic", text: "a" },
      { kind: "text", text: " " },
      { kind: "italic", text: "b" },
      { kind: "text", text: " " },
      { kind: "strike", text: "c" },
      { kind: "text", text: " " },
      { kind: "bold", text: "d" },
      { kind: "text", text: " " },
      { kind: "link", text: "site", url: "https://x.dev" },
    ]);
  });

  it("leaves look-alikes as text: snake_case, lone stars, maths, unclosed marks", () => {
    for (const text of ["call my_fn_name", "2 * 3 * 4", "a ** b", "**open", "[[open", "`tick"]) {
      expect(tokenizeInline(text)).toEqual([{ kind: "text", text }]);
    }
    // Markdown inside code stays literal.
    expect(tokenizeInline("`**x**`")).toEqual([{ kind: "code", text: "**x**" }]);
  });

  it("labels wikilinks by alias, else the note name with any heading or block", () => {
    expect(wikilinkLabel("School/Biology.md")).toBe("Biology");
    expect(wikilinkLabel("Biology#Cells")).toBe("Biology › Cells");
    expect(wikilinkLabel("Biology#^b1")).toBe("Biology › b1");
    expect(wikilinkLabel("Biology|Bio ")).toBe("Bio");
    expect(wikilinkLabel("#Local")).toBe("Local");
  });

  it("gives the plain text for labels", () => {
    expect(plainInline("Review [[Welcome]] **soon**")).toBe("Review Welcome soon");
  });
});
