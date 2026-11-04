import { markdown } from "@codemirror/lang-markdown";
import { foldable, foldedRanges } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { listItemAt, listItemSpans, outlineFolding } from "./outliner";
import { outlinerKeys } from "./outlinerView";
import { flipHeading, flipListItem, restoreFolds, toggles, viewFolds } from "./toggles";

// Fold arrows for headings, bulleted/numbered/task list items and toggles (T-161).

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

function viewWith(doc: string, cursor = 0) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown(), outlinerKeys, toggles],
    }),
  });
  views.push(view);
  return view;
}

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [outlineFolding] });

/** The text a fold on line `n` would hide, or null if the line doesn't fold. */
function hidden(state: EditorState, n: number) {
  const line = state.doc.line(n);
  const range = foldable(state, line.from, line.to);
  return range ? state.sliceDoc(range.from, range.to) : null;
}

/** Lines a view fold hides, by the fold's first line. */
function folded(view: EditorView) {
  const { state } = view;
  return viewFolds(state).map((r) => state.doc.lineAt(r.from).number);
}

const lineOf = (state: EditorState, text: string) => {
  for (let n = 1; n <= state.doc.lines; n++) if (state.doc.line(n).text === text) return n;
  throw new Error(`no line ${text}`);
};

const NOTE = [
  "# Cells", // 1
  "Intro", // 2
  "- Organelles", // 3
  "  - Nucleus", // 4
  "    - DNA", // 5
  "  - Ribosome", // 6
  "1. Steps", // 7
  "   1. First", // 8
  "   2. Second", // 9
  "- [ ] Revise", // 10
  "  - [x] Flashcards", // 11
  "- Leaf", // 12
  "## Detail", // 13
  "Deep", // 14
  "# Next", // 15
  "End", // 16
].join("\n");

describe("fold ranges", () => {
  const state = stateOf(NOTE);

  it("folds a heading to the next heading of the same or a higher level", () => {
    expect(hidden(state, 1)).toBe(state.sliceDoc(state.doc.line(1).to, state.doc.line(14).to));
    expect(hidden(state, 13)).toBe("\nDeep");
  });

  it("folds a bullet's nested children at any depth", () => {
    expect(hidden(state, 3)).toBe("\n  - Nucleus\n    - DNA\n  - Ribosome");
    expect(hidden(state, 4)).toBe("\n    - DNA");
    expect(hidden(state, 5)).toBeNull();
    expect(hidden(state, 6)).toBeNull();
  });

  it("folds numbered items and tasks the same way", () => {
    expect(hidden(state, 7)).toBe("\n   1. First\n   2. Second");
    expect(hidden(state, 8)).toBeNull();
    expect(hidden(state, 10)).toBe("\n  - [x] Flashcards");
    expect(hidden(state, 12)).toBeNull();
  });

  it("keeps a blank line inside an item only when more of the item follows", () => {
    const s = stateOf(["- A", "  - a1", "", "  - a2", "", "- B"].join("\n"));
    expect(hidden(s, 1)).toBe("\n  - a1\n\n  - a2");
  });

  it("finds no list items in code or frontmatter", () => {
    const s = stateOf(
      ["---", "tags:", "  - x", "  - y", "---", "```", "- code", "  - child", "```"].join("\n"),
    );
    expect([...listItemSpans(s).keys()]).toEqual([]);
    expect(hidden(s, 2)).toBeNull();
    expect(hidden(s, 7)).toBeNull();
  });

  it("agrees with the outliner's list items", () => {
    const doc = [
      "- a",
      "  continued",
      "  - b",
      "",
      "    deeper",
      "",
      "- c",
      "\t- tab child",
      "Paragraph",
      "* star",
      "  + plus",
      "10) ten",
      "    - nested",
      "- last",
      "",
    ].join("\n");
    const s = stateOf(doc);
    const spans = listItemSpans(s);
    for (const [first, last] of spans) expect(listItemAt(s, first)?.last).toBe(last);
    expect(spans.size).toBe(9);
  });
});

