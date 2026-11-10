import { markdown } from "@codemirror/lang-markdown";
import { history, undo } from "@codemirror/commands";
import { foldable, foldedRanges } from "@codemirror/language";
import { EditorState, StateEffect } from "@codemirror/state";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { listItemAt, listItemSpans, outlineFolding } from "./outliner";
import { outlinerKeys } from "./outlinerView";
import {
  flipHeading,
  flipListItem,
  restoreFolds,
  toggleCurrentFold,
  togglePageFolds,
  toggles,
  viewFolds,
} from "./toggles";

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

describe("toggle the block at the caret", () => {
  it.each(["> [!toggle]", "> [!toggle|h2]+", "> [!tip]+"])(
    "uses the saved marker from inside %s and reopens from the title",
    (marker) => {
      const text = `# Outer\n${marker} Title\n> inner text`;
      const view = viewWith(text, text.length);
      expect(toggleCurrentFold(view)).toBe(true);
      expect(view.state.doc.line(2).text).toContain("]- Title");
      expect(view.contentDOM.textContent).not.toContain("inner text");
      expect(toggleCurrentFold(view)).toBe(true);
      expect(view.contentDOM.textContent).toContain("inner text");
      expect(view.state.doc.line(2).text).toContain("]+ Title");
      expect(viewFolds(view.state)).toEqual([]);
    },
  );

  it.each([
    ["# Heading\nparagraph", 1],
    ["# Heading\n- Parent\n  - Inner\n    - Leaf", 3],
    ["> [!toggle|h1]+ Title\n```js\nlet x = 1\n```", 2],
  ] as const)("folds and reopens the nearest view-only block in %s", (doc, line) => {
    const view = viewWith(doc, doc.indexOf("let x") >= 0 ? doc.indexOf("let x") : doc.length);
    expect(toggleCurrentFold(view)).toBe(true);
    expect(folded(view)).toEqual([line]);
    expect(toggleCurrentFold(view)).toBe(true);
    expect(folded(view)).toEqual([]);
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("leaves a standalone paragraph alone", () => {
    expect(toggleCurrentFold(viewWith("Just text"))).toBe(false);
  });

  it("opens and closes a read-only embed without changing the source marker", () => {
    const doc = "> [!toggle]- Title\n> Inner text";
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc, extensions: [EditorState.readOnly.of(true), toggles] }),
    });
    views.push(view);
    expect(view.contentDOM.textContent).not.toContain("Inner text");
    expect(toggleCurrentFold(view)).toBe(true);
    expect(view.contentDOM.textContent).toContain("Inner text");
    expect(toggleCurrentFold(view)).toBe(true);
    expect(view.contentDOM.textContent).not.toContain("Inner text");
    expect(view.state.doc.toString()).toBe(doc);
  });
});

describe("toggle all blocks in the note", () => {
  it("collapses nested headings, lists and code and then opens every level", () => {
    const doc =
      "# One\n- Parent\n  - Child\n    - Leaf\n\n## Inner\nText\n\n# Two\n```js\nlet x = 1\n```";
    const view = viewWith(doc, doc.indexOf("Leaf"));
    expect(togglePageFolds(view)).toBe(true);
    expect(folded(view).sort((a, b) => a - b)).toEqual([1, 2, 3, 6, 9, 10]);
    expect(view.state.selection.main.head).toBe(view.state.doc.line(1).to);
    expect(togglePageFolds(view)).toBe(true);
    expect(folded(view)).toEqual([]);
    expect(view.contentDOM.textContent).toContain("Leaf");
    expect(view.contentDOM.textContent).toContain("let x = 1");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("expands mixed saved toggles and view folds, then closes them in one undoable edit", () => {
    const doc =
      "> [!toggle]- Closed\n> Hidden\n\n> [!toggle|h2]+ Open\nBody\n\n> [!tip]+ Tip\n> Detail\n\n# Heading\n- Parent\n  - Child";
    const view = viewWith(doc);
    view.dispatch({ effects: StateEffect.appendConfig.of(history()) });
    flipListItem(view, view.state.doc.line(11).from);
    expect(togglePageFolds(view)).toBe(true);
    expect(folded(view)).toEqual([]);
    expect(view.state.doc.toString()).not.toContain("]-");
    const open = view.state.doc.toString();
    expect(togglePageFolds(view)).toBe(true);
    expect(view.state.doc.toString().match(/\]-/g)).toHaveLength(3);
    expect(folded(view)).toContain(10);
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(open);
  });

  it("maps all nested fold ranges after inserting missing toggle markers", () => {
    const doc =
      "> [!toggle] First\n> Body\n\n> [!toggle|h2] Second\n- Parent\n  - Child\n\n# Last\nText";
    const view = viewWith(doc, doc.indexOf("Child"));
    togglePageFolds(view);
    expect(view.state.doc.toString().match(/\]-/g)).toHaveLength(2);
    expect(folded(view)).toEqual([5, 8]);
    expect(view.contentDOM.textContent).not.toContain("Child");
    togglePageFolds(view);
    expect(view.state.doc.toString()).toBe(doc.replace(/\]/g, "]+"));
    expect(folded(view)).toEqual([]);
    expect(view.contentDOM.textContent).toContain("Child");
  });

  it("opens every read-only toggle locally and closes them again without rewriting text", () => {
    const doc = "> [!toggle]- First\n> One\n\n> [!tip]- Second\n> Two";
    const view = viewWith(doc);
    view.dispatch({ effects: StateEffect.appendConfig.of(EditorState.readOnly.of(true)) });
    togglePageFolds(view);
    expect(view.contentDOM.textContent).toContain("One");
    expect(view.contentDOM.textContent).toContain("Two");
    togglePageFolds(view);
    expect(view.contentDOM.textContent).not.toContain("One");
    expect(view.contentDOM.textContent).not.toContain("Two");
    expect(view.state.doc.toString()).toBe(doc);
  });

  it("includes headings and lists beyond the initial viewport", () => {
    const view = viewWith(
      "Start\n\n" + "Paragraph\n\n".repeat(1200) + "# Far away\n- Parent\n  - Child",
    );
    togglePageFolds(view);
    expect(folded(view)).toEqual([2403, 2404]);
    togglePageFolds(view);
    expect(folded(view)).toEqual([]);
  });

  it("leaves a standalone paragraph alone", () => {
    const view = viewWith("Just text");
    expect(togglePageFolds(view)).toBe(false);
    expect(view.state.doc.toString()).toBe("Just text");
  });
});

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
