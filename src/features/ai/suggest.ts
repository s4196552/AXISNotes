import type { AiRunRequest, NoteRef } from "../../ipc";
import { InvalidAnswer, parseAnswer, type Schema } from "../../lib/aiJson";
import { findWikilinks, maskCode, splitFrontmatter, withFrontmatter } from "../../lib/markdown";
import { text } from "./runAi";

// "Suggest tags, title and links": a cheap model looks at a note, the vault's existing
// tags and the notes it mentions but doesn't link, and proposes tags, a better title and
// links. Nothing changes until the user ticks what to keep (SuggestDialog).

export interface LinkSuggestion {
  /** Words in the note to turn into a link. */
  text: string;
  /** The note to link to (a path from the candidates). */
  target: string;
}

export interface Suggestions {
  tags: string[];
  title: string | null;
  links: LinkSuggestion[];
}

/** A note the model may link to: its path and the names it goes by. */
export interface LinkCandidate {
  path: string;
  names: string[];
}

const MAX_CANDIDATES = 60;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `text` occurs in the note as a whole word or phrase, outside code and existing links. */
function plainOffset(body: string, needle: string): number {
  if (!needle.trim()) return -1;
  let masked = maskCode(body);
  for (const l of findWikilinks(body))
    masked = masked.slice(0, l.from) + " ".repeat(l.to - l.from) + masked.slice(l.to);
  // Markdown links [label](url) too.
  masked = masked.replace(/\[[^\]\n]*\]\([^)\n]*\)/g, (m) => " ".repeat(m.length));
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}])`, "iu");
  const m = re.exec(masked);
  return m ? m.index : -1;
}

/**
 * Notes this note mentions by name or alias without linking them, nearest first in the
 * text (at most 60). Names under three characters are ignored.
 */
export function linkCandidates(path: string, noteText: string, notes: NoteRef[]): LinkCandidate[] {
  const body = noteText.slice(splitFrontmatter(noteText).length);
  const found: { at: number; c: LinkCandidate }[] = [];
  for (const n of notes) {
    if (n.path === path || !/\.md$/i.test(n.path)) continue;
    const names = [n.name, ...n.aliases].filter((x) => x.trim().length >= 3);
    const offsets = names.map((x) => plainOffset(body, x)).filter((o) => o >= 0);
    if (offsets.length) found.push({ at: Math.min(...offsets), c: { path: n.path, names } });
  }
  return found
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_CANDIDATES)
    .map((f) => f.c);
}

const SCHEMA: Schema = {
  type: "object",
  props: {
    tags: { type: "array", items: { type: "string" }, max: 8 },
    title: { type: "string", optional: true },
    links: {
      type: "array",
      max: 20,
      items: { type: "object", props: { text: { type: "string" }, target: { type: "string" } } },
    },
  },
};

export function suggestRequest(
  path: string,
  existingTags: string[],
  candidates: LinkCandidate[],
): AiRunRequest {
  const list = candidates.map((c) => `- ${c.path} (called: ${c.names.join(", ")})`).join("\n");
  return {
    task: "textFixes",
    json: true,
    attach: [path],
    messages: [
      text(
        "system",
        "You organise notes in a Markdown notes app. Reply with only a JSON object: " +
          '{"tags": [...], "title": "..." or null, "links": [{"text": "...", "target": "..."}]}.\n' +
          "- tags: up to 5 tags that describe the note, lower-case, words joined with - and nested " +
          "with / (like biology/cells), without #. Prefer the vault's existing tags; leave out tags " +
          "the note already has.\n" +
          "- title: a clearer title for the note, or null if it's already good.\n" +
          "- links: places where the note mentions another note but doesn't link it. text must be " +
          "copied exactly from the note; target must be one of the candidate paths. Only suggest " +
          "links that really refer to that note.",
      ),
      text(
        "user",
        `Existing tags in the vault: ${existingTags.slice(0, 200).join(", ") || "none yet"}.\n\n` +
          `Candidate notes to link:\n${list || "none"}\n\nSuggest tags, a title and links for the attached note.`,
      ),
    ],
  };
}

const TAG = /^[\p{L}\p{N}_-]+(\/[\p{L}\p{N}_-]+)*$/u;

/** A tag the way notes write it: no `#`, lower-case, spaces as `-`. */
export const cleanTag = (t: string) =>
  t.trim().replace(/^#+/, "").toLowerCase().replace(/\s+/g, "-");

/** The note's tags in its frontmatter (`tags:` as a list or a comma-separated string). */
export function frontmatterTags(noteText: string): string[] {
  const raw = splitFrontmatter(noteText).props.tags;
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  return list.map((t) => cleanTag(String(t))).filter(Boolean);
}

/**
 * Check the model's answer against the note: tags must be valid and new, a title must
 * differ from the current one, and each link's text must appear (outside code and links)
 * with a target from the candidates. Invalid items are problems (one retry is asked for);
 * duplicates and tags the note already has are quietly dropped.
 */
export function parseSuggestions(
  answer: string,
  ctx: { noteText: string; currentTitle: string; candidates: LinkCandidate[] },
): Suggestions {
  const raw = parseAnswer<{ tags: string[]; title?: string | null; links: LinkSuggestion[] }>(
    answer,
    SCHEMA,
  );
  const problems: string[] = [];
  const has = new Set(frontmatterTags(ctx.noteText));
  const inline = new Set(
    [...ctx.noteText.matchAll(/(?<![\p{L}\p{N}#])#([\p{L}\p{N}_/-]+)/gu)].map((m) =>
      m[1]!.toLowerCase(),
    ),
  );
  const tags: string[] = [];
  for (const t of raw.tags) {
    const tag = cleanTag(t);
    if (!TAG.test(tag)) problems.push(`tag ${JSON.stringify(t)} isn't a valid tag`);
    else if (!has.has(tag) && !inline.has(tag) && !tags.includes(tag)) tags.push(tag);
  }
  const title = raw.title?.trim() || null;
  const body = ctx.noteText.slice(splitFrontmatter(ctx.noteText).length);
  const targets = new Map(ctx.candidates.map((c) => [c.path.toLowerCase(), c.path]));
  const links: LinkSuggestion[] = [];
  for (const l of raw.links) {
    const target =
      targets.get(l.target.trim().toLowerCase()) ??
      targets.get(`${l.target.trim().toLowerCase()}.md`);
    if (!target) problems.push(`link target ${JSON.stringify(l.target)} isn't a candidate path`);
    else if (plainOffset(body, l.text) < 0)
      problems.push(
        `link text ${JSON.stringify(l.text)} isn't in the note (outside code and links)`,
      );
    else if (!links.some((x) => x.target === target)) links.push({ text: l.text, target });
  }
  if (problems.length) throw new InvalidAnswer(problems);
  return {
    tags: tags.slice(0, 5),
    title: title && title !== ctx.currentTitle ? title : null,
    links,
  };
}

/** The note name a link uses: the path without `.md`, or just the name when unique. */
const linkTarget = (path: string) => path.replace(/\.md$/i, "");

/** Add tags to the note's frontmatter `tags` (keeping the ones it has). */
export function addTags(noteText: string, tags: string[]): string {
  if (!tags.length) return noteText;
  const fm = splitFrontmatter(noteText);
  const current = frontmatterTags(noteText);
  const next = [...current, ...tags.filter((t) => !current.includes(t))];
  return withFrontmatter(noteText, { ...fm.props, tags: next });
}

/** Turn the first plain mention of each link's text into a link to its target. */
export function addLinks(noteText: string, links: LinkSuggestion[]): string {
  let out = noteText;
  for (const l of links) {
    const start = splitFrontmatter(out).length;
    const at = plainOffset(out.slice(start), l.text);
    if (at < 0) continue;
    const from = start + at;
    const written = out.slice(from, from + l.text.length);
    const target = linkTarget(l.target);
    const name = target.slice(target.lastIndexOf("/") + 1);
    // Keep the words as written; a link shows its note's name, so no alias is needed then.
    const link = written === name ? `[[${target}]]` : `[[${target}|${written}]]`;
    out = out.slice(0, from) + link + out.slice(from + l.text.length);
  }
  return out;
}
