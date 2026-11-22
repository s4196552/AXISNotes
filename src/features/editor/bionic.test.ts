import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { bionicDecorations, bionicPrefix, bionicRanges } from "./bionic";

/** The bold parts Bionic Reading draws, with the cursor on `cursorLine` (1-based). */
function bold(doc: string, cursorLine = 1): string[] {
  let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  // Parse the whole note first, as the editor has by the time it redraws (bionic.ts
  // rebuilds when the tree changes). A state only parses for a few milliseconds when it is
  // made, so on a busy machine code could still look like prose (T-270). The finished tree
  // reaches the next state, made by the selection update below.
  ensureSyntaxTree(state, state.doc.length, 5000);
  state = state.update({
    selection: EditorSelection.cursor(state.doc.line(cursorLine).from),
  }).state;
  const out: string[] = [];
  bionicDecorations(state, [{ from: 0, to: state.doc.length }]).between(
    0,
    state.doc.length,
    (from, to) => void out.push(state.sliceDoc(from, to)),
  );
  return out;
}

describe("Bionic Reading", () => {
  it("bolds about the first half of each word", () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(bionicPrefix)).toEqual([1, 1, 1, 2, 3, 3, 5]);
    const text = "Reading isn't hard, well-known café";
    expect(bionicRanges(text).map(([a, b]) => text.slice(a, b))).toEqual([
      "Read",
      "isn",
      "ha",
      "well-",
      "ca",
    ]);
    // Numbers and symbols aren't words.
    expect(bionicRanges("42 + 7 = ?")).toEqual([]);
  });

  it("decorates rendered lines only, never code, and leaves the text unchanged", () => {
    const doc = "Editing here\n\nPlain words and `inline code` here\n\n```\nfenced code\n```\n";
    const found = bold(doc, 1);
    // The line with the cursor stays plain; code inside backticks or fences isn't touched.
    expect(found).toEqual(["Pla", "wor", "a", "he"]);
    expect(bold(doc, 3)).toEqual(["Edit", "he"]);
  });
});
