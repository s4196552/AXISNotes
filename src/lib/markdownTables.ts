/** Markdown remains the source of truth; rendering a table never rewrites a note. */
export type TableAlignment = "left" | "center" | "right" | null;
export interface MarkdownTable {
  rows: string[][];
  alignment: TableAlignment[];
}

/** Split structural pipes, keeping escaped pipes, code spans and Obsidian aliases. */
function cellRanges(line: string, borders = true): { from: number; to: number }[] {
  const cells: { from: number; to: number }[] = [];
  let from = 0;
  let code = 0;
  let wiki = false;
  const text = line;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "\\" && i + 1 < text.length) {
      i++;
    } else if (char === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      if (!code) code = run.length;
      else if (code === run.length) code = 0;
      i += run.length - 1;
    } else if (!code && text.slice(i, i + 2) === "[[") {
      wiki = true;
      i++;
    } else if (!code && wiki && text.slice(i, i + 2) === "]]") {
      wiki = false;
      i++;
    } else if (char === "|" && !code && !wiki) {
      cells.push({ from, to: i });
      from = i + 1;
    }
  }
  cells.push({ from, to: text.length });
  if (borders && text.trimStart().startsWith("|")) cells.shift();
  // An escaped final pipe is part of the last cell, not the optional border.
  if (borders && text.slice(from).trim() === "" && text.trimEnd().endsWith("|") && cells.length > 1)
    cells.pop();
  return cells;
}

export function tableCells(line: string): string[] {
  return cellRanges(line).map(({ from, to }) => line.slice(from, to).trim());
}

/** Replace only a cell's content, retaining borders, padding and separator rows. */
export function replaceTableCell(
  source: string,
  row: number,
  column: number,
  value: string,
): string {
  const lines = source.split("\n");
  const index = row === 0 ? 0 : row + 1;
  const line = lines[index];
  if (line === undefined) return source;
  const ranges = cellRanges(line);
  const range = ranges[column];
  const insert = tableCellSource(value).trim();
  if (range) {
    const raw = line.slice(range.from, range.to);
    const leading = /^\s*/.exec(raw)![0].length;
    const trailing = raw.trim() ? /\s*$/.exec(raw)![0].length : 0;
    lines[index] = line.slice(0, range.from + leading) + insert + line.slice(range.to - trailing);
  } else {
    // The preview pads short rows. Materialise a missing cell only when edited.
    const end = ranges.at(-1)?.to ?? line.length;
    lines[index] =
      line.slice(0, end) + " |".repeat(column - ranges.length + 1) + " " + insert + line.slice(end);
    if (row === 0) {
      const separator = lines[1]!;
      const markers = cellRanges(separator);
      const markerEnd = markers.at(-1)!.to;
      lines[1] =
        separator.slice(0, markerEnd) +
        " | ---".repeat(column - markers.length + 1) +
        separator.slice(markerEnd);
    }
  }
  // An empty first/last cell without borders otherwise looks like an optional
  // border and disappears from the parser. Add only the border needed to retain it.
  if (!insert.trim() && range) {
    if (column === 0 && !line.trimStart().startsWith("|")) lines[index] = "|" + lines[index];
    if (column === ranges.length - 1 && !line.trimEnd().endsWith("|")) lines[index] += "|";
  }
  return lines.join("\n");
}

export function parseTable(lines: readonly string[]): MarkdownTable | null {
  if (lines.length < 2) return null;
  const header = tableCells(lines[0]!);
  const separator = tableCells(lines[1]!);
  if (!lines[0]!.includes("|") || !header.length || separator.length !== header.length) return null;
  if (!separator.every((cell) => /^:?-+:?$/.test(cell))) return null;
  const rows = [header, ...lines.slice(2).map(tableCells)];
  // Preserve excess cells rather than silently dropping data from an irregular table.
  const columns = Math.max(...rows.map((row) => row.length));
  const alignment = Array.from({ length: columns }, (_, i): TableAlignment => {
    const marker = separator[i] ?? "---";
    return marker.startsWith(":")
      ? marker.endsWith(":")
        ? "center"
        : "left"
      : marker.endsWith(":")
        ? "right"
        : null;
  });
  return {
    rows: rows.map((row) => Array.from({ length: columns }, (_, i) => row[i] ?? "")),
    alignment,
  };
}

/** Escape a new cell without changing already escaped pipes or Obsidian aliases. */
export function tableCellSource(value: string): string {
  const text = value.replace(/\r?\n/g, "<br>");
  const pipes = new Set(
    cellRanges(text, false)
      .slice(0, -1)
      .map(({ to }) => to),
  );
  return Array.from({ length: text.length }, (_, i) => (pipes.has(i) ? "\\" : "") + text[i]).join(
    "",
  );
}

export function formatTable(table: MarkdownTable): string {
  const widths = table.alignment.map((_, i) =>
    Math.max(3, ...table.rows.map((row) => (row[i] ?? "").length)),
  );
  const row = (cells: readonly string[]) =>
    `| ${widths.map((width, i) => (cells[i] ?? "").padEnd(width)).join(" | ")} |`;
  const separators = table.alignment.map((align, i) => {
    const width = widths[i]!;
    return align === "center"
      ? `:${"-".repeat(Math.max(1, width - 2))}:`
      : align === "left"
        ? `:${"-".repeat(width - 1)}`
        : align === "right"
          ? `${"-".repeat(width - 1)}:`
          : "-".repeat(width);
  });
  return [row(table.rows[0]!), row(separators), ...table.rows.slice(1).map(row)].join("\n");
}
