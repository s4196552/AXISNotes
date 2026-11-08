import type { AiRule } from "../ipc/types";
import { splitFrontmatter } from "./markdown";

// A note's own AI mark (`ai-access: local` in its frontmatter, or
// `<meta name="ai-access" content="local">` in a page). AI output made from stricter
// notes gets it, so it keeps its sources' privacy wherever it's saved. The Rust layer
// (`src-tauri/src/ai/privacy.rs`, `note_mark`) is the reference and enforces it.

export const AI_ACCESS_KEY = "ai-access";

const ORDER: AiRule[] = ["any", "local", "never"];

/** The stricter of two rules. */
export const stricter = (a: AiRule, b: AiRule): AiRule =>
  ORDER.indexOf(b) > ORDER.indexOf(a) ? b : a;

const parseRule = (v: unknown): AiRule =>
  typeof v === "string" && ORDER.includes(v.trim().toLowerCase() as AiRule)
    ? (v.trim().toLowerCase() as AiRule)
    : "never";

const isHtml = (path: string) => /\.html?$/i.test(path);
const MARK_LINE = /^[ \t]*ai-access[ \t]*:.*$/m;

/** A note's own mark, or null. A mark that can't be read counts as "never". */
export function noteMark(path: string, text: string): AiRule | null {
  if (isHtml(path)) {
    const head = text.slice(0, 16384);
    const tag = /<meta\b[^>]*\bai-access\b[^>]*>/i.exec(head)?.[0];
    if (!tag) return /ai-access/i.test(head) ? "never" : null;
    const content = /\bcontent\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2];
    return content === undefined ? "never" : parseRule(content);
  }
  const fm = splitFrontmatter(text);
  if (AI_ACCESS_KEY in fm.props) return parseRule(fm.props[AI_ACCESS_KEY]);
  // Broken YAML hides every property; a mark written there still counts.
  return MARK_LINE.test(fm.yaml) ? "never" : null;
}

/**
 * `text` with its mark raised to `rule` (never lowered; unchanged for "any"). Edits only
 * the one line, so the rest of the frontmatter keeps its formatting even if it's broken.
 */
export function markText(path: string, text: string, rule: AiRule): string {
  const current = noteMark(path, text) ?? "any";
  if (rule === "any" || stricter(current, rule) === current) return text;
  if (isHtml(path)) {
    const meta = `<meta name="ai-access" content="${rule}">`;
    const existing = /<meta\b[^>]*\bai-access\b[^>]*>/i;
    if (existing.test(text)) return text.replace(existing, meta);
    const head = /<head\b[^>]*>/i.exec(text);
    if (head)
      return (
        text.slice(0, head.index + head[0].length) + meta + text.slice(head.index + head[0].length)
      );
    return meta + "\n" + text;
  }
  const line = `${AI_ACCESS_KEY}: ${rule}`;
  const fm = splitFrontmatter(text);
  if (!fm.length) return `---\n${line}\n---\n${text}`;
  const open = /^---[ \t]*\r?\n/.exec(text)![0].length;
  const block = text.slice(open, open + fm.yaml.length);
  if (MARK_LINE.test(block))
    return text.slice(0, open) + block.replace(MARK_LINE, line) + text.slice(open + fm.yaml.length);
  return text.slice(0, open) + line + "\n" + text.slice(open);
}
