import { evaluateSource, FormulaError, type Scalar, scalar, type Value } from "./formula/evaluate";
import type { Props } from "./markdown";

// Computed properties: a frontmatter value written as a formula (`total: =price * qty`)
// is evaluated with the same engine as grids. Other properties are referenced by name;
// lists become ranges, so `=SUM(scores)` works. Formulas may use other formulas.

export function isFormula(value: unknown): value is string {
  return typeof value === "string" && /^\s*=\s*\S/.test(value);
}

function toValue(v: unknown): Value {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) {
    const row = v.map((x): Scalar =>
      typeof x === "object" && x !== null ? String(x) : (x as Scalar),
    );
    return [row];
  }
  return new FormulaError("#VALUE!", "Objects can't be used in formulas");
}

/** Evaluate every formula property. Cycles yield #CIRC!. */
export function computeProps(props: Props): Record<string, Scalar> {
  const keys = Object.keys(props);
  const byLower = new Map(keys.map((k) => [k.toLowerCase(), k]));
  const results: Record<string, Scalar> = {};
  const visiting = new Set<string>();

  const valueOf = (key: string): Value => {
    const raw = props[key];
    if (!isFormula(raw)) return toValue(raw);
    if (key in results) return results[key]!;
    if (visiting.has(key)) return new FormulaError("#CIRC!", `Circular reference at ${key}`);
    visiting.add(key);
    const v = scalar(
      evaluateSource(raw.trim().slice(1), {
        cell: () => new FormulaError("#REF!", "Cell references only work in grids"),
        name: (name) => {
          const k = name in props ? name : byLower.get(name.toLowerCase());
          return k === undefined ? undefined : valueOf(k);
        },
      }),
    );
    visiting.delete(key);
    results[key] = v;
    return v;
  };

  for (const k of keys) if (isFormula(props[k])) valueOf(k);
  return results;
}
