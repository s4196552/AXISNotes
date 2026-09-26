import { describe, expect, it } from "vitest";
import { evaluateSource, FormulaError, type Scalar, type Value } from "./evaluate";
import { colIndex, colName, parseFormula } from "./parser";
import {
  computeSheet,
  offsetFormula,
  displayValue,
  emptySheet,
  literal,
  parseSheet,
  serializeSheet,
  shiftSheet,
} from "./sheet";

const noRefs = { cell: (): Scalar => null, name: () => undefined };
const ev = (src: string, names: Record<string, Value> = {}) =>
  evaluateSource(src, { cell: () => null, name: (n) => names[n] });
const err = (v: Value) => (v instanceof FormulaError ? v.code : v);

describe("parser", () => {
  it("converts column names", () => {
    expect([colIndex("A"), colIndex("Z"), colIndex("AA"), colIndex("AZ")]).toEqual([0, 25, 26, 51]);
    expect([colName(0), colName(25), colName(26), colName(701), colName(702)]).toEqual([
      "A",
      "Z",
      "AA",
      "ZZ",
      "AAA",
    ]);
  });

  it("parses refs, ranges, names, calls and precedence", () => {
    expect(parseFormula("$A$1")).toEqual({ type: "ref", col: 0, row: 0 });
    expect(parseFormula("A1:B2")).toMatchObject({ type: "range", to: { col: 1, row: 1 } });
    expect(parseFormula("price")).toEqual({ type: "name", name: "price" });
    expect(parseFormula("beta.dist(1,2,3,TRUE)")).toMatchObject({
      type: "call",
      name: "BETA.DIST",
    });
    expect(() => parseFormula("1 +")).toThrow();
    expect(() => parseFormula('"open')).toThrow();
  });
});

describe("evaluation", () => {
  it("follows Excel precedence and operators", () => {
    expect(ev("1+2*3")).toBe(7);
    expect(ev("(1+2)*3")).toBe(9);
    expect(ev("2^3^2")).toBe(512); // right-associative
    expect(ev("-2^2")).toBe(4); // unary binds tighter than ^, like Excel
    expect(ev("50%")).toBe(0.5);
    expect(ev('"a"&1&TRUE')).toBe("a1TRUE");
    expect(ev("1+1=2")).toBe(true);
    expect(ev('"B">"a"')).toBe(true);
    expect(ev("0.1+0.2")).toBeCloseTo(0.3);
  });

  it("returns Excel errors", () => {
    expect(err(ev("1/0"))).toBe("#DIV/0!");
    expect(err(ev('"x"*2'))).toBe("#VALUE!");
    expect(err(ev("NOPE(1)"))).toBe("#NAME?");
    expect(err(ev("missing+1"))).toBe("#NAME?");
    expect(err(ev("1+"))).toBe("#ERROR!");
    expect(err(ev("SQRT(-1)"))).toBe("#NUM!");
  });

  it("calls formula.js functions with ranges and names", () => {
    expect(ev("SUM(1,2,3)")).toBe(6);
    expect(ev('IF(1>2,1/0,"ok")')).toBe("ok"); // lazy IF
    expect(ev("IFERROR(1/0, 7)")).toBe(7);
    expect(ev("ROUND(price*qty, 1)", { price: 2.25, qty: 3 })).toBe(6.8);
    expect(ev('CONCATENATE("a","b")')).toBe("ab");
    expect(ev("UPPER(name)", { name: "ada" })).toBe("ADA");
    expect(ev("AVERAGE(list)", { list: [[1, 2, 3]] })).toBe(2);
    expect(evaluateSource("MAX(A1:B1)", { ...noRefs, cell: (c) => (c === 0 ? 3 : 9) })).toBe(9);
  });
});

describe("sheet", () => {
  const sheet = (cells: Record<string, string>) => ({ ...emptySheet(), cells });

  it("computes dependent formulas and detects cycles", () => {
    const values = computeSheet(
      sheet({
        A1: "2",
        A2: "3",
        A3: "=A1*A2",
        B1: "=SUM(A1:A3)",
        C1: "=C2",
        C2: "=C1",
        D1: "hi",
        D2: '=D1&"!"',
      }),
    );
    expect(values.get("A3")).toBe(6);
    expect(values.get("B1")).toBe(11);
    expect(displayValue(values.get("C1"))).toBe("#CIRC!");
    expect(values.get("D2")).toBe("hi!");
  });

  it("reads literals like a spreadsheet", () => {
    expect([
      literal("42"),
      literal("-1.5e2"),
      literal("25%"),
      literal("true"),
      literal("x 1"),
      literal(""),
    ]).toEqual([42, -150, 0.25, true, "x 1", null]);
  });

  it("round-trips the file format in a stable order", () => {
    const s = parseSheet(
      '{"rows":5,"cols":3,"cells":{"b2":"x","A10":"1","A2":"=A10","C1":""},"widths":{"A":90}}',
    );
    expect(s.rows).toBe(5);
    const json = serializeSheet(s);
    expect(Object.keys(JSON.parse(json).cells)).toEqual(["A2", "B2", "A10"]);
    expect(parseSheet(json)).toEqual({ ...s, cells: { A2: "=A10", B2: "x", A10: "1" } });
    expect(parseSheet("")).toEqual(emptySheet());
  });

  it("shifts cells and formula references when inserting or deleting", () => {
    const s = sheet({ A1: "1", A2: "2", A3: "=SUM(A1:A2)", B3: '="A2"&A2' });
    const inserted = shiftSheet(s, "row", 1, 1); // new row 2
    expect(inserted.cells).toEqual({ A1: "1", A3: "2", A4: "=SUM(A1:A3)", B4: '="A2"&A3' });
    const deleted = shiftSheet(s, "row", 0, -1); // delete row 1
    expect(deleted.cells).toEqual({ A1: "2", A2: "=SUM(#REF!:A1)", B2: '="A2"&A1' });
    const col = shiftSheet(sheet({ A1: "1", B1: "=A1*2" }), "col", 0, 1);
    expect(col.cells).toEqual({ B1: "1", C1: "=B1*2" });
  });

  it("offsets relative references when formulas are copied", () => {
    expect(offsetFormula("=A1+$B$2+C$3+$D4", 1, 2)).toBe("=B3+$B$2+D$3+$D6");
    expect(offsetFormula('=LOG10(a1)&"A1"', 0, 1)).toBe('=LOG10(A2)&"A1"');
    expect(offsetFormula("=A1", -1, 0)).toBe("=#REF!");
    expect(offsetFormula("plain A1", 3, 3)).toBe("plain A1");
  });
});
