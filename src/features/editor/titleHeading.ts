import {
  type EditorState,
  type Extension,
  Facet,
  RangeSetBuilder,
  StateField,
} from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { splitFrontmatter } from "../../lib/markdown";

/**
 * The note's titles: the one the header shows, and its file name. When the note's first
 * line is a `# Heading` with one of them, that heading is hidden so the title doesn't
 * show twice (like Obsidian's inline title). It shows again while the cursor is on it,
 * and the file is never changed.
 */
export const noteTitle = Facet.define<string, readonly string[]>({
  combine: (values) => values,
});

/** How a daily note's title shows its date. */
export const DAILY_TITLE_FORMAT = "dddd, MMMM D, YYYY";

/** A note's name: its file name without `.md`. */
export function titleOf(path: string) {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.toLowerCase().endsWith(".md") ? name.slice(0, -3) : name;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The range covering the first line when it is `# <title>` (plus one blank line after
 * it), or null. Only the first non-blank line after the frontmatter counts.
 */
export function titleHeadingRange(state: EditorState): { from: number; to: number } | null {
  const titles = state.facet(noteTitle).map(norm).filter(Boolean);
  if (titles.length === 0) return null;
  const doc = state.doc;
  const start = splitFrontmatter(state.sliceDoc(0, Math.min(doc.length, 20_000))).length;
  if (start > doc.length) return null;
  let line = doc.lineAt(start);
  while (!line.text.trim() && line.number < doc.lines) line = doc.line(line.number + 1);
  const m = /^#[ \t]+(.+?)[ \t#]*$/.exec(line.text);
  if (!m || !titles.includes(norm(m[1]!))) return null;
  let to = line.to;
  if (line.number < doc.lines) {
    const next = doc.line(line.number + 1);
    if (!next.text.trim()) to = next.to;
  }
  return { from: line.from, to };
}

/**
 * Where a note's cursor starts: below a hidden title heading, else at `fallback`. Lines
 * `drawnAsBlock` (an image or note embed) show their source while the cursor is on them,
 * so the cursor starts on the first line after them instead: a clipped screenshot's note
 * opens showing the screenshot (T-296).
 */
export function startBelowTitle(
  state: EditorState,
  fallback: number,
  drawnAsBlock?: (text: string) => boolean,
): number {
  const r = titleHeadingRange(state);
  if (!r || fallback > r.to) return fallback;
  const doc = state.doc;
  const at = Math.min(r.to + 1, doc.length);
  if (!drawnAsBlock) return at;
  for (let line = doc.lineAt(at); ; line = doc.line(line.number + 1)) {
    if (!drawnAsBlock(line.text)) return line.from;
    // Nothing but embeds below the title: start where it would have.
    if (line.number === doc.lines) return at;
  }
}

function decorations(state: EditorState): DecorationSet {
  const r = titleHeadingRange(state);
  if (!r) return Decoration.none;
  const touched = state.selection.ranges.some((s) => s.to >= r.from && s.from <= r.to);
  if (touched) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  b.add(r.from, r.to, Decoration.replace({ block: true }));
  return b.finish();
}

const hidden = StateField.define<DecorationSet>({
  create: decorations,
  update(value, tr) {
    return tr.docChanged || tr.selection ? decorations(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Hide a first heading that repeats any of `titles` (the shown title, the file name). */
export function titleHeading(titles: readonly string[]): Extension {
  return [titles.map((t) => noteTitle.of(t)), hidden];
}
