export interface Heading {
  /** 1 for `#`, up to 6. */
  level: number;
  text: string;
  /** 1-based line in the note. */
  line: number;
}

/** A note's Markdown headings in order, skipping code blocks and the frontmatter. */
export function listHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  let fence = false;
  const lines = text.split("\n");
  let i = 0;
  // Frontmatter: a `---` first line up to the next `---`.
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, j) => j > 0 && l.trim() === "---");
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i]!.replace(/\r$/, "");
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/.exec(line);
    if (m) out.push({ level: m[1]!.length, text: m[2]!, line: i + 1 });
  }
  return out;
}
