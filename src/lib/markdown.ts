import { isMap, parseDocument, stringify } from "yaml";

// Shared Markdown helpers for the UI and the in-memory backend. The Rust indexer
// (`src-tauri/src/index/parse.rs`) is the reference implementation; keep them in step.

export type Props = Record<string, unknown>;

export interface Frontmatter {
  props: Props;
  /** Length (UTF-16) of the frontmatter block including both `---` lines; 0 if none. */
  length: number;
  /** Raw YAML between the delimiters. */
  yaml: string;
}

/** Parse a leading `---` YAML block. Invalid YAML yields empty props but keeps `length`. */
export function splitFrontmatter(text: string): Frontmatter {
  const first = /^---[ \t]*\r?\n/.exec(text);
  if (!first) return { props: {}, length: 0, yaml: "" };
  const close = /^(---|\.\.\.)[ \t]*(\r?\n|$)/m;
  const rest = text.slice(first[0].length);
  const m = close.exec(rest);
  if (!m) return { props: {}, length: 0, yaml: "" };
  const yaml = rest.slice(0, m.index);
  const length = first[0].length + m.index + m[0].length;
  let props: Props = {};
  try {
    const doc = parseDocument(yaml);
    const value: unknown = doc.errors.length ? null : doc.toJS();
    if (value && typeof value === "object" && !Array.isArray(value)) props = value as Props;
  } catch {
    props = {};
  }
  return { props, length, yaml };
}

/**
 * Replace the note's frontmatter with `props` (removing it when empty), keeping the
 * original key order and comments where possible.
 */
export function withFrontmatter(text: string, props: Props): string {
  const fm = splitFrontmatter(text);
  const body = text.slice(fm.length);
  const keys = Object.keys(props);
  if (keys.length === 0) return body.replace(/^\r?\n/, "");
  let yaml: string;
  if (!fm.yaml.trim()) {
    yaml = stringify(props);
  } else {
    try {
      const doc = parseDocument(fm.yaml);
      if (!isMap(doc.contents)) throw new Error("not a map");
      for (const key of Object.keys((doc.toJS() as Props) ?? {})) {
        if (!(key in props)) doc.delete(key);
      }
      for (const key of keys) doc.set(key, props[key]);
      yaml = doc.toString();
    } catch {
      yaml = stringify(props);
    }
  }
  return `---\n${yaml.endsWith("\n") ? yaml : yaml + "\n"}---\n${fm.length ? body : "\n" + body}`;
}

export interface ParsedLink {
  target: string;
  heading: string | null;
  block: string | null;
  alias: string | null;
  embed: boolean;
  /** UTF-16 range of the whole `[[...]]` (including `!` for embeds). */
  from: number;
  to: number;
}

/** Replace fenced code blocks and inline code spans with spaces (same length). */
export function maskCode(text: string): string {
  let out = text.replace(
    /^([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?(^[ \t]*\2[ \t]*$|(?![\s\S]))/gm,
    (m) => m.replace(/[^\n]/g, " "),
  );
  out = out.replace(/(`+)([^`\n]|[^`\n][\s\S]*?[^`\n])\1(?!`)/g, (m) => " ".repeat(m.length));
  return out;
}

export function parseWikilinkInner(inner: string): Omit<ParsedLink, "embed" | "from" | "to"> {
  const [targetPart = "", ...aliasParts] = inner.split("|");
  const alias = aliasParts.length ? aliasParts.join("|").trim() : null;
  const hash = targetPart.indexOf("#");
  const target = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim();
  const anchor = hash === -1 ? "" : targetPart.slice(hash + 1);
  return {
    target,
    alias,
    heading: anchor && !anchor.startsWith("^") ? anchor : null,
    block: anchor.startsWith("^") ? anchor.slice(1) : null,
  };
}

export function findWikilinks(text: string): ParsedLink[] {
  const masked = maskCode(text);
  const links: ParsedLink[] = [];
  for (const m of masked.matchAll(/(!?)\[\[([^[\]\n]+?)\]\]/g)) {
    links.push({
      ...parseWikilinkInner(m[2]!),
      embed: m[1] === "!",
      from: m.index,
      to: m.index + m[0].length,
    });
  }
  return links;
}

const TAG_RE = /(^|[\s(])#([\p{L}\p{N}_/-]+)/gu;

/** Lowercased inline + frontmatter tags, deduplicated, without `#`. */
export function findTags(text: string): string[] {
  const fm = splitFrontmatter(text);
  const body = maskCode(text.slice(fm.length));
  const tags: string[] = [];
  for (const m of body.matchAll(TAG_RE)) {
    const tag = m[2]!.replace(/\/+$/, "");
    if (tag && !/^\d+$/.test(tag)) tags.push(tag);
  }
  for (const key of ["tags", "tag"])
    tags.push(...propStrings(fm.props[key]).map((t) => t.replace(/^#/, "")));
  return [...new Set(tags.map((t) => t.toLowerCase()).filter(Boolean))];
}

export function propStrings(v: unknown): string[] {
  if (typeof v === "string") return v.split(/[,\s]+/).filter(Boolean);
  if (typeof v === "number") return [String(v)];
  if (Array.isArray(v)) return v.flatMap(propStrings);
  return [];
}

export function aliasesOf(props: Props): string[] {
  return [...propStrings(props.aliases), ...propStrings(props.alias)];
}

/** Basename without `.md`. */
export function noteName(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.toLowerCase().endsWith(".md") ? base.slice(0, -3) : base;
}

export function isNotePath(path: string): boolean {
  return path.toLowerCase().endsWith(".md");
}
