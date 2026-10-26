import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { headingSections } from "./headingSections";

describe("heading hierarchy", () => {
  it("includes all intervening content and smaller headings, stopping at a peer or parent", () => {
    const doc =
      "# Parent\nintro\n### Skipped level\nchild\n###### Deep\nleaf\n## Peer\npeer body\n# Next\nend";
    const state = EditorState.create({ doc });
    expect(headingSections(state).map((h) => [h.level, h.first, h.last])).toEqual([
      [1, 1, 8],
      [3, 3, 6],
      [6, 5, 6],
      [2, 7, 8],
      [1, 9, 10],
    ]);
    expect(
      state.sliceDoc(headingSections(state)[0]!.to + 1, headingSections(state)[0]!.bodyTo),
    ).toContain("## Peer\npeer body");
  });

  it("uses one hierarchy for ordinary headings and built-in toggle headings", () => {
    const state = EditorState.create({
      doc:
        "> [!toggle|h1]+ Parent\n> quoted\nnormal paragraph\n## Child\nbody\n" +
        "> [!toggle|h3]- Grandchild\n> inside\nafter child\n## Sibling\ntext\n# Next",
    });
    expect(headingSections(state).map((h) => [h.kind, h.level, h.first, h.last])).toEqual([
      ["toggle", 1, 1, 10],
      ["markdown", 2, 4, 8],
      ["toggle", 3, 6, 8],
      ["markdown", 2, 9, 10],
      ["markdown", 1, 11, 11],
    ]);
  });

  it("ignores YAML, comments, code, mismatched fences and quoted code headings", () => {
    const state = EditorState.create({
      doc: [
        "---",
        "# YAML",
        "---",
        "# Real",
        "````js",
        "# code",
        "```",
        "> [!toggle|h1]- code",
        "````",
        "<!--",
        "# comment",
        "-->",
        "> ~~~",
        "> [!toggle|h1]- quoted code",
        "> ~~~",
        "## Actual",
        "body",
      ].join("\n"),
    });
    expect(headingSections(state).map((h) => h.title)).toEqual(["Real", "Actual"]);
    expect(headingSections(state)[0]!.last).toBe(17);
  });

  it("supports Setext headings, indented ATX headings, empty headings and all six levels", () => {
    const state = EditorState.create({
      doc: "Setext title\n===\nintro\n\nSubheading\n---\nbody\n   ### Three ###\na\n#### Four\nb\n##### Five\nc\n###### Six\nd\n#\n",
    });
    expect(headingSections(state).map((h) => [h.title, h.level])).toEqual([
      ["Setext title", 1],
      ["Subheading", 2],
      ["Three", 3],
      ["Four", 4],
      ["Five", 5],
      ["Six", 6],
      ["", 1],
    ]);
  });
});
