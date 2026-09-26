// Markdown tasks in the Obsidian Tasks emoji format. Mirrors src-tauri/src/index/tasks.rs
// (the in-memory backend uses this for tests and browser dev).

export interface ParsedTask {
  /** 1-based line in the file. */
  line: number;
  raw: string;
  text: string;
  done: boolean;
  /** `YYYY-MM-DD`. */
  due: string | null;
  /** 0 = none, 1 = low, 2 = medium, 3 = high. */
  priority: number;
}

const TASK_RE = /^\s*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\](?:[ \t]|$)(.*)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_MARKERS = new Set(["✅", "➕", "🛫", "⏳"]);
const DUE_MARKERS = new Set(["📅", "🗓️", "🗓"]);

export function parseTaskLine(line: string, lineNo: number): ParsedTask | null {
  const m = TASK_RE.exec(line);
  if (!m) return null;
  const tokens = m[2]!.split(/\s+/).filter(Boolean);
  let due: string | null = null;
  let priority = 0;
  const words: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const next = tokens[i + 1];
    if (DUE_MARKERS.has(tok) && next && DATE_RE.test(next)) {
      due = next;
      i++;
    } else if (DATE_MARKERS.has(tok) && next && DATE_RE.test(next)) {
      i++;
    } else if (tok === "🔺" || tok === "⏫") {
      priority = 3;
    } else if (tok === "🔼") {
      priority = 2;
    } else if (tok === "🔽" || tok === "⏬") {
      priority = Math.max(priority, 1);
    } else if (tok.startsWith("due:") && DATE_RE.test(tok.slice(4))) {
      due = tok.slice(4);
    } else {
      words.push(tok);
    }
  }
  const last = words.at(-1);
  if (last && last.length > 1 && last.startsWith("^")) words.pop();
  return { line: lineNo, raw: line, text: words.join(" "), done: m[1] !== " ", due, priority };
}

/** Tasks in a Markdown document, skipping frontmatter and fenced code. */
export function findTasks(text: string): ParsedTask[] {
  const out: ParsedTask[] = [];
  let fence: string | null = null;
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  let start = 0;
  if (lines[0]?.trimEnd() === "---") {
    const close = lines.findIndex(
      (l, i) => i > 0 && (l.trimEnd() === "---" || l.trimEnd() === "..."),
    );
    if (close > 0) start = close + 1;
  }
  lines.forEach((line, i) => {
    if (i < start) return;
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (f) {
      if (!fence) fence = f[1]!;
      else if (f[1]![0] === fence[0] && f[1]!.length >= fence.length) fence = null;
      return;
    }
    if (fence) return;
    const t = parseTaskLine(line, i + 1);
    if (t) out.push(t);
  });
  return out;
}

/**
 * The line with its checkbox set to `done`. Completing a task stamps `✅ <today>` (the
 * Obsidian Tasks convention); reopening removes the stamp.
 */
export function setTaskDone(line: string, done: boolean, today: string): string {
  const m = /^(\s*(?:[-*+]|\d+[.)])[ \t]+\[)([ xX])(\].*)$/.exec(line);
  if (!m) return line;
  let rest = m[3]!.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, "");
  if (done) {
    // Keep a trailing ^block-id last.
    const id = /(\s\^[\w-]+)\s*$/.exec(rest);
    rest = id
      ? `${rest.slice(0, id.index)} ✅ ${today}${id[1]}`
      : `${rest.replace(/\s+$/, "")} ✅ ${today}`;
  }
  return m[1] + (done ? "x" : " ") + rest;
}

/** Sort like the Rust index: open first, then due (undated last), priority, path, line. */
export function compareTasks(
  a: ParsedTask & { path: string },
  b: ParsedTask & { path: string },
): number {
  return (
    Number(a.done) - Number(b.done) ||
    Number(a.due === null) - Number(b.due === null) ||
    (a.due ?? "").localeCompare(b.due ?? "") ||
    b.priority - a.priority ||
    (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
    a.line - b.line
  );
}
