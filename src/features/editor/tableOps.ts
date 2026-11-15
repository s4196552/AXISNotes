import type { MarkdownTable, TableAlignment } from "../../lib/markdownTables";

// Row and column edits for a rendered Markdown table, like Obsidian's table menu. Row 0 is
// the header: it stays first (rows can't move above it or be deleted). Each returns a new
// table; the editor writes it back as Markdown.

const copy = (t: MarkdownTable): MarkdownTable => ({
  rows: t.rows.map((r) => [...r]),
  alignment: [...t.alignment],
});
const width = (t: MarkdownTable) => t.alignment.length;
const blankRow = (t: MarkdownTable) => Array.from({ length: width(t) }, () => "");
const clampRow = (t: MarkdownTable, i: number) => Math.min(Math.max(i, 1), t.rows.length);

/** A blank row at `at` (1 = first body row). */
export function insertRow(t: MarkdownTable, at: number): MarkdownTable {
  const next = copy(t);
  next.rows.splice(clampRow(t, at), 0, blankRow(t));
  return next;
}

export function deleteRow(t: MarkdownTable, row: number): MarkdownTable {
  if (row < 1 || row >= t.rows.length) return t;
  const next = copy(t);
  next.rows.splice(row, 1);
  return next;
}

export function duplicateRow(t: MarkdownTable, row: number): MarkdownTable {
  if (row < 1 || row >= t.rows.length) return t;
  const next = copy(t);
  next.rows.splice(row + 1, 0, [...t.rows[row]!]);
  return next;
}

/** Move body row `from` to index `to` (both 1-based body rows). */
export function moveRow(t: MarkdownTable, from: number, to: number): MarkdownTable {
  if (from < 1 || from >= t.rows.length) return t;
  const target = Math.min(Math.max(to, 1), t.rows.length - 1);
  if (target === from) return t;
  const next = copy(t);
  const [row] = next.rows.splice(from, 1);
  next.rows.splice(target, 0, row!);
  return next;
}

/** A blank column at `at` (0 = first). */
export function insertColumn(t: MarkdownTable, at: number): MarkdownTable {
  const i = Math.min(Math.max(at, 0), width(t));
  const next = copy(t);
  next.alignment.splice(i, 0, null);
  next.rows.forEach((r) => {
    while (r.length < width(t)) r.push("");
    r.splice(i, 0, "");
  });
  return next;
}

export function deleteColumn(t: MarkdownTable, column: number): MarkdownTable {
  if (width(t) <= 1 || column < 0 || column >= width(t)) return t;
  const next = copy(t);
  next.alignment.splice(column, 1);
  next.rows.forEach((r) => r.splice(column, 1));
  return next;
}

export function duplicateColumn(t: MarkdownTable, column: number): MarkdownTable {
  if (column < 0 || column >= width(t)) return t;
  const next = copy(t);
  next.alignment.splice(column + 1, 0, t.alignment[column] ?? null);
  next.rows.forEach((r) => r.splice(column + 1, 0, r[column] ?? ""));
  return next;
}

export function moveColumn(t: MarkdownTable, from: number, to: number): MarkdownTable {
  const target = Math.min(Math.max(to, 0), width(t) - 1);
  if (from < 0 || from >= width(t) || target === from) return t;
  const next = copy(t);
  const move = <T>(list: T[], fill: T) => {
    while (list.length < width(t)) list.push(fill);
    const [item] = list.splice(from, 1);
    list.splice(target, 0, item!);
  };
  move(next.alignment, null as TableAlignment);
  next.rows.forEach((r) => move(r, ""));
  return next;
}

export function alignColumn(
  t: MarkdownTable,
  column: number,
  align: TableAlignment,
): MarkdownTable {
  if (column < 0 || column >= width(t)) return t;
  const next = copy(t);
  next.alignment[column] = align;
  return next;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Sort the body rows by one column (numbers in order, empty cells last). */
export function sortByColumn(
  t: MarkdownTable,
  column: number,
  direction: "asc" | "desc",
): MarkdownTable {
  const next = copy(t);
  const sign = direction === "asc" ? 1 : -1;
  const body = next.rows.slice(1);
  body.sort((a, b) => {
    const x = (a[column] ?? "").trim();
    const y = (b[column] ?? "").trim();
    if (!x || !y) return x ? -1 : y ? 1 : 0;
    return sign * collator.compare(x, y);
  });
  next.rows = [next.rows[0]!, ...body];
  return next;
}
