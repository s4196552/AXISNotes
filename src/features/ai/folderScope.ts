import type { AiRule, NoteRef } from "../../ipc";

// Which notes "Ask AI about this folder" sends. Notes under an "AI: never" rule are left
// out here and listed, instead of blocking the whole request; the Rust layer still checks
// every attached note and refuses the request if one slips through (fail closed).

/** At most this many notes go with one folder request. */
export const MAX_FOLDER_NOTES = 100;

/** The rule for a path: its own, else the nearest ancestor folder's, else "any". */
export function ruleForPath(rules: Record<string, AiRule>, path: string): AiRule {
  let p = path.replace(/^\/+|\/+$/g, "");
  for (;;) {
    const r = rules[p];
    if (r) return r;
    if (!p) return "any";
    const i = p.lastIndexOf("/");
    p = i === -1 ? "" : p.slice(0, i);
  }
}

export interface FolderScope {
  /** Notes to attach, in path order. */
  include: string[];
  /** Notes left out because they're marked "AI: never". */
  never: string[];
  /** Notes left out because of `MAX_FOLDER_NOTES`. */
  overLimit: number;
  /** The strictest rule among the included notes. */
  rule: AiRule;
}

const inFolder = (path: string, folder: string, subfolders: boolean) => {
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (!folder) return subfolders || dir === "";
  return dir === folder || (subfolders && dir.startsWith(`${folder}/`));
};

export function folderScope(
  notes: NoteRef[],
  folder: string,
  subfolders: boolean,
  rules: Record<string, AiRule>,
): FolderScope {
  const paths = notes
    .map((n) => n.path)
    .filter((p) => inFolder(p, folder.replace(/^\/+|\/+$/g, ""), subfolders))
    .sort((a, b) => a.localeCompare(b));
  const never: string[] = [];
  const allowed: string[] = [];
  let rule: AiRule = "any";
  for (const p of paths) {
    const r = ruleForPath(rules, p);
    if (r === "never") never.push(p);
    else {
      allowed.push(p);
      if (r === "local") rule = "local";
    }
  }
  const include = allowed.slice(0, MAX_FOLDER_NOTES);
  return { include, never, overLimit: allowed.length - include.length, rule };
}
