import { backend, type Mention } from "../../ipc";
import { noteName } from "../../lib/markdown";

/** Wikilink text for a mention: `[[Name]]`, or `[[Name|as written]]` if the case differs. */
export function linkTextFor(targetPath: string, mention: string): string {
  const name = noteName(targetPath);
  return mention === name ? `[[${name}]]` : `[[${name}|${mention}]]`;
}

/**
 * Replace one unlinked mention in its source file with a wikilink. Fails (returns false)
 * if the file changed so the text at the offsets no longer matches.
 */
export async function linkMention(targetPath: string, m: Mention): Promise<boolean> {
  const file = await backend.readFile(m.source);
  if (file.content.slice(m.start, m.end) !== m.text) return false;
  const next =
    file.content.slice(0, m.start) + linkTextFor(targetPath, m.text) + file.content.slice(m.end);
  await backend.writeFile(m.source, next, file.modifiedMs);
  return true;
}
