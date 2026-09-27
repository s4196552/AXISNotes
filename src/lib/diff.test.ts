import { describe, expect, it } from "vitest";
import { applySegments, changeCount, diffWords } from "./diff";

describe("diffWords", () => {
  it("finds word changes and keeps the rest", () => {
    const segs = diffWords("The cat sat on teh mat.", "The cat sat on the mat.");
    expect(segs).toEqual([
      { kind: "same", text: "The cat sat on " },
      { kind: "change", id: 0, before: "teh", after: "the" },
      { kind: "same", text: " mat." },
    ]);
  });

  it("merges changes separated by a single space", () => {
    const segs = diffWords("I has went home.", "I have gone home.");
    expect(segs.filter((s) => s.kind === "change")).toEqual([
      { kind: "change", id: 0, before: "has went", after: "have gone" },
    ]);
  });

  it("round-trips: all accepted gives the new text, all rejected the old", () => {
    const before = "# Title\n\nFirst paragraf here.\n\n- item one\n- itme two\nLast line";
    const after =
      "# Title\n\nFirst paragraph here.\n\n- item one\n- item two\n- item three\nLast line.";
    const segs = diffWords(before, after);
    expect(applySegments(segs, new Set())).toBe(after);
    const all = new Set(segs.flatMap((s) => (s.kind === "change" ? [s.id] : [])));
    expect(applySegments(segs, all)).toBe(before);
    expect(changeCount(segs)).toBeGreaterThanOrEqual(3);
  });

  it("applies a subset of changes", () => {
    const segs = diffWords("teh cat and teh dog", "the cat and the dog");
    expect(changeCount(segs)).toBe(2);
    expect(applySegments(segs, new Set([1]))).toBe("the cat and teh dog");
  });

  it("handles identical and empty texts", () => {
    expect(diffWords("same", "same")).toEqual([{ kind: "same", text: "same" }]);
    expect(diffWords("", "new")).toEqual([{ kind: "change", id: 0, before: "", after: "new" }]);
  });
});
