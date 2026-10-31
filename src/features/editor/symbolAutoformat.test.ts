import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { symbolAutoformat } from "./symbolAutoformat";
import { listAutoformat } from "./listAutoformat";
import { inlineMarks } from "./inlineMarks";
import { math } from "./math";

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

/** An editor holding `doc` with the cursor at `|` (or the end), set up as in the app. */
function editor(doc = "") {
  const at = doc.includes("|") ? doc.indexOf("|") : doc.length;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: doc.replace("|", ""),
      selection: EditorSelection.cursor(at),
      extensions: [
        symbolAutoformat,
        listAutoformat,
        inlineMarks,
        math,
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
    const at = view.state.selection.main.head;
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((f) =>
        f(view, at, at, ch, () => view.state.update({ changes: { from: at, insert: ch } })),
      );
    if (!handled)
      view.dispatch({ changes: { from: at, insert: ch }, selection: { anchor: at + 1 } });
  }
}

function backspace(view: EditorView) {
  const event = new KeyboardEvent("keydown", { key: "Backspace" });
  if (runScopeHandlers(view, event, "editor")) return;
  const at = view.state.selection.main.head;
  view.dispatch({ changes: { from: at - 1, to: at }, selection: { anchor: at - 1 } });
}

/** The text after typing `text` into `doc`. */
function typed(text: string, doc = "") {
  const view = editor(doc);
  type(view, text);
  return view.state.doc.toString();
}

describe("arrows and comparison signs as you type", () => {
  it("makes each symbol", () => {
    expect(typed("a -> b")).toBe("a → b");
    expect(typed("a <- b")).toBe("a ← b");
    expect(typed("a <-> b")).toBe("a ↔ b");
    expect(typed("x >= 2")).toBe("x ≥ 2");
    expect(typed("x <= 2")).toBe("x ≤ 2");
    expect(typed("x != 2")).toBe("x ≠ 2");
    expect(typed("x ~= 2")).toBe("x ≈ 2");
    expect(typed("a->b")).toBe("a→b");
  });

  it("makes an arrow at the start of a line, where `-` had become a bullet", () => {
    expect(typed("-> next")).toBe("→ next");
    expect(typed("intro\n  -> next")).toBe("intro\n  → next");
    expect(typed("- a -> b")).toBe("- a → b");
  });

  it("puts back the typed characters on Backspace right after", () => {
    for (const [keys, ascii] of <[string, string][]>[
      ["a ->", "a ->"],
      ["a <->", "a <->"],
      ["x >=", "x >="],
      ["->", "->"],
    ]) {
      const view = editor();
      type(view, keys);
      backspace(view);
      expect(view.state.doc.toString()).toBe(ascii);
      backspace(view); // an ordinary Backspace now
      expect(view.state.doc.toString()).toBe(ascii.slice(0, -1));
    }
  });

  it("lets the next keystroke keep longer ASCII as typed", () => {
    expect(typed("a <--> b")).toBe("a <--> b");
    expect(typed("a !== b")).toBe("a !== b");
    expect(typed("a --> b")).toBe("a --> b");
    expect(typed("--> b")).toBe("--> b");
    expect(typed("a \\-> b")).toBe("a \\-> b");
  });

  it("leaves code, math, frontmatter, comments, links and URLs as typed", () => {
    expect(typed("x != y", "```\n|\n```")).toBe("```\nx != y\n```");
    expect(typed("`x != y")).toBe("`x != y`");
    expect(typed("a `b != c")).toBe("a `b != c`");
    expect(typed("x <= y", "$$|$$")).toBe("$$x <= y$$");
    expect(typed("a: b->c", "---\n|\n---\n")).toBe("---\na: b->c\n---\n");
    expect(typed("a -> b", "<!-- | -->")).toBe("<!-- a -> b -->");
    expect(typed("[[a->b")).toBe("[[a->b");
    expect(typed("see https://x.io/?a!=b")).toBe("see https://x.io/?a!=b");
    expect(typed("[[a]] -> b")).toBe("[[a]] → b");
  });

  it("only works for one plain cursor", () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({
        doc: "a-",
        selection: EditorSelection.create([EditorSelection.cursor(0), EditorSelection.cursor(2)]),
        extensions: [EditorState.allowMultipleSelections.of(true), symbolAutoformat],
      }),
    });
    views.push(view);
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((f) => f(view, 2, 2, ">", () => view.state.update({})));
    expect(handled).toBe(false);
  });
});
