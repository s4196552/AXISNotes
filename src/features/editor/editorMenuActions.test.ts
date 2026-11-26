import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  colorSelection,
  copyRange,
  cutRange,
  formatSelection,
  insertBlock,
  paragraphKind,
  pasteText,
  plainText,
  selectionColor,
  toggleParagraph,
} from "./editorMenuActions";

beforeAll(() => {
  // jsdom has no layout: CodeMirror measures text through Range rects.
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

/** An editor holding `doc`, where `«` and `»` mark the selection (or `|` the caret). */
function make(doc: string): EditorView {
  let anchor = doc.indexOf("«");
  let head: number;
  if (anchor >= 0) {
    doc = doc.replace("«", "");
    head = doc.indexOf("»");
    doc = doc.replace("»", "");
  } else {
    anchor = head = Math.max(0, doc.indexOf("|"));
    doc = doc.replace("|", "");
  }
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: EditorSelection.range(anchor, head),
      extensions: [markdown({ base: markdownLanguage })],
    }),
  });
  return view;
}

const text = (v: EditorView) => v.state.doc.toString();
const selected = (v: EditorView) =>
  v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);

describe("Format", () => {
  it("wraps and unwraps the selection", () => {
    const v = make("a «word» here");
    formatSelection(v, "bold");
    expect(text(v)).toBe("a **word** here");
    expect(selected(v)).toBe("word");
    formatSelection(v, "bold");
    expect(text(v)).toBe("a word here");
    formatSelection(v, "highlight");
    expect(text(v)).toBe("a ==word== here");
    formatSelection(v, "strikethrough");
    expect(text(v)).toBe("a ==~~word~~== here");
  });

  it("puts an empty pair at the caret with nothing selected", () => {
    const v = make("a |b");
    formatSelection(v, "italic");
    expect(text(v)).toBe("a **b");
    expect(v.state.selection.main.head).toBe(3);
  });
});

describe("Color", () => {
  it("colours the selection, changes the colour, and takes it off", () => {
    const v = make("say «hello world» now");
    colorSelection(v, "green");
    expect(text(v)).toBe("say `green`hello world`` now");
    expect(selected(v)).toBe("hello world");
    expect(selectionColor(v.state)).toBe("green");
    colorSelection(v, "blue");
    expect(text(v)).toBe("say `blue`hello world`` now");
    colorSelection(v, "blue");
    expect(text(v)).toBe("say hello world now");
    expect(selected(v)).toBe("hello world");
  });

  it("colours each selected line, and leaves a tag at the caret", () => {
    const v = make("«one\ntwo»");
    colorSelection(v, "red");
    expect(text(v)).toBe("`red`one``\n`red`two``");
    const c = make("x |");
    colorSelection(c, "violet");
    expect(text(c)).toBe("x `violet```");
    expect(c.state.selection.main.head).toBe(10);
  });
});

describe("Paragraph", () => {
  it("turns the selected lines into a list, and back", () => {
    const v = make("«one\n\ntwo»");
    toggleParagraph(v, "bullet");
    expect(text(v)).toBe("- one\n\n- two");
    expect(paragraphKind(v.state)).toBe("bullet");
    toggleParagraph(v, "numbered");
    expect(text(v)).toBe("1. one\n\n2. two");
    toggleParagraph(v, "task");
    expect(text(v)).toBe("- [ ] one\n\n- [ ] two");
    toggleParagraph(v, "task");
    expect(text(v)).toBe("one\n\ntwo");
  });

  it("toggles a heading on the caret's line: Heading 2 on a heading 2 removes it", () => {
    const v = make("Ti|tle\nbody");
    toggleParagraph(v, "h2");
    expect(text(v)).toBe("## Title\nbody");
    expect(v.state.selection.main.head).toBe(5);
    toggleParagraph(v, "h3");
    expect(text(v)).toBe("### Title\nbody");
    toggleParagraph(v, "h3");
    expect(text(v)).toBe("Title\nbody");
  });

  it("keeps list indents and drops a list marker for a heading", () => {
    const v = make("  - «item»");
    toggleParagraph(v, "numbered");
    expect(text(v)).toBe("  1. item");
    toggleParagraph(v, "h1");
    expect(text(v)).toBe("# item");
  });

  it("puts lines in the Quote block, and takes the whole quote out again", () => {
    const v = make("before\n«one\ntwo»");
    toggleParagraph(v, "quote");
    expect(text(v)).toBe("before\n> [!NOTE] TITLE\n> one\n> two");
    expect(selected(v)).toBe("TITLE");
    expect(paragraphKind(v.state)).toBe("quote");
    v.dispatch({ selection: { anchor: text(v).indexOf("two") } });
    toggleParagraph(v, "quote");
    expect(text(v)).toBe("before\none\ntwo");
    const titled = make("> [!NOTE] Facts\n> o|ne");
    toggleParagraph(titled, "quote");
    expect(text(titled)).toBe("Facts\none");
  });
});