describe("fold arrows", () => {
  const arrows = (view: EditorView) => [
    ...view.contentDOM.querySelectorAll<HTMLElement>(".cm-list-arrow"),
  ];
  const press = (el: HTMLElement) =>
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));

  it("draws an arrow on every list item with children, and only those", () => {
    const view = viewWith(NOTE);
    const lines = arrows(view).map((a) => view.state.doc.lineAt(view.posAtDOM(a)).number);
    expect(lines).toEqual([3, 4, 7, 10]);
    expect(arrows(view).every((a) => a.getAttribute("aria-label") === "Collapse list item")).toBe(
      true,
    );
  });

  it("folds and unfolds an item from its arrow without changing the note", () => {
    const view = viewWith(NOTE);
    press(arrows(view)[0]!);
    expect(folded(view)).toEqual([3]);
    expect(view.state.doc.toString()).toBe(NOTE);
    const closed = view.contentDOM.querySelector<HTMLElement>(
      ".cm-list-arrow:not(.cm-toggle-open)",
    )!;
    expect(closed.getAttribute("aria-label")).toBe("Expand list item");
    expect(closed.closest(".cm-line")!.classList.contains("cm-li-folded")).toBe(true);
    press(closed);
    expect(folded(view)).toEqual([]);
    expect(view.contentDOM.querySelector(".cm-li-folded")).toBeNull();
  });

  it("moves a cursor out of the children it folds", () => {
    const view = viewWith(NOTE, NOTE.indexOf("DNA"));
    flipListItem(view, view.state.doc.line(3).from);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(3).to);
  });

  it("nests: a parent fold keeps its children's folds for when it opens again", () => {
    const view = viewWith(NOTE);
    const doc = view.state.doc;
    flipListItem(view, doc.line(4).from); // Nucleus
    flipListItem(view, doc.line(3).from); // Organelles, around it
    flipHeading(view, doc.line(1).from); // # Cells, around both
    expect(folded(view)).toEqual([1, 3, 4]);
    flipHeading(view, doc.line(1).from);
    expect(folded(view)).toEqual([3, 4]);
    flipListItem(view, doc.line(3).from);
    expect(folded(view)).toEqual([4]);
    expect(view.state.doc.toString()).toBe(NOTE);
  });

  it("unfolds an item that has grown since it was folded", () => {
    const view = viewWith("- A\n  - a1\n- B");
    flipListItem(view, 0);
    // A new child typed at the end makes A's range longer than its fold.
    view.dispatch({ changes: { from: view.state.doc.length - 4, insert: "\n  - a2" } });
    expect(folded(view)).toEqual([1]);
    flipListItem(view, 0);
    expect(folded(view)).toEqual([]);
  });
});

describe("fold keys", () => {
  // As a US keyboard sends them: Shift turns [ into {.
  const key = (view: EditorView, k: "[" | "]") =>
    runScopeHandlers(
      view,
      new KeyboardEvent("keydown", {
        key: k === "[" ? "{" : "}",
        code: k === "[" ? "BracketLeft" : "BracketRight",
        keyCode: k === "[" ? 219 : 221,
        ctrlKey: true,
        shiftKey: true,
      }),
      "editor",
    );

  it("Ctrl+Shift+[ and ] fold and unfold the list item or heading at the cursor", () => {
    const view = viewWith(NOTE, NOTE.indexOf("Steps"));
    expect(key(view, "[")).toBe(true);
    expect(folded(view)).toEqual([7]);
    view.dispatch({ selection: { anchor: view.state.doc.line(7).from } });
    expect(key(view, "]")).toBe(true);
    expect(folded(view)).toEqual([]);
  });

  it("closes and opens a toggle with its arrow's +/- on its title", () => {
    const doc = "> [!toggle]+ Facts\n> inside\n\nAfter";
    const view = viewWith(doc, 3);
    expect(key(view, "[")).toBe(true);
    expect(view.state.doc.line(1).text).toBe("> [!toggle]- Facts");
    expect(key(view, "]")).toBe(true);
    expect(view.state.doc.line(1).text).toBe("> [!toggle]+ Facts");
  });
});

describe("fold memory", () => {
  it("brings back folds that still match the note, and drops ones that don't", () => {
    const view = viewWith(NOTE);
    const doc = view.state.doc;
    flipListItem(view, doc.line(3).from);
    flipListItem(view, doc.line(10).from);
    const saved = viewFolds(view.state);
    const fresh = EditorState.create({ doc: NOTE, extensions: [outlineFolding, toggles] });
    const restored = fresh.update({ effects: restoreFolds(fresh, saved) }).state;
    expect(viewFolds(restored)).toEqual(saved);

    // The Revise task lost its child: only the first fold still applies.
    const changed = EditorState.create({
      doc: NOTE.replace("\n  - [x] Flashcards", ""),
      extensions: [outlineFolding, toggles],
    });
    const effects = restoreFolds(changed, saved);
    expect(effects).toHaveLength(1);
    const next = changed.update({ effects }).state;
    expect(foldedRanges(next).size).toBe(1);
    expect(next.doc.lineAt(viewFolds(next)[0]!.from).number).toBe(lineOf(next, "- Organelles"));
  });

  it("ignores saved ranges past the end of a shorter note", () => {
    const s = EditorState.create({ doc: "- a", extensions: [outlineFolding, toggles] });
    expect(restoreFolds(s, [{ from: 3, to: 99 }])).toEqual([]);
  });
});
