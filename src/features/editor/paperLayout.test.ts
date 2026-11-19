import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { cornellLayout, cornellZones, docPageStyle, rowPad } from "./paperLayout";

const state = (doc: string) => EditorState.create({ doc, extensions: [cornellZones] });

describe("docPageStyle", () => {
  it("reads axis-style from the frontmatter", () => {
    expect(docPageStyle(state("---\naxis-style: cornell\n---\n# Hi\n"))).toBe("cornell");
    expect(docPageStyle(state("---\ntags: [a]\n---\nText"))).toBe("plain");
    expect(docPageStyle(state("axis-style: lined\n"))).toBe("plain");
  });
});

describe("rowPad", () => {
  it("pads a bottom edge up to the next row", () => {
    expect(rowPad(40, 26)).toBe(12);
    expect(rowPad(52, 26)).toBe(0);
    expect(rowPad(52.3, 26)).toBe(0);
    expect(rowPad(51.8, 26)).toBe(0);
    expect(rowPad(27, 26)).toBe(25);
  });
});

describe("cornellLayout", () => {
  const doc = [
    "---", //  1
    "axis-style: cornell", //  2
    "---", //  3
    "# Title", //  4
    "Intro", //  5
    "## Cues", //  6
    "- Why?", //  7
    "## Notes", //  8
    "Answer", //  9
    "### Side head", // 10
    "```", // 11
    "## not a heading", // 12
    "```", // 13
    "## Summary", // 14
    "### Inside summary", // 15
    "Wrap up", // 16
  ].join("\n");

  it("assigns cue, notes and summary zones by section", () => {
    const { zones, summaryFrom } = cornellLayout(state(doc));
    expect(zones).toEqual([
      null,
      null,
      null,
      "cue", // a heading among the notes sits in the cue column
      "notes",
      "cue",
      "cue",
      "notes",
      "notes",
      "cue",
      "notes",
      "notes", // inside fenced code: text, not a section
      "notes",
      "summary",
      "summary",
      "summary",
    ]);
    expect(summaryFrom).toBe(state(doc).doc.line(14).from);
  });

  it("puts writing in the notes column when there are no sections", () => {
    const { zones, summaryFrom } = cornellLayout(state("---\naxis-style: cornell\n---\nA\nB"));
    expect(zones).toEqual([null, null, null, "notes", "notes"]);
    expect(summaryFrom).toBe(-1);
  });

  it("decorates lines only on Cornell pages", () => {
    const count = (s: EditorState) => s.field(cornellZones).decorations.size;
    expect(count(state(doc))).toBe(13);
    expect(count(state(doc.replace("cornell", "lined")))).toBe(0);
    const switched = state(doc.replace("cornell", "lined")).update({
      changes: { from: 4, to: 4 + "axis-style: lined".length, insert: "axis-style: cornell" },
    }).state;
    expect(count(switched)).toBe(13);
  });
});
