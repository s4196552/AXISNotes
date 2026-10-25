/** Markdown remains the source of truth; rendering a table never rewrites a note. */
export type TableAlignment = "left" | "center" | "right" | null;
export interface MarkdownTable {
  rows: string[][];
  alignment: TableAlignment[];
}

/** Split structural pipes, keeping escaped pipes, code spans and Obsidian aliases. */
export function tableCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let code = 0;
  let wiki = false;
  const text = line.trim();
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "\\" && i + 1 < text.length) {
      cell += char + text[++i];
    } else if (char === "`") {
      const run = /^`+/.exec(text.slice(i))![0];
      if (!code) code = run.length;
      else if (code === run.length) code = 0;
      cell += run;
      i += run.length - 1;
    } else if (!code && text.slice(i, i + 2) === "[[") {
      wiki = true;
      cell += "[[";
      i++;
    } else if (!code && wiki && text.slice(i, i + 2) === "]]") {
      wiki = false;
      cell += "]]";
      i++;
    } else if (char === "|" && !code && !wiki) {
      cells.push(cell.trim());
      cell = "";
    } else cell += char;
  }
  cells.push(cell.trim());
  if (text.startsWith("|")) cells.shift();
  // An escaped final pipe is part of the last cell, not the optional border.
  if (cells.at(-1) === "" && text.endsWith("|")) cells.pop();
  return cells;
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
  return value.replace(/\r?\n/g, "<br>").replace(/(?<!\\)\|/g, "\\|");
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
