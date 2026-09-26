import { splitFrontmatter } from "./markdown";

// Blocks inside a note's text: a list item (with its children), a paragraph, or a heading
// section. Offsets are UTF-16 (JS string indices). Mirrors Obsidian's block semantics.

export interface TextRange {
  from: number;
  to: number;
}

interface LineInfo {
  text: string;
  from: number;
  to: number;
}

const LIST_RE = /^([ \t]*)([-*+]|\d+[.)])[ \t]/;
const HEADING_RE = /^(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const BLOCK_ID_RE = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;
const FENCE_RE = /^[ \t]*(```|~~~)/;

function lines(text: string): LineInfo[] {
  const out: LineInfo[] = [];
  let from = 0;
  for (const raw of text.split("\n")) {
    out.push({ text: raw, from, to: from + raw.length });
    from += raw.length + 1;
  }
  return out;
}

const indentOf = (s: string) => s.length - s.trimStart().length;
const blank = (l: LineInfo) => l.text.trim() === "";

/** Line index range [first, last] of the block containing line `i`. */
function blockLines(ls: LineInfo[], i: number): [number, number] {
  const line = ls[i]!;
  if (LIST_RE.test(line.text)) {
    const indent = indentOf(line.text);
    let last = i;
    for (let n = i + 1; n < ls.length; n++) {
      if (blank(ls[n]!)) break;
      if (indentOf(ls[n]!.text) <= indent) break;
      last = n;
    }
    return [i, last];
  }
  if (HEADING_RE.test(line.text)) return [i, i];
  // Paragraph: contiguous non-blank, non-heading, non-list lines.
  const isPara = (l: LineInfo) => !blank(l) && !HEADING_RE.test(l.text) && !LIST_RE.test(l.text);
  let first = i;
  while (first > 0 && isPara(ls[first - 1]!)) first--;
  let last = i;
  while (last + 1 < ls.length && isPara(ls[last + 1]!)) last++;
  return [first, last];
}

function codeLineMask(ls: LineInfo[]): boolean[] {
  let inFence = false;
  return ls.map((l) => {
    if (FENCE_RE.test(l.text)) {
      inFence = !inFence;
      return true;
    }
    return inFence;
  });
}

/** The range of the block marked `^id`, or null. */
export function findBlock(text: string, id: string): TextRange | null {
  const ls = lines(text);
  const code = codeLineMask(ls);
  for (let i = 0; i < ls.length; i++) {
    if (code[i]) continue;
    const m = BLOCK_ID_RE.exec(ls[i]!.text);
    if (m && m[1] === id) {
      // An id on its own line refers to the block just above it.
      const own = ls[i]!.text.trim() === `^${id}`;
      const at = own ? Math.max(0, i - 1) : i;
      const [first, blockLast] = blockLines(ls, at);
      // For list items the id sits on the item's own line; its children come along.
      const last = own ? i : blockLast;
      return { from: ls[first]!.from, to: ls[last]!.to };
    }
  }
  return null;
}

/** The heading line plus its section (until the next heading of the same or higher level). */
export function findSection(text: string, heading: string): TextRange | null {
  const ls = lines(text);
  const code = codeLineMask(ls);
  const want = heading.trim().toLowerCase();
  for (let i = 0; i < ls.length; i++) {
    if (code[i]) continue;
    const m = HEADING_RE.exec(ls[i]!.text);
    if (!m || m[2]!.toLowerCase() !== want) continue;
    const level = m[1]!.length;
    let last = ls.length - 1;
    for (let n = i + 1; n < ls.length; n++) {
      const h = !code[n] && HEADING_RE.exec(ls[n]!.text);
      if (h && h[1]!.length <= level) {
        last = n - 1;
        break;
      }
    }
    while (last > i && blank(ls[last]!)) last--;
    return { from: ls[i]!.from, to: ls[last]!.to };
  }
  return null;
}

/** The note without its frontmatter. */
export function bodyRange(text: string): TextRange {
  const fm = splitFrontmatter(text).length;
  return { from: fm, to: text.length };
}

export function embedRange(
  text: string,
  anchor: { heading?: string | null; block?: string | null },
): TextRange | null {
  if (anchor.block) return findBlock(text, anchor.block);
  if (anchor.heading) return findSection(text, anchor.heading);
  return bodyRange(text);
}

export function newBlockId(): string {
  return Math.random().toString(36).slice(2, 8).padEnd(6, "0");
}

/**
 * Make sure the block containing offset `pos` has an id. Returns the (possibly updated)
 * text and the id. The id goes at the end of a list item's own line, or the paragraph's
 * last line; headings can't carry ids (use `#Heading` links instead) and return null.
 */
export function ensureBlockId(
  text: string,
  pos: number,
  makeId = newBlockId,
): { text: string; id: string } | null {
  const ls = lines(text);
  const i = ls.findIndex((l) => pos >= l.from && pos <= l.to);
  if (i === -1 || blank(ls[i]!) || HEADING_RE.test(ls[i]!.text)) return null;
  if (codeLineMask(ls)[i]) return null;
  const [first, last] = blockLines(ls, i);
  const target = LIST_RE.test(ls[first]!.text) ? first : last;
  const existing = BLOCK_ID_RE.exec(ls[target]!.text);
  if (existing) return { text, id: existing[1]! };
  const id = makeId();
  const at = ls[target]!.to;
  const sep = ls[target]!.text.endsWith(" ") ? "" : " ";
  return { text: text.slice(0, at) + `${sep}^${id}` + text.slice(at), id };
}

export interface BlockChoice {
  /** First line of the block, without list markup or id. */
  label: string;
  /** Existing block id, if any. */
  id: string | null;
  /** Offset inside the block (for `ensureBlockId`). */
  pos: number;
}

/** Referenceable blocks (paragraphs and list items) of a note, for `[[Note#^` completion. */
export function listBlocks(text: string): BlockChoice[] {
  const ls = lines(text);
  const code = codeLineMask(ls);
  const fmEnd = splitFrontmatter(text).length;
  const out: BlockChoice[] = [];
  let i = 0;
  while (i < ls.length) {
    const l = ls[i]!;
    if (l.from < fmEnd || code[i] || blank(l) || HEADING_RE.test(l.text)) {
      i++;
      continue;
    }
    const isList = LIST_RE.test(l.text);
    const [first, last] = blockLines(ls, i);
    const idLine = isList ? first : last;
    const id = BLOCK_ID_RE.exec(ls[idLine]!.text)?.[1] ?? null;
    const label = ls[first]!.text.replace(LIST_RE, "")
      .replace(/^\[[ xX]\][ \t]*/, "")
      .replace(BLOCK_ID_RE, "")
      .trim();
    if (label) out.push({ label, id, pos: ls[first]!.from });
    // List items: step into children (each is referenceable); paragraphs: skip to the end.
    i = isList ? first + 1 : last + 1;
  }
  return out;
}

/** Headings of a note, for `[[Note#` completion. */
export function listHeadings(text: string): string[] {
  const ls = lines(text);
  const code = codeLineMask(ls);
  return ls.flatMap((l, i) => {
    const m = !code[i] && HEADING_RE.exec(l.text);
    return m ? [m[2]!] : [];
  });
}
