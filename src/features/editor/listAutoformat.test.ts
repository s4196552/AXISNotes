import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { listAutoformat } from "./listAutoformat";
import { math } from "./math";
import { buildDecorations } from "./livePreview";

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

/** An editor holding `doc` with the cursor at `|` (or the end). */
function editor(doc = "") {
  const at = doc.includes("|") ? doc.indexOf("|") : doc.length;
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc: doc.replace("|", ""),
      selection: EditorSelection.cursor(at),
      extensions: [
        listAutoformat,
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

/** The text with `|` at the cursor. */
function shown(view: EditorView) {
  const doc = view.state.doc.toString();
  const at = view.state.selection.main.head;
  return doc.slice(0, at) + "|" + doc.slice(at);
}

describe("lists start as you type", () => {
  it("makes a bullet from a `-` at the start of a line", () => {
    const view = editor();
    type(view, "-");
    expect(shown(view)).toBe("- |");
    type(view, "milk");
    expect(shown(view)).toBe("- milk|");
    const nested = editor("intro\n  |");
    type(nested, "-x");
    expect(shown(nested)).toBe("intro\n  - x|");
  });

  it("absorbs the space you'd type anyway, once", () => {
    const view = editor();
    type(view, "- eggs");
    expect(shown(view)).toBe("- eggs|");
    const twice = editor();
    type(twice, "-  ");
    expect(shown(twice)).toBe("-  |"); // a second space is the user's
  });

  it("makes a numbered list from `1` or `1.` on an empty line", () => {
    const one = editor();
    type(one, "1first");
    expect(shown(one)).toBe("1. first|");
    const dotted = editor();
    type(dotted, "1. second");
    expect(shown(dotted)).toBe("1. second|");
    const later = editor("a\n|");
    type(later, "3.third");
    expect(shown(later)).toBe("a\n3. third|");
  });

  it("leaves ordinary text alone: numbers, times, decimals, dashes and rules", () => {
    for (const text of [
      "10 apples",
      "1:30 pm",
      "1/2 cup",
      "2026 plans",
      "3.5 stars",
      "1.5 h",
      "1,000",
    ]) {
      const view = editor();
      type(view, text);
      expect(view.state.doc.toString(), text).toBe(text);
    }
    const rule = editor("text\n\n|");
    type(rule, "---");
    expect(rule.state.doc.toString()).toBe("text\n\n---");
    const dash = editor();
    type(dash, "--");
    expect(dash.state.doc.toString()).toBe("--");
    // Mid-line, or before something that's already a list marker: just the character.
    const mid = editor("a|");
    type(mid, "-1");
    expect(mid.state.doc.toString()).toBe("a-1");
    const before = editor("|- item");
    type(before, "-");
    expect(before.state.doc.toString()).toBe("-- item");
  });

  it("turns an existing line into a bullet when `-` is typed at its start", () => {
    const view = editor("|buy bread");
    type(view, "-");
    expect(shown(view)).toBe("- |buy bread");
  });

  it("takes the formatting back with Backspace right after it", () => {
    const view = editor();
    type(view, "-");
    backspace(view);
    expect(shown(view)).toBe("-|");
    const num = editor();
    type(num, "1");
    backspace(num);
    expect(shown(num)).toBe("1|");
    // Later, Backspace is ordinary again.
    const later = editor();
    type(later, "-a");
    backspace(later);
    expect(shown(later)).toBe("- |");
  });

  it("forgets the formatting once the cursor moves away", () => {
    const view = editor("x\n|");
    type(view, "-");
    view.dispatch({ selection: { anchor: 0 } });
    view.dispatch({ selection: { anchor: 4 } });
    type(view, " ");
    expect(view.state.doc.toString()).toBe("x\n-  ");
  });

  it("does nothing in code, frontmatter or math", () => {
    const docs = [
      "```\n|\n```",
      "---\ntags: a\n|\n---\nbody",
      "$$\n|\n$$",
      "`|`",
      "    code\n    |", // a blank line in indented code, before it holds any text
      "para\n\n    |", // four spaces of indent after a blank line start indented code
    ];
    for (const doc of docs) {
      for (const typed of ["-x", "1x", "3."]) {
        const view = editor(doc);
        const before = view.state.doc.toString();
        const at = view.state.selection.main.head;
        type(view, typed);
        expect(view.state.doc.toString(), `${typed} in ${doc}`).toBe(
          before.slice(0, at) + typed + before.slice(at),
        );
      }
    }
    // Indented four spaces inside a list is a nested item, not code: still formatted.
    const nested = editor("- a\n    |");
    type(nested, "-b");
    expect(nested.state.doc.toString()).toBe("- a\n    - b");
  });

  it("continues the list on Enter (Markdown's own keymap)", () => {
    const view = editor();
    type(view, "-a");
    const enter = markdownKeymap.find((k) => k.key === "Enter")!.run!;
    enter(view);
    expect(shown(view)).toBe("- a\n- |");
  });
});

describe("bullets in live preview", () => {
  const bullets = (doc: string, cursor: number) => {
    let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
    state = state.update({ selection: EditorSelection.cursor(cursor) }).state;
    const found: number[] = [];
    buildDecorations(state).between(0, doc.length, (from, _to, deco) => {
      if ((deco.spec as { widget?: object }).widget?.constructor.name === "BulletWidget")
        found.push(from);
    });
    return found;
  };

  it("show on the line being typed, except while the cursor is on the dash itself", () => {
    expect(bullets("- milk", 6)).toEqual([0]);
    expect(bullets("- milk", 2)).toEqual([0]);
    expect(bullets("- milk", 1)).toEqual([]);
    expect(bullets("- milk", 0)).toEqual([]);
  });

  it("show for a bullet just started under a paragraph", () => {
    expect(bullets("intro\n- ", 8)).toEqual([6]);
    expect(bullets("```\n- \n```", 6)).toEqual([]);
  });
});
