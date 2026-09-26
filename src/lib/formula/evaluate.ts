import * as formulajs from "@formulajs/formulajs";
import { FormulaSyntaxError, type Node, parseFormula } from "./parser";

// Formula evaluation with Excel-style errors. Cell references and names are resolved by
// the caller (a sheet, or a note's properties); functions come from formula.js.

export type ErrorCode =
  "#DIV/0!" | "#VALUE!" | "#REF!" | "#NAME?" | "#N/A" | "#NUM!" | "#CIRC!" | "#ERROR!";

export class FormulaError {
  constructor(
    readonly code: ErrorCode,
    readonly detail = "",
  ) {}
  toString() {
    return this.code;
  }
}

export type Scalar = number | string | boolean | null | FormulaError;
export type Value = Scalar | Scalar[][];

export interface EvalContext {
  cell(col: number, row: number): Scalar;
  name(name: string): Value | undefined;
}

const isErr = (v: unknown): v is FormulaError => v instanceof FormulaError;

/** Normalize anything formula.js returns (numbers, strings, Error objects, arrays). */
function fromJs(v: unknown): Value {
  if (v instanceof Error) {
    const msg = v.message || String(v);
    const code = (["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#N/A", "#NUM!"] as const).find((c) =>
      msg.includes(c),
    );
    return new FormulaError(code ?? "#VALUE!", msg);
  }
  if (typeof v === "number") return Number.isFinite(v) ? v : new FormulaError("#NUM!");
  if (typeof v === "string" || typeof v === "boolean" || v === null) return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v))
    return (Array.isArray(v[0]) ? v : [v]).map((row) =>
      (row as unknown[]).map((x) => scalar(fromJs(x))),
    );
  if (v === undefined) return null;
  return String(v);
}

function scalar(v: Value): Scalar {
  if (Array.isArray(v)) return v[0]?.[0] ?? null;
  return v;
}

export function toNumber(v: Scalar): number | FormulaError {
  if (isErr(v)) return v;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === "") return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : new FormulaError("#VALUE!", `"${v}" is not a number`);
}

export function toText(v: Scalar): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (typeof v === "number") return formatNumber(v);
  return String(v);
}

/** Display numbers without float noise (0.1+0.2 → 0.3). */
export function formatNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

function compare(a: Scalar, b: Scalar): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const sa = toText(a).toLowerCase();
  const sb = toText(b).toLowerCase();
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function lookupFunction(name: string): ((...args: unknown[]) => unknown) | null {
  let obj: unknown = formulajs;
  for (const part of name.split(".")) {
    if (obj && (typeof obj === "object" || typeof obj === "function") && part in (obj as object)) {
      obj = (obj as Record<string, unknown>)[part];
    } else {
      return null;
    }
  }
  return typeof obj === "function" ? (obj as (...args: unknown[]) => unknown) : null;
}

function toJs(v: Value): unknown {
  if (Array.isArray(v)) return v.map((row) => row.map(toJs));
  if (isErr(v)) return new Error(v.code);
  return v;
}

