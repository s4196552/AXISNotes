import type { EditorState, Text } from "@codemirror/state";

/** A built-in toggle's optional heading level and persisted open/closed marker. */
export const TOGGLE_HEAD = /^>\s*\[!toggle(?:\|h([1-6]))?\]([+-]?)[ \t]?/i;

export interface HeadingSection {
  kind: "markdown" | "toggle";
  first: number;
  last: number;
  level: number;
  from: number;
  /** End of the heading itself, including a Setext underline if present. */
  to: number;
  bodyTo: number;
  title: string;
}

interface Structure {
  headings: HeadingSection[];
  byLine: Map<number, HeadingSection>;
  structural: Set<number>;
}

const cache = new WeakMap<Text, Structure>();
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const paragraph = (text: string) =>
  !!text.trim() &&
  !/^(?: {4}|\t| {0,3}(?:[#>`~|]|[-+*][ \t]|\d+[.)][ \t]))/.test(text) &&
  !/^ {0,3}(?:=+|-+|\*{3,}|_{3,})[ \t]*$/.test(text);

/** A shared, full-document heading outline, independent of incremental parse progress. */
function structure(state: EditorState): Structure {
  const doc = state.doc;
  const found = cache.get(doc);
  if (found) return found;
  const headings: HeadingSection[] = [];
  const byLine = new Map<number, HeadingSection>();
  const structural = new Set<number>();
  const stack: HeadingSection[] = [];
  let fence: { marker: string; depth: number } | null = null;
  let comment = false;
  let start = 1;
  if (
    doc
      .line(1)
      .text.replace(/^\uFEFF/, "")
      .trimEnd() === "---"
  ) {
    start = doc.lines + 1;
    for (let n = 2; n <= doc.lines; n++) {
      if (/^(---|\.\.\.)[ \t]*$/.test(doc.line(n).text)) {
        start = n + 1;
        break;
      }
    }
  }
  const finish = (heading: HeadingSection, last: number) => {
    while (last > heading.first && !doc.line(last).text.trim()) last--;
    heading.last = Math.max(last, doc.lineAt(heading.to).number);
    heading.bodyTo = doc.line(heading.last).to;
  };
  for (let n = start; n <= doc.lines; n++) {
    const line = doc.line(n);
    let unquoted = line.text;
    let depth = 0;
    while (/^ {0,3}>[ \t]?/.test(unquoted)) {
      unquoted = unquoted.replace(/^ {0,3}>[ \t]?/, "");
      depth++;
    }
    if (fence && depth < fence.depth) fence = null;
    const f = FENCE.exec(unquoted);
    if (fence) {
      if (
        f &&
        depth === fence.depth &&
        f[1]![0] === fence.marker[0] &&
        f[1]!.length >= fence.marker.length &&
        !f[2]!.trim()
      )
        fence = null;
      continue;
    }
    if (comment) {
      if (line.text.includes("-->")) comment = false;
      continue;
    }
    if (/^ {0,3}<!--/.test(line.text)) {
      comment = !line.text.includes("-->");
      continue;
    }
    if (f && !(f[1]![0] === "`" && f[2]!.includes("`"))) {
      fence = { marker: f[1]!, depth };
      continue;
    }
    structural.add(n);
    const toggle = TOGGLE_HEAD.exec(line.text);
    const atx = ATX.exec(line.text);
    let first = n;
    let level = toggle?.[1] ? Number(toggle[1]) : atx?.[1]!.length;
    let title = toggle?.[1] ? line.text.slice(toggle[0].length) : (atx?.[2] ?? "");
    if (
      !level &&
      /^ {0,3}(=+|-+)[ \t]*$/.test(line.text) &&
      n > start &&
      structural.has(n - 1) &&
      paragraph(doc.line(n - 1).text)
    ) {
      first = n - 1;
      while (
        first > start &&
        structural.has(first - 1) &&
        paragraph(doc.line(first - 1).text) &&
        !byLine.has(first - 1)
      )
        first--;
      level = line.text.trimStart()[0] === "=" ? 1 : 2;
      title = state.sliceDoc(doc.line(first).from, doc.line(n - 1).to).replace(/\n/g, " ");
    }
    if (!level) continue;
    while (stack.length && stack[stack.length - 1]!.level >= level) finish(stack.pop()!, first - 1);
    const heading: HeadingSection = {
      kind: toggle?.[1] ? "toggle" : "markdown",
      first,
      last: n,
      level,
      from: doc.line(first).from,
      to: line.to,
      bodyTo: line.to,
      title: title.replace(/[ \t]+#+[ \t]*$/, "").trim(),
    };
    headings.push(heading);
    byLine.set(first, heading);
    stack.push(heading);
  }
  while (stack.length) finish(stack.pop()!, doc.lines);
  const result = { headings, byLine, structural };
  cache.set(doc, result);
  return result;
}

export const headingSections = (state: EditorState): readonly HeadingSection[] =>
  structure(state).headings;
export const headingSectionAt = (state: EditorState, line: number) =>
  structure(state).byLine.get(line);
export const structuralLine = (state: EditorState, line: number) =>
  structure(state).structural.has(line);
