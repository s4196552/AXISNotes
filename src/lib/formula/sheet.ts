import { evaluateSource, FormulaError, isErr, scalar, type Scalar, toText } from "./evaluate";
import { colName, parseFormula, refName } from "./parser";

// The `.axgrid` file format and whole-sheet recalculation.

export interface CellFormat {
  bold?: boolean;
  align?: "left" | "center" | "right";
}

export interface SheetData {
  version: 1;
  rows: number;
  cols: number;
  /** Raw input by A1 address: text, a number, or a formula starting with "=". */
  cells: Record<string, string>;
  /** Column widths in px by column letter. */
  widths: Record<string, number>;
  formats: Record<string, CellFormat>;
}

export const DEFAULT_ROWS = 100;
export const DEFAULT_COLS = 26;

export function emptySheet(): SheetData {
  return { version: 1, rows: DEFAULT_ROWS, cols: DEFAULT_COLS, cells: {}, widths: {}, formats: {} };
}

/** Parse `.axgrid` JSON leniently; unknown keys are dropped, bad values defaulted. */
export function parseSheet(text: string): SheetData {
  const sheet = emptySheet();
  if (!text.trim()) return sheet;
  const raw = JSON.parse(text) as Partial<SheetData>;
  if (typeof raw.rows === "number" && raw.rows > 0) sheet.rows = Math.floor(raw.rows);
  if (typeof raw.cols === "number" && raw.cols > 0) sheet.cols = Math.floor(raw.cols);
  for (const [k, v] of Object.entries(raw.cells ?? {})) {
    if (typeof v === "string" || typeof v === "number") sheet.cells[k.toUpperCase()] = String(v);
  }
  for (const [k, v] of Object.entries(raw.widths ?? {}))
    if (typeof v === "number") sheet.widths[k] = v;
  for (const [k, v] of Object.entries(raw.formats ?? {}))
    if (v && typeof v === "object") sheet.formats[k] = v;
  return sheet;
}

/** Stable, diff-friendly JSON (cells sorted row-major). */
export function serializeSheet(sheet: SheetData): string {
  const order = (a: string, b: string) => {
    const pa = /^([A-Z]+)(\d+)$/.exec(a);
    const pb = /^([A-Z]+)(\d+)$/.exec(b);
    if (!pa || !pb) return a < b ? -1 : 1;
    return (
      Number(pa[2]) - Number(pb[2]) || pa[1]!.length - pb[1]!.length || (pa[1]! < pb[1]! ? -1 : 1)
    );
  };
  const sorted = <T>(o: Record<string, T>) =>
    Object.fromEntries(
      Object.keys(o)
        .sort(order)
        .map((k) => [k, o[k]!]),
    );
  return (
    JSON.stringify(
      {
        version: 1,
        rows: sheet.rows,
        cols: sheet.cols,
        cells: sorted(Object.fromEntries(Object.entries(sheet.cells).filter(([, v]) => v !== ""))),
        widths: sheet.widths,
        formats: sorted(sheet.formats),
      },
      null,
      2,
    ) + "\n"
  );
}

/** Literal input → value: numbers become numbers, TRUE/FALSE booleans, else text. */
export function literal(raw: string): Scalar {
  const t = raw.trim();
  if (t === "") return null;
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) return Number(t);
  if (/^[+-]?\d+(\.\d+)?%$/.test(t)) return Number(t.slice(0, -1)) / 100;
  const up = t.toUpperCase();
  if (up === "TRUE" || up === "FALSE") return up === "TRUE";
  return raw;
}

/** Evaluate every non-empty cell. Cycles yield #CIRC! for the cells on the cycle. */
export function computeSheet(sheet: SheetData): Map<string, Scalar> {
  const results = new Map<string, Scalar>();
  const visiting = new Set<string>();
  const valueOf = (addr: string): Scalar => {
    const done = results.get(addr);
    if (done !== undefined || results.has(addr)) return done ?? null;
    const raw = sheet.cells[addr];
    if (raw === undefined || raw === "") return null;
    if (!raw.startsWith("=")) {
      const v = literal(raw);
      results.set(addr, v);
      return v;
    }
    if (visiting.has(addr)) return new FormulaError("#CIRC!", `Circular reference at ${addr}`);
    visiting.add(addr);
    const v = scalar(
      evaluateSource(raw.slice(1), {
        cell: (c, r) => (c < 0 || r < 0 ? new FormulaError("#REF!") : valueOf(refName(c, r))),
        name: () => undefined,
      }),
    );
    visiting.delete(addr);
    results.set(addr, v);
    return v;
  };
  for (const addr of Object.keys(sheet.cells)) valueOf(addr);
  return results;
}