export function evaluate(node: Node, ctx: EvalContext): Value {
  switch (node.type) {
    case "num":
    case "str":
    case "bool":
      return node.value;
    case "ref":
      return ctx.cell(node.col, node.row);
    case "range": {
      const [c1, c2] = [Math.min(node.from.col, node.to.col), Math.max(node.from.col, node.to.col)];
      const [r1, r2] = [Math.min(node.from.row, node.to.row), Math.max(node.from.row, node.to.row)];
      const out: Scalar[][] = [];
      for (let r = r1; r <= r2; r++) {
        const row: Scalar[] = [];
        for (let c = c1; c <= c2; c++) row.push(ctx.cell(c, r));
        out.push(row);
      }
      return out;
    }
    case "name": {
      const v = ctx.name(node.name);
      return v === undefined ? new FormulaError("#NAME?", `Unknown name ${node.name}`) : v;
    }
    case "unary": {
      const n = toNumber(scalar(evaluate(node.arg, ctx)));
      if (isErr(n)) return n;
      return node.op === "-" ? -n : node.op === "%" ? n / 100 : n;
    }
    case "binary": {
      const a = scalar(evaluate(node.left, ctx));
      const b = scalar(evaluate(node.right, ctx));
      if (isErr(a)) return a;
      if (isErr(b)) return b;
      switch (node.op) {
        case "&":
          return toText(a) + toText(b);
        case "=":
          return compare(a, b) === 0;
        case "<>":
          return compare(a, b) !== 0;
        case "<":
          return compare(a, b) < 0;
        case ">":
          return compare(a, b) > 0;
        case "<=":
          return compare(a, b) <= 0;
        case ">=":
          return compare(a, b) >= 0;
      }
      const x = toNumber(a);
      const y = toNumber(b);
      if (isErr(x)) return x;
      if (isErr(y)) return y;
      switch (node.op) {
        case "+":
          return x + y;
        case "-":
          return x - y;
        case "*":
          return x * y;
        case "/":
          return y === 0 ? new FormulaError("#DIV/0!") : x / y;
        case "^": {
          const r = Math.pow(x, y);
          return Number.isFinite(r) ? r : new FormulaError("#NUM!");
        }
      }
      return new FormulaError("#VALUE!");
    }
    case "call": {
      // IF evaluates lazily so the unused branch can't raise errors.
      if (node.name === "IF") {
        const cond = scalar(evaluate(node.args[0] ?? { type: "bool", value: false }, ctx));
        if (isErr(cond)) return cond;
        const truthy = typeof cond === "string" ? cond !== "" : Boolean(cond);
        const branch = truthy ? node.args[1] : node.args[2];
        return branch ? evaluate(branch, ctx) : truthy;
      }
      const errorAware = errorFunction(node.name, node.args, ctx);
      if (errorAware !== undefined) return errorAware;
      const fn = lookupFunction(node.name);
      if (!fn) return new FormulaError("#NAME?", `Unknown function ${node.name}`);
      const args = node.args.map((a) => evaluate(a, ctx));
      // Functions propagate errors from their arguments.
      const err = args.find((a) => isErr(a));
      if (err) return err;
      try {
        return fromJs(fn(...args.map(toJs)));
      } catch (e) {
        return new FormulaError("#VALUE!", String(e));
      }
    }
  }
}

/**
 * IFERROR / IFNA / ISERROR / ISERR / ISNA work on our error values directly (formula.js
 * recognizes only its own error objects). Returns undefined for other functions.
 */
function errorFunction(name: string, args: Node[], ctx: EvalContext): Value | undefined {
  const first = () => (args[0] ? scalar(evaluate(args[0], ctx)) : null);
  switch (name) {
    case "IFERROR": {
      const v = args[0] ? evaluate(args[0], ctx) : null;
      return isErr(scalar(v)) ? (args[1] ? evaluate(args[1], ctx) : "") : v;
    }
    case "IFNA": {
      const v = args[0] ? evaluate(args[0], ctx) : null;
      const s = scalar(v);
      return isErr(s) && s.code === "#N/A" ? (args[1] ? evaluate(args[1], ctx) : "") : v;
    }
    case "ISERROR":
      return isErr(first());
    case "ISERR": {
      const v = first();
      return isErr(v) && v.code !== "#N/A";
    }
    case "ISNA": {
      const v = first();
      return isErr(v) && v.code === "#N/A";
    }
    default:
      return undefined;
  }
}

/** Parse and evaluate `=...` source (without the leading `=`). */
export function evaluateSource(src: string, ctx: EvalContext): Value {
  try {
    return evaluate(parseFormula(src), ctx);
  } catch (e) {
    if (e instanceof FormulaSyntaxError) return new FormulaError("#ERROR!", e.message);
    throw e;
  }
}

export { isErr, scalar };
