import { formatDate } from "../../lib/dates";

// Built-in templates and template rendering.
// Variables: {{title}} {{date}} {{time}} {{date:FORMAT}} {{prompt:Question}} {{cursor}}

export interface Template {
  id: string;
  name: string;
  /** Template text, or null for user templates loaded from a note. */
  body: string;
  /** Path of a user template note; undefined for built-ins. */
  path?: string;
}

export const PAGE_STYLES = ["plain", "lined", "dotted", "math-grid", "cornell"] as const;
export type PageStyle = (typeof PAGE_STYLES)[number];
export const PAGE_STYLE_PROP = "axis-style";

export const BUILTIN_TEMPLATES: Template[] = [
  { id: "builtin:plain", name: "Plain", body: "# {{title}}\n\n{{cursor}}" },
  {
    id: "builtin:cornell",
    name: "Cornell notes",
    body: `---\n${PAGE_STYLE_PROP}: cornell\n---\n# {{title}}\n\n## Cues\n\n- \n\n## Notes\n\n{{cursor}}\n\n## Summary\n\n`,
  },
  {
    id: "builtin:math-grid",
    name: "Math grid",
    body: `---\n${PAGE_STYLE_PROP}: math-grid\n---\n# {{title}}\n\n{{cursor}}`,
  },
  {
    id: "builtin:lined",
    name: "Lined paper",
    body: `---\n${PAGE_STYLE_PROP}: lined\n---\n# {{title}}\n\n{{cursor}}`,
  },
  {
    id: "builtin:dotted",
    name: "Dotted paper",
    body: `---\n${PAGE_STYLE_PROP}: dotted\n---\n# {{title}}\n\n{{cursor}}`,
  },
  {
    id: "builtin:daily",
    name: "Daily note",
    body: "# {{date:dddd, MMMM D, YYYY}}\n\n## Tasks\n\n- [ ] {{cursor}}\n\n## Notes\n\n",
  },
  {
    id: "builtin:meeting",
    name: "Meeting",
    body: "---\ndate: {{date}}\nattendees: []\n---\n# {{prompt:Meeting topic}}\n\n## Agenda\n\n- {{cursor}}\n\n## Notes\n\n## Action items\n\n- [ ] \n",
  },
];

export interface RenderContext {
  title: string;
  now: Date;
  /** Answers to `{{prompt:...}}` variables, keyed by question. */
  answers?: Record<string, string>;
}

const VAR_RE = /\{\{\s*([a-zA-Z]+)(?::([^}]*))?\s*\}\}/g;

/** Questions asked by `{{prompt:...}}` variables, in order, without duplicates. */
export function promptsIn(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(VAR_RE)) {
    if (m[1]!.toLowerCase() === "prompt" && m[2] && !out.includes(m[2].trim()))
      out.push(m[2].trim());
  }
  return out;
}

/**
 * Fill in template variables. Returns the text and the cursor offset (where `{{cursor}}`
 * was, else the end). Unknown variables are left as they are.
 */
export function renderTemplate(body: string, ctx: RenderContext): { text: string; cursor: number } {
  let cursor = -1;
  let text = "";
  let last = 0;
  for (const m of body.matchAll(VAR_RE)) {
    text += body.slice(last, m.index);
    last = m.index + m[0].length;
    const name = m[1]!.toLowerCase();
    const arg = m[2]?.trim();
    switch (name) {
      case "title":
        text += ctx.title;
        break;
      case "date":
        text += formatDate(ctx.now, arg || "YYYY-MM-DD");
        break;
      case "time":
        text += formatDate(ctx.now, arg || "HH:mm");
        break;
      case "prompt":
        text += (arg && ctx.answers?.[arg]) ?? "";
        break;
      case "cursor":
        if (cursor === -1) cursor = text.length;
        break;
      default:
        text += m[0];
    }
  }
  text += body.slice(last);
  return { text, cursor: cursor === -1 ? text.length : cursor };
}
