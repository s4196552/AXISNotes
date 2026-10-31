import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { ensureSyntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorSelection, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { findLanguage, inlineCodeLanguage, openCode, taggedCode } from "./inlineCodeLanguage";
import { inlineMarks } from "./inlineMarks";
import { listAutoformat } from "./listAutoformat";
import { buildDecorations } from "./livePreview";
import { symbolAutoformat } from "./symbolAutoformat";
import { axisTheme } from "./theme";

const JAVA = '`Java`String greeting = "Hello, World!";``';

const md = yamlFrontmatter({
  content: markdown({ base: markdownLanguage, codeLanguages: languages }),
});

function state(doc: string, at = doc.length) {
  const s = EditorState.create({ doc, selection: EditorSelection.cursor(at), extensions: [md] });
  ensureSyntaxTree(s, s.doc.length, 5000);
  return s;
}

/** The code each tagged span holds, with its language's name. */
function spans(doc: string) {
  const s = state(doc);
  return taggedCode(s).map((t) => [t.language.name, s.sliceDoc(t.codeFrom, t.codeTo)]);
}

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

function view(doc: string, extensions: Extension[] = [inlineCodeLanguage]) {
  const v = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: [...extensions, md, axisTheme] }),
  });
  views.push(v);
  return v;
}

/** Type `text` one character at a time, as the input handlers see it. */
function type(v: EditorView, text: string) {
  for (const ch of text) {
    const at = v.state.selection.main.head;
    const handled = v.state
      .facet(EditorView.inputHandler)
      .some((f) => f(v, at, at, ch, () => v.state.update({ changes: { from: at, insert: ch } })));
    if (!handled) v.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 } });
  }
}

beforeAll(async () => {
  await Promise.all(["java", "javascript", "python"].map((n) => findLanguage(n)!.load()));
});

describe("language-tagged inline code", () => {
  it("finds languages by name, alias or file extension, in any case", () => {
    expect(findLanguage("Java")?.name).toBe("Java");
    expect(findLanguage("JS")?.name).toBe("JavaScript");
    expect(findLanguage("py")?.name).toBe("Python");
    expect(findLanguage("c++")?.name).toBe("C++");
    expect(findLanguage("notalanguage")).toBeNull();
    expect(findLanguage("the")).toBeNull();
  });

  it("finds a span of code after a language span", () => {
    expect(spans(JAVA)).toEqual([["Java", 'String greeting = "Hello, World!";']]);
    expect(spans("Run `js`console.log(1)`` then `py`print(2)``.")).toEqual([
      ["JavaScript", "console.log(1)"],
      ["Python", "print(2)"],
    ]);
    expect(spans("- item `python`x = 1`` here")).toEqual([["Python", "x = 1"]]);
    expect(spans("`java`int a;`` and `b` and `go`x := 1``")).toEqual([
      ["Java", "int a;"],
      ["Go", "x := 1"],
    ]);
    // A single backtick belongs to the code; a longer run ends it with its last two.
    expect(spans("`js`a = `b`;``")).toEqual([["JavaScript", "a = `b`;"]]);
    expect(spans("`js`x````")).toEqual([["JavaScript", "x``"]]);
  });

  it("leaves ordinary inline code and code-looking text alone", () => {
    expect(spans("Use `python`, `java` or `go`.")).toEqual([]);
    expect(spans("`java` String x;``")).toEqual([]); // a space before the code
    expect(spans("`notalanguage`x = 1``")).toEqual([]);
    expect(spans("`java`x")).toEqual([]); // not closed
    expect(spans("`java`x;`")).toEqual([]); // one backtick doesn't close it
    expect(spans("```\n`java`x = 1``\n```")).toEqual([]);
    expect(spans("---\na: `java`x``\n---\n")).toEqual([]);
    expect(spans("``java`x = 1``")).toEqual([]);
    expect(spans("`npm`'s cache, see `x`")).toEqual([]);
  });

  it("tells when the cursor is in a span still being typed", () => {
    expect(openCode("`Java`String x")).toBe("tagged");
    expect(openCode("a `b` and `Java`String x")).toBe("tagged");
    expect(openCode("`Java`String x;`")).toBe("tagged"); // one of the two closing
    expect(openCode("`Java`String x;``")).toBeNull();
    expect(openCode("`Java`String x;`` and `b")).toBe("code");
    expect(openCode("`Java` String")).toBeNull();
    expect(openCode("`nope`x")).toBeNull();
    expect(openCode("an `open")).toBe("code");
    expect(openCode("plain text")).toBeNull();
  });

  it("colours the code like a code block and hides the backticks off the cursor's line", () => {
    const v = view(JAVA);
    expect(v.contentDOM.textContent).toBe('String greeting = "Hello, World!";');
    expect(v.dom.querySelector(".cm-lp-code")).not.toBeNull();
    expect(v.dom.querySelector(".cm-code-type, .cm-code-keyword")).not.toBeNull();
    expect(v.dom.querySelector(".cm-code-string")?.textContent).toBe('"Hello, World!"');
    expect(v.state.doc.toString()).toBe(JAVA);
  });

  it("loads a language on first use, then colours it", async () => {
    const lang = findLanguage("ruby")!;
    expect(lang.support).toBeUndefined();
    const v = view('`ruby`puts "hi"``');
    expect(v.dom.querySelector(".cm-code-string")).toBeNull();
    await lang.load();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(v.dom.querySelector(".cm-code-string")?.textContent).toBe('"hi"');
  });

  it("keeps live preview from styling inside the span", () => {
    const s = state("**a** " + JAVA + " `b`", 0);
    const [t] = taggedCode(s);
    const inside: number[] = [];
    buildDecorations(s, undefined, false).between(0, s.doc.length, (from) => {
      if (from >= t!.from && from < t!.to) inside.push(from);
    });
    expect(inside).toEqual([]);
    // Outside it, as before: bold and the `b` span are still styled.
    let others = 0;
    buildDecorations(s, undefined, false).between(0, s.doc.length, () => void others++);
    expect(others).toBeGreaterThan(2);
  });

  it("keeps code typed into a span as typed", () => {
    const v = view("", [inlineCodeLanguage, symbolAutoformat, listAutoformat, inlineMarks]);
    type(v, "`Java`String x != y -> *z* + `q`;``");
    expect(v.state.doc.toString()).toBe("`Java`String x != y -> *z* + `q`;``");
    type(v, " a != b");
    expect(v.state.doc.toString()).toBe("`Java`String x != y -> *z* + `q`;`` a ≠ b");
  });
});
