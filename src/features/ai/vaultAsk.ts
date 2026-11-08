import type { PassageRef } from "../../ipc";

// "Ask your vault": the parts of notes that answer a question are found by the Rust
// index (`vault_passages`), sent as passages the Rust layer re-reads and checks, and the
// answer cites them as [[path#Heading]] links.

export const VAULT_SYSTEM =
  "You are a helpful assistant inside a Markdown note-taking app. Answer the user's " +
  "question from the passages of their notes you're given, in Markdown. Each passage has " +
  "a `cite` attribute: when you use a passage, cite it right after the sentence, exactly as " +
  "given, for example [[School/Bio#Energy]]. Only cite passages you were given. If they " +
  "don't answer the question, say so plainly instead of guessing.";

/** How a passage is cited, matching the Rust `PassageRef::cite`: `School/Bio#Energy`. */
export function citeOf(p: PassageRef): string {
  const note = p.path.replace(/\.md$/i, "");
  return p.heading ? `${note}#${p.heading}` : note;
}

const norm = (s: string) => s.trim().replace(/\.md$/i, "").toLowerCase();

/**
 * Whether a `[[link]]` in an answer points at one of the passages sent: by path or note
 * name, and by heading when it gives one (aliases after `|` are ignored).
 */
export function citesPassage(inner: string, passages: PassageRef[]): boolean {
  const link = inner.split("|")[0]!;
  const [target = "", heading] = link.split("#");
  const t = norm(target);
  return passages.some((p) => {
    const path = norm(p.path);
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (t !== path && t !== name && !path.endsWith(`/${t}`)) return false;
    return !heading || heading.trim().toLowerCase() === (p.heading ?? "").toLowerCase();
  });
}

/** "12 passages from 9 notes". */
export function passageSummary(passages: PassageRef[]): string {
  const notes = new Set(passages.map((p) => p.path)).size;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return `${plural(passages.length, "passage")} from ${plural(notes, "note")}`;
}
