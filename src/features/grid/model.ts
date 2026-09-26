import { refName } from "../../lib/formula/parser";
import { offsetFormula, type SheetData } from "../../lib/formula/sheet";

// Pure helpers for the grid view: selections, TSV clipboard, block paste.

export interface Pos {
  c: number;
  r: number;
}

export interface Selection {
  anchor: Pos;
  focus: Pos;
}

export interface Rect {
  c1: number;
  r1: number;
  c2: number;
  r2: number;
}

export function rectOf(sel: Selection): Rect {
  return {
    c1: Math.min(sel.anchor.c, sel.focus.c),
    r1: Math.min(sel.anchor.r, sel.focus.r),
    c2: Math.max(sel.anchor.c, sel.focus.c),
    r2: Math.max(sel.anchor.r, sel.focus.r),
  };
}

export const inRect = (rect: Rect, c: number, r: number) =>
  c >= rect.c1 && c <= rect.c2 && r >= rect.r1 && r <= rect.r2;

export function rectName(rect: Rect): string {
  const a = refName(rect.c1, rect.r1);
  return rect.c1 === rect.c2 && rect.r1 === rect.r2 ? a : `${a}:${refName(rect.c2, rect.r2)}`;
}

export function clampPos(p: Pos, sheet: Pick<SheetData, "rows" | "cols">): Pos {
  return {
    c: Math.max(0, Math.min(sheet.cols - 1, p.c)),
    r: Math.max(0, Math.min(sheet.rows - 1, p.r)),
  };
}

// ---- TSV (Excel / Google Sheets clipboard format) ----

const quote = (s: string) => (/[\t\n\r"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toTsv(rows: string[][]): string {
  return rows.map((r) => r.map(quote).join("\t")).join("\n");
}

const TAB = "\t";
const NL = "\n";

/** Parse TSV, honoring quoted fields that contain tabs, newlines or `""`. */
export function parseTsv(text: string): string[][] {
  const src = text.replace(/\r\n?/g, NL).replace(/\n$/, "");
  if (src === "") return [];
  const rows: string[][] = [[]];
  const nextDelim = (from: number) => {
    const m = /[\t\n]/.exec(src.slice(from));
    return m ? from + m.index : src.length;
  };
  let i = 0;
  while (i <= src.length) {
    let field: string | null = null;
    if (src[i] === '"') {
      let j = i + 1;
      let value = "";
      let closed = false;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            value += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        value += src[j++];
      }
      // A real quoted field ends right after its closing quote.
      if (closed && (j >= src.length || src[j] === TAB || src[j] === NL)) {
        field = value;
        i = j;
      }
    }
    if (field === null) {
      const end = nextDelim(i);
      field = src.slice(i, end);
      i = end;
    }
    rows[rows.length - 1]!.push(field);
    if (src[i] === NL) rows.push([]);
    i++;
  }
  return rows;
}

/** Raw cells in `rect`, relative to its top-left, for copying inside AXIS. */
export interface Clip {
  width: number;
  height: number;
  cells: Record<string, string>;
  origin: Pos;
}

export const CLIP_MIME = "application/x-axis-grid";

export function copyRect(sheet: SheetData, rect: Rect): Clip {
  const cells: Record<string, string> = {};
  for (let r = rect.r1; r <= rect.r2; r++)
    for (let c = rect.c1; c <= rect.c2; c++) {
      const raw = sheet.cells[refName(c, r)];
      if (raw) cells[`${c - rect.c1},${r - rect.r1}`] = raw;
    }
  return {
    width: rect.c2 - rect.c1 + 1,
    height: rect.r2 - rect.r1 + 1,
    cells,
    origin: { c: rect.c1, r: rect.r1 },
  };
}

/** Write a block of raw values at `at`, growing the sheet if needed. */
export function pasteBlock(sheet: SheetData, at: Pos, block: string[][]): SheetData {
  const cells = { ...sheet.cells };
  let cols = sheet.cols;
  let rows = sheet.rows;
  block.forEach((line, dr) =>
    line.forEach((value, dc) => {
      const c = at.c + dc;
      const r = at.r + dr;
      const addr = refName(c, r);
      if (value === "") delete cells[addr];
      else cells[addr] = value;
      cols = Math.max(cols, c + 1);
      rows = Math.max(rows, r + 1);
    }),
  );
  return { ...sheet, cells, cols, rows };
}

/** A clip pasted at `at`, with formulas shifted like Excel. */
export function clipToBlock(clip: Clip, at: Pos): string[][] {
  const dc = at.c - clip.origin.c;
  const dr = at.r - clip.origin.r;
  return Array.from({ length: clip.height }, (_, r) =>
    Array.from({ length: clip.width }, (_, c) =>
      offsetFormula(clip.cells[`${c},${r}`] ?? "", dc, dr),
    ),
  );
}

export function clearRect(sheet: SheetData, rect: Rect): SheetData {
  const cells = { ...sheet.cells };
  for (let r = rect.r1; r <= rect.r2; r++)
    for (let c = rect.c1; c <= rect.c2; c++) delete cells[refName(c, r)];
  return { ...sheet, cells };
}
