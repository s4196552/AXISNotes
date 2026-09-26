import { describe, expect, it } from "vitest";
import { computeProps, isFormula } from "./computed";
import { displayValue } from "./formula/sheet";

const shown = (props: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(computeProps(props)).map(([k, v]) => [k, displayValue(v)]));

describe("computed properties", () => {
  it("recognizes formulas", () => {
    expect([
      isFormula("=a"),
      isFormula(" = 1"),
      isFormula("="),
      isFormula("a=b"),
      isFormula(3),
    ]).toEqual([true, true, false, false, false]);
  });

  it("evaluates formulas over other properties, including other formulas", () => {
    expect(
      shown({
        price: 2.5,
        Qty: 4,
        total: "=price * qty",
        withTax: "=ROUND(total * 1.2, 2)",
        label: '=title & ": " & total',
        title: "Pens",
        scores: [1, 2, 3],
        sum: "=SUM(scores)",
        done: true,
        flag: '=IF(done, "yes", "no")',
      }),
    ).toEqual({
      total: "10",
      withTax: "12",
      label: "Pens: 10",
      sum: "6",
      flag: "yes",
    });
  });

  it("reports errors instead of throwing", () => {
    expect(
      shown({
        a: "=b + 1",
        b: "=a + 1",
        missing: "=nope * 2",
        cell: "=A1",
        bad: "=1 +",
        obj: { x: 1 },
        useObj: "=obj",
      }),
    ).toEqual({
      a: "#CIRC!",
      b: "#CIRC!",
      missing: "#NAME?",
      cell: "#REF!",
      bad: "#ERROR!",
      useObj: "#VALUE!",
    });
  });
});
