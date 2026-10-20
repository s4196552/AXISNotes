import { splitFrontmatter } from "../../lib/markdown";

const WORD = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’_-]*/gu;

/** Words in `text`, counting runs of letters and digits (Markdown markers aren't words). */
export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** Words in a note's text, leaving out its frontmatter. */
export function wordCount(doc: string): number {
  return countWords(doc.slice(splitFrontmatter(doc).length));
}
