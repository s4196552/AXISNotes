// Making search results readable: the heading a match sits under, and snippets without
// Markdown syntax. The index returns raw note text (see src-tauri/src/index/search.rs,
// which finds headings the same way).

const HEADING = /^#{1,6}[ \t]+(.+?)[ \t#]*$/;
const FENCE = /^\s*(```|~~~)/;

/** The text of the last heading at or before `offset` in `body` (code blocks skipped). */
export function headingAt(body: string, offset: number): string | null {
  if (offset < 0) return null;
  let found: string | null = null;
  let fence = false;
  let pos = 0;
  for (const line of body.split("\n")) {
    if (pos > offset) break;
    if (FENCE.test(line)) fence = !fence;
    else if (!fence) {
      const m = HEADING.exec(line.replace(/\r$/, ""));
      if (m) found = m[1]!;
    }
    pos += line.length + 1;
  }
  return found;
}

/**
 * A snippet with Markdown syntax removed: heading and list markers, task boxes, emphasis,
 * code ticks, highlights, and links shown as their text. The match markers (`start`,
 * `end`) are kept.
 */
export function cleanSnippet(snippet: string): string {
  return (
    snippet
      // [[Note|alias]] → alias, [[Note#Heading]] → Note#Heading, ![[embed]] → embed
      .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
      .replace(/!?\[\[([^\]]*)\]\]/g, "$1")
      // [text](url) and ![alt](url) → text
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Line starts: headings, quotes, list bullets, numbers and task boxes.
      .replace(
        /(^|\n|…)[ \t]*(#{1,6}[ \t]+|>[ \t]*|[-*+][ \t]+(\[[ xX]\][ \t]+)?|\d+[.)][ \t]+)/g,
        "$1",
      )
      .replace(/(^|\s)#{1,6}[ \t]+/g, "$1")
      // Emphasis, strike, highlight and code markers.
      .replace(/(\*\*|__|~~|==|\*|`)/g, "")
      .replace(/(^|[\s(])_([^_\s][^_]*)_(?=[\s).,!?:;]|$)/g, "$1$2")
      // Block ids and line breaks.
      .replace(/[ \t]\^[\w-]+(?=\s|$)/g, "")
      .replace(/\s*\n\s*/g, " ")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}
