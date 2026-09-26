import { describe, expect, it } from "vitest";
import { emptySheet } from "../../lib/formula/sheet";
import {
  clearRect,
  clipToBlock,
  copyRect,
  parseTsv,
  pasteBlock,
  rectName,
  rectOf,
  toTsv,
} from "./model";

describe("grid model", () => {
  it("normalizes selections into rectangles", () => {
    const rect = rectOf({ anchor: { c: 2, r: 5 }, focus: { c: 0, r: 1 } });
    expect(rect).toEqual({ c1: 0, r1: 1, c2: 2, r2: 5 });
    expect(rectName(rect)).toBe("A2:C6");
    expect(rectName({ c1: 1, r1: 0, c2: 1, r2: 0 })).toBe("B1");
  });

  it("round-trips TSV including quoted tabs, newlines and quotes", () => {
    const rows = [
      ["a", "b\tc", ""],
      ['say "hi"', "line1\nline2", "3"],
    ];
    expect(parseTsv(toTsv(rows))).toEqual(rows);
    expect(parseTsv("1\t2\r\n3\t4\r\n")).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(parseTsv('"half quoted" tail\tx')).toEqual([['"half quoted" tail', "x"]]);
    expect(parseTsv("")).toEqual([]);
  });

  it("pastes blocks, growing the sheet, and clears ranges", () => {
    const base = { ...emptySheet(), rows: 2, cols: 2, cells: { A1: "keep", B1: "gone" } };
    const pasted = pasteBlock(base, { c: 1, r: 0 }, [
      ["", "x"],
      ["y", "z"],
    ]);
    expect(pasted.cells).toEqual({ A1: "keep", C1: "x", B2: "y", C2: "z" });
    expect([pasted.cols, pasted.rows]).toEqual([3, 2]);
    expect(clearRect(pasted, { c1: 1, r1: 0, c2: 2, r2: 0 }).cells).toEqual({
      A1: "keep",
      B2: "y",
      C2: "z",
    });
  });

  it("shifts relative references when a copied block is pasted elsewhere", () => {
    const sheet = { ...emptySheet(), cells: { A1: "1", B1: "=A1*2", B2: "=$A$1" } };
    const clip = copyRect(sheet, { c1: 0, r1: 0, c2: 1, r2: 1 });
    expect(clipToBlock(clip, { c: 2, r: 3 })).toEqual([
      ["1", "=C4*2"],
      ["", "=$A$1"],
    ]);
  });
});
