// Which words in a line of Markdown are prose that a spellchecker should look at.
// Links, tags, code, URLs, emails, block ids, math and template variables are skipped,
// as are words that look like identifiers (CamelCase, ACRONYMS, glued to digits).

export interface WordRange {
  from: number;
  to: number;
  word: string;
}

const WORD = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

/** Spans that aren't prose, matched per line. */
const SKIP: RegExp[] = [
  /`[^`\n]*`/g, // inline code
  /!?\[\[[^\]\n]*\]\]/g, // wikilinks and embeds
  /\]\([^)\n]*\)/g, // Markdown link targets
  /<[^>\n]+>/g, // HTML tags, autolinks
  /\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S+/gi, // URLs
  /[\w.+-]+@[\w-]+\.[\w.-]+/g, // emails
  /(?<![\p{L}\p{N}_&])#[\p{L}\p{N}_/-]+/gu, // tags
  /\s\^[\w-]+\s*$/g, // block ids
  /\$[^$\n]+\$/g, // inline math
  /\{\{[^}\n]*\}\}/g, // template variables
  /:[a-z0-9_+-]+:/g, // emoji shortcodes
  /(?:^|\s)\/[\w/.-]*[/.][\w/.-]*/g, // file paths
];

const GLUE_BEFORE = /[\p{N}_/\\@.]/u;
const GLUE_AFTER = /[\p{N}_/\\@]/u;

/** Normalize a word for dictionary lookups (curly apostrophes, case kept). */
export function normalizeWord(word: string): string {
  return word.replace(/’/g, "'");
}

function looksLikeIdentifier(word: string): boolean {
  // Any uppercase letter after the first: CamelCase, iPhone-style, or ACRONYM.
  return /\p{Lu}/u.test(word.slice(1));
}

/** Prose words in `line`; positions are offset by `offset` (the line's start). */
export function proseWords(line: string, offset = 0, skip: [number, number][] = []): WordRange[] {
  const blocked: [number, number][] = skip.map(([a, b]) => [a - offset, b - offset]);
  for (const re of SKIP) {
    re.lastIndex = 0;
    for (const m of line.matchAll(re)) blocked.push([m.index, m.index + m[0].length]);
  }
  const out: WordRange[] = [];
  for (const m of line.matchAll(WORD)) {
    const from = m.index;
    const to = from + m[0].length;
    if (blocked.some(([a, b]) => from < b && to > a)) continue;
    const word = m[0];
    if ([...word].length < 2 || looksLikeIdentifier(word)) continue;
    const before = line[from - 1] ?? "";
    const after = line[to] ?? "";
    if (before && GLUE_BEFORE.test(before)) continue;
    if (after && GLUE_AFTER.test(after)) continue;
    // "file.txt", "e.g": a dot followed directly by a letter.
    if (after === "." && /\p{L}/u.test(line[to + 1] ?? "")) continue;
    out.push({ from: from + offset, to: to + offset, word });
  }
  return out;
}