/** Text shown in a cell for a computed value. */
export function displayValue(v: Scalar | undefined): string {
  if (v === undefined || v === null) return "";
  if (isErr(v)) return v.code;
  return toText(v);
}

/** Text of all cells, for search indexing and previews. */
export function sheetText(sheet: SheetData): string {
  return Object.values(sheet.cells)
    .filter((v) => v && !v.startsWith("="))
    .join("\n");
}

// ---- Structural edits (formulas are shifted like Excel) ----

// A1-style refs (any case), not part of a longer name or a function call like LOG10(.
const REF_IN_FORMULA = /(?<![\w.$])(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(.])/g;

function shiftFormula(raw: string, axis: "row" | "col", at: number, delta: number): string {
  if (!raw.startsWith("=")) return raw;
  // Don't touch refs inside string literals.
  return raw.replace(/"(?:[^"]|"")*"|[^"]+/g, (chunk) =>
    chunk.startsWith('"')
      ? chunk
      : chunk.replace(REF_IN_FORMULA, (_m, d1: string, col: string, d2: string, row: string) => {
          let c = colIndexOf(col);
          let r = Number(row) - 1;
          const idx = axis === "row" ? r : c;
          // Deleting: references into the deleted span become #REF!.
          if (delta < 0 && idx >= at && idx < at - delta) return "#REF!";
          if (idx >= at) {
            if (axis === "row") r += delta;
            else c += delta;
          }
          return `${d1}${colName(c)}${d2}${r + 1}`;
        }),
  );
}

function colIndexOf(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Insert (count > 0) or delete (count < 0) rows/columns at index `at`. */
export function shiftSheet(
  sheet: SheetData,
  axis: "row" | "col",
  at: number,
  count: number,
): SheetData {
  const cells: Record<string, string> = {};
  const formats: Record<string, CellFormat> = {};
  const move = (addr: string): string | null => {
    const m = /^([A-Z]+)(\d+)$/.exec(addr);
    if (!m) return addr;
    let c = colIndexOf(m[1]!);
    let r = Number(m[2]) - 1;
    const idx = axis === "row" ? r : c;
    if (count < 0 && idx >= at && idx < at - count) return null; // deleted
    if (idx >= at) {
      if (axis === "row") r += count;
      else c += count;
    }
    return refName(c, r);
  };
  for (const [addr, raw] of Object.entries(sheet.cells)) {
    const to = move(addr);
    if (to) cells[to] = shiftFormula(raw, axis, at, count);
  }
  for (const [addr, f] of Object.entries(sheet.formats)) {
    const to = move(addr);
    if (to) formats[to] = f;
  }
  return {
    ...sheet,
    rows: axis === "row" ? Math.max(1, sheet.rows + count) : sheet.rows,
    cols: axis === "col" ? Math.max(1, sheet.cols + count) : sheet.cols,
    cells,
    formats,
  };
}

/**
 * Adjust a formula copied `dc` columns and `dr` rows away (relative refs move, `$`
 * parts stay). References pushed off the sheet become #REF!.
 */
export function offsetFormula(raw: string, dc: number, dr: number): string {
  if (!raw.startsWith("=") || (dc === 0 && dr === 0)) return raw;
  return raw.replace(/"(?:[^"]|"")*"|[^"]+/g, (chunk) =>
    chunk.startsWith('"')
      ? chunk
      : chunk.replace(REF_IN_FORMULA, (_m, d1: string, col: string, d2: string, row: string) => {
          const c = colIndexOf(col) + (d1 ? 0 : dc);
          const r = Number(row) - 1 + (d2 ? 0 : dr);
          if (c < 0 || r < 0) return "#REF!";
          return `${d1}${colName(c)}${d2}${r + 1}`;
        }),
  );
}

/** True if `raw` is a formula that parses. */
export function isValidFormula(raw: string): boolean {
  if (!raw.startsWith("=")) return true;
  try {
    parseFormula(raw.slice(1));
    return true;
  } catch {
    return false;
  }
}
