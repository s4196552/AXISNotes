import type { EditorState } from "@codemirror/state";
import type { NoteRef } from "../../ipc";
import type { OpenTarget } from "../../app/store";

/** Lowercased names, aliases and extensionless paths of all notes, for link styling. */
const knownCache = new WeakMap<NoteRef[], Set<string>>();
export function isKnownTarget(notes: NoteRef[], target: string): boolean {
  let known = knownCache.get(notes);
  if (!known) {
    known = new Set();
    for (const n of notes) {
      known.add(n.name.toLowerCase());
      known.add(n.path.slice(0, -3).toLowerCase());
      for (const a of n.aliases) known.add(a.toLowerCase());
    }
    knownCache.set(notes, known);
  }
  const t = target.trim().replace(/^\/+/, "").replace(/\.md$/i, "").toLowerCase();
  if (known.has(t)) return true;
  // A partial path like `Deep/Note` matches `Work/Deep/Note`.
  return (
    t.includes("/") &&
    notes.some((n) =>
      n.path
        .slice(0, -3)
        .toLowerCase()
        .endsWith("/" + t),
    )
  );
}

/** Position to jump to for a heading, block id or line; null if not found. */
export function findTarget(state: EditorState, target: OpenTarget): number | null {
  if (target.line) {
    return state.doc.line(Math.min(Math.max(1, target.line), state.doc.lines)).from;
  }
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (target.heading) {
      const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line.text);
      if (m && m[1]!.toLowerCase() === target.heading.toLowerCase()) return line.from;
    } else if (target.block && line.text.trimEnd().endsWith(`^${target.block}`)) {
      return line.from;
    }
  }
  return null;
}

/** Smallest single replacement turning `a` into `b`. */
export function minimalChange(a: string, b: string) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  return { from: start, to: endA, insert: b.slice(start, endB) };
}
