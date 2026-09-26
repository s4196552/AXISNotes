import { foldable } from "@codemirror/language";
import { EditorSelection, EditorState, type TransactionSpec } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  indentListItem,
  listItemAt,
  moveBlock,
  moveBlockTo,
  outlineFolding,
  sectionAt,
} from "./outliner";

/** State with the cursor at the `|` marker. */
function at(doc: string): EditorState {
  const pos = doc.indexOf("|");
  const text = doc.replace("|", "");
  return EditorState.create({
    doc: text,
    selection: EditorSelection.cursor(pos),
    extensions: [outlineFolding],
  });
}

function apply(state: EditorState, spec: TransactionSpec | null): string {
  if (!spec) return "(no change)";
  const next = state.update(spec).state;
  const head = next.selection.main.head;
  const text = next.doc.toString();
  return text.slice(0, head) + "|" + text.slice(head);
}

describe("list structure", () => {
  it("finds items with their nested children and blank-separated content", () => {
    const s = EditorState.create({ doc: "- a\n  - b\n    - c\n\n  more\n- d\ntext" });
    expect(listItemAt(s, 1)).toMatchObject({ first: 1, last: 5, indent: 0, contentCol: 2 });
    expect(listItemAt(s, 2)).toMatchObject({ first: 2, last: 3, indent: 2, contentCol: 4 });
    expect(listItemAt(s, 6)).toMatchObject({ first: 6, last: 6 });
    expect(listItemAt(s, 7)).toBeNull();
    const o = EditorState.create({ doc: "1. one\n   nested text\n2. two" });
    expect(listItemAt(o, 1)).toMatchObject({ last: 2, contentCol: 3 });
  });

  it("finds heading sections up to the next heading of the same or higher level", () => {
    const s = EditorState.create({ doc: "# A\ntext\n## B\nb\n```\n# not heading\n```\n\n# C\nc" });
    expect(sectionAt(s, 1)).toMatchObject({ first: 1, last: 7, level: 1 });
    expect(sectionAt(s, 3)).toMatchObject({ first: 3, last: 7, level: 2 });
    expect(sectionAt(s, 9)).toMatchObject({ first: 9, last: 10 });
  });
});

describe("indent / outdent", () => {
  it("indents under the previous sibling, taking children along", () => {
    const s = at("- a\n- b|\n  - child\n- c");
    expect(apply(s, indentListItem(s, 1))).toBe("- a\n  - b|\n    - child\n- c");
  });

  it("aligns under ordered-list content and refuses the first item", () => {
    const s = at("1. one\n2. two|");
    expect(apply(s, indentListItem(s, 1))).toBe("1. one\n   2. two|");
    const first = at("- a|\n- b");
    expect(indentListItem(first, 1)).toBeNull();
  });

  it("outdents to the parent's level, and not past the margin", () => {
    const s = at("- a\n  - b|\n    - c");
    expect(apply(s, indentListItem(s, -1))).toBe("- a\n- b|\n  - c");
    expect(indentListItem(at("- a|"), -1)).toBeNull();
    expect(indentListItem(at("plain| text"), 1)).toBeNull();
  });
});

describe("move up / down", () => {
  it("swaps list items with siblings, keeping children and the cursor", () => {
    const s = at("- a\n  - a1\n- b|\n  - b1\n- c");
    expect(apply(s, moveBlock(s, -1))).toBe("- b|\n  - b1\n- a\n  - a1\n- c");
    expect(apply(s, moveBlock(s, 1))).toBe("- a\n  - a1\n- c\n- b|\n  - b1");
    // No sibling above the first child.
    expect(moveBlock(at("- a\n  - x|\n- b"), -1)).toBeNull();
  });

  it("swaps heading sections of the same level", () => {
    const s = at("# A\na\n\n# B|\nb\n");
    expect(apply(s, moveBlock(s, -1))).toBe("# B|\nb\n\n# A\na\n");
    const nested = at("# A\n## x|\n## y\n# B");
    expect(apply(nested, moveBlock(nested, 1))).toBe("# A\n## y\n## x|\n# B");
  });
});

describe("drag and drop", () => {
  it("moves a block before or after a target, re-indenting to its level", () => {
    const s = EditorState.create({ doc: "- a\n- b\n  - b1\n  - b2\n- c" });
    const drop = (from: number, to: number, after: boolean) => {
      const spec = moveBlockTo(s, from, to, after);
      return spec ? s.update(spec).state.doc.toString() : "(no change)";
    };
    expect(drop(5, 1, false)).toBe("- c\n- a\n- b\n  - b1\n  - b2");
    expect(drop(1, 5, true)).toBe("- b\n  - b1\n  - b2\n- c\n- a");
    expect(drop(4, 1, false)).toBe("- b2\n- a\n- b\n  - b1\n- c"); // outdented to target level
    expect(drop(2, 3, false)).toBe("(no change)"); // into itself
  });
});

describe("folding", () => {
  it("folds items with children and sections, not single lines", () => {
    const s = EditorState.create({ doc: "# H\n- a\n  - b\n- c", extensions: [outlineFolding] });
    expect(foldable(s, s.doc.line(1).from, s.doc.line(1).to)).toEqual({
      from: 3,
      to: s.doc.length,
    });
    expect(foldable(s, s.doc.line(2).from, s.doc.line(2).to)).toEqual({
      from: s.doc.line(2).to,
      to: s.doc.line(3).to,
    });
    expect(foldable(s, s.doc.line(4).from, s.doc.line(4).to)).toBeNull();
  });
});
