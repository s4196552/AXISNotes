import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { inlineMarks, toggleMark } from "./inlineMarks";
import { listAutoformat } from "./listAutoformat";
import { math } from "./math";

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

/** An editor holding `doc` with the cursor at `|`, or a selection between two `|`s. */
function editor(doc = "") {
  const marks = [...doc.matchAll(/\|/g)].map((m, i) => m.index! - i);
  const text = doc.replace(/\|/g, "");
  const selection =
    marks.length === 2
      ? EditorSelection.single(marks[0]!, marks[1]!)
      : EditorSelection.cursor(marks[0] ?? text.length);
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: text,
      selection,
      extensions: [
        inlineMarks,
        listAutoformat,
        math,
        keymap.of(markdownKeymap),
        yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }),
      ],
    }),
  });
  views.push(view);
  return view;
}

/** Type `text` one character at a time, as the input handlers see it. */
function type(view: EditorView, text: string) {
  for (const ch of text) {
    const { from, to } = view.state.selection.main;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((f) =>
        f(view, from, to, ch, () => view.state.update({ changes: { from, to, insert: ch } })),
      );
    if (!handled)
      view.dispatch({ changes: { from, to, insert: ch }, selection: { anchor: from + 1 } });
  }
}

function press(view: EditorView, key: string) {
  if (runScopeHandlers(view, new KeyboardEvent("keydown", { key }), "editor")) return;
  const at = view.state.selection.main.head;
  if (key === "Backspace")
    view.dispatch({ changes: { from: at - 1, to: at }, selection: { anchor: at - 1 } });
  if (key === "Enter")
    view.dispatch({ changes: { from: at, insert: "\n" }, selection: { anchor: at + 1 } });
}

/** The text with `|` at the cursor, or around the selection. */
function shown(view: EditorView) {
  const doc = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  return from === to
    ? doc.slice(0, from) + "|" + doc.slice(from)
    : doc.slice(0, from) + "|" + doc.slice(from, to) + "|" + doc.slice(to);
}

describe("marks close as you type", () => {
  it("puts the cursor between a typed ` or * and its closer", () => {
    const code = editor("Run |");
    type(code, "`");
    expect(shown(code)).toBe("Run `|`");
    type(code, "npm");
    expect(shown(code)).toBe("Run `npm|`");
    const em = editor("a |");
    type(em, "*");
    expect(shown(em)).toBe("a *|*");
  });

  it("grows an empty pair to bold, and steps over the whole closer", () => {
    const view = editor();
    type(view, "**");
    expect(shown(view)).toBe("**|**");
    type(view, "bold**");
    expect(shown(view)).toBe("**bold**|");
    type(view, " then *it*");
    expect(shown(view)).toBe("**bold** then *it*|");
    const both = editor();
    type(both, "***x***!");
    expect(shown(both)).toBe("***x***!|");
    const tick = editor();
    type(tick, "``a``.");
    expect(shown(tick)).toBe("``a``.|");
  });

  it("makes a code block from ``` alone on a line, with the cursor at the language", () => {
    const view = editor("Intro\n|");
    type(view, "```");
    expect(shown(view)).toBe("Intro\n```|\n```");
    type(view, "py");
    expect(shown(view)).toBe("Intro\n```py|\n```");
    // Mid-line it stays an inline span.
    const inline = editor("x |");
    type(inline, "```");
    expect(shown(inline)).toBe("x ```|```");
  });

  it("leaves `* ` for bullets, spaced arithmetic and Enter on a rule as typed", () => {
    const bullet = editor();
    type(bullet, "* milk");
    expect(shown(bullet)).toBe("* milk|");
    const sum = editor("2 |");
    type(sum, "* 3");
    expect(shown(sum)).toBe("2 * 3|");
    const rule = editor("text\n\n|");
    type(rule, "***");
    press(rule, "Enter");
    expect(rule.state.doc.toString()).toBe("text\n\n***\n");
  });

  it("doesn't pair touching a word, after a backslash, or in code and math", () => {
    for (const [doc, typed, expected] of [
      ["2|", "*3", "2*3"],
      ["snake|", "*", "snake*"],
      ["|word", "*", "*word"],
      ["don|", "`t", "don`t"],
      ["\\|", "*", "\\*"],
      ["```\n|\n```", "`", "```\n`\n```"],
      ["$$\n|\n$$", "*", "$$\n*\n$$"],
      ["---\ntitle: |\n---\n", "*", "---\ntitle: *\n---\n"],
    ] as const) {
      const view = editor(doc);
      type(view, typed);
      expect(view.state.doc.toString(), doc).toBe(expected);
    }
  });

  it("takes one mark off each side with Backspace in an empty pair", () => {
    const view = editor();
    type(view, "**");
    press(view, "Backspace");
    expect(shown(view)).toBe("*|*");
    press(view, "Backspace");
    expect(shown(view)).toBe("|");
    // With text inside, Backspace is ordinary.
    const full = editor();
    type(full, "`ab");
    press(full, "Backspace");
    expect(shown(full)).toBe("`a|`");
  });

  it("wraps a selection, keeping it selected", () => {
    const view = editor("say |hello| now");
    type(view, "*");
    expect(shown(view)).toBe("say *|hello|* now");
    type(view, "*");
    expect(shown(view)).toBe("say **|hello|** now");
    const code = editor("|x = 1|");
    type(code, "`");
    expect(shown(code)).toBe("`|x = 1|`");
  });
});

describe("bold, italic and strikethrough commands", () => {
  it("leave the cursor between an empty pair, and close it again", () => {
    const view = editor("a |");
    toggleMark(view, "**");
    expect(shown(view)).toBe("a **|**");
    type(view, "b**c");
    expect(shown(view)).toBe("a **b**c|");
    const off = editor("a |");
    toggleMark(off, "*");
    toggleMark(off, "*");
    expect(shown(off)).toBe("a |");
  });

  it("wrap and unwrap a selection, inside or around its marks", () => {
    const view = editor("one |two| three");
    toggleMark(view, "**");
    expect(shown(view)).toBe("one **|two|** three");
    toggleMark(view, "**");
    expect(shown(view)).toBe("one |two| three");
    const marked = editor("|~~gone~~|");
    toggleMark(marked, "~~");
    expect(shown(marked)).toBe("|gone|");
    // Spaces a double-click took with the word stay outside the marks.
    const spaced = editor("|word |next");
    toggleMark(spaced, "*");
    expect(spaced.state.doc.toString()).toBe("*word* next");
  });

  it("tell bold from italic where they share stars", () => {
    const bold = editor("**|x|**");
    toggleMark(bold, "*");
    expect(shown(bold)).toBe("***|x|***");
    toggleMark(bold, "**");
    expect(shown(bold)).toBe("*|x|*");
    toggleMark(bold, "*");
    expect(shown(bold)).toBe("|x|");
  });
});