describe("Insert", () => {
  it("adds blocks below the caret's line, with blank lines around them", () => {
    const v = make("intro|\nnext");
    insertBlock(v, "divider");
    expect(text(v)).toBe("intro\n\n---\n\nnext");
    const t = make("|");
    insertBlock(t, "table");
    expect(text(t)).toBe("| Column | Column |\n| --- | --- |\n| | |");
    expect(selected(t)).toBe("Column");
    const m = make("x|");
    insertBlock(m, "math");
    expect(text(m)).toBe("x\n\n$$\n\n$$");
    expect(m.state.selection.main.head).toBe(6);
    const c = make("|");
    insertBlock(c, "callout");
    expect(text(c)).toBe("> [!note]\n> ");
  });

  it("turns the selected lines into the block", () => {
    const v = make("«a\tb\nc\td»");
    insertBlock(v, "table");
    expect(text(v)).toBe("| a | b |\n| --- | --- |\n| c | d |");
    const m = make("p\n«x^2»");
    insertBlock(m, "math");
    expect(text(m)).toBe("p\n\n$$\nx^2\n$$");
    const c = make("«tip\nmore»");
    insertBlock(c, "callout");
    expect(text(c)).toBe("> [!note]\n> tip\n> more");
    const code = make("«let x»");
    insertBlock(code, "code");
    expect(text(code)).toBe("```\nlet x\n```");
  });

  it("numbers footnotes and puts the caret in the new one at the end", () => {
    const v = make("A fact|.\n\n[^1]: Old.");
    insertBlock(v, "footnote");
    expect(text(v)).toBe("A fact[^2].\n\n[^1]: Old.\n[^2]: ");
    expect(v.state.selection.main.head).toBe(text(v).length);
    const w = make("Plain|");
    insertBlock(w, "footnote");
    expect(text(w)).toBe("Plain[^1]\n\n[^1]: ");
  });
});

describe("Clipboard", () => {
  it("cuts and copies the selection, or the caret's line", () => {
    const v = make("one\nt|wo\nthree");
    expect(copyRange(v.state).text).toBe("two");
    cutRange(v);
    expect(text(v)).toBe("one\nthree");
    const s = make("a «bc» d");
    expect(copyRange(s.state).text).toBe("bc");
    cutRange(s);
    expect(text(s)).toBe("a  d");
    pasteText(s, "XY");
    expect(text(s)).toBe("a XY d");
  });

  it("strips formatting and HTML for Paste as plain text", () => {
    expect(
      plainText(
        "# Title\n> **bold** and *it* and ~~gone~~ ==hi== `code`\n- [link](http://x) [[Note|alias]] [[Other]]",
      ),
    ).toBe("Title\nbold and it and gone hi code\n- link alias Other");
    expect(plainText("<p>Hello <b>you</b> &amp; me</p><br>snake_case_name")).toBe(
      "Hello you & me\nsnake_case_name",
    );
    expect(plainText("`green`tinted``")).toBe("tinted");
  });
});
