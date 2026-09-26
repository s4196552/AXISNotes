import type { VaultEntry } from "../../ipc";

// Pure helpers for the file tree. Paths are vault-relative with "/" separators; root is "".

export interface Row {
  entry: VaultEntry;
  depth: number;
}

/** Visible rows in display order, skipping children of collapsed folders. */
export function visibleRows(tree: VaultEntry | null, expanded: ReadonlySet<string>): Row[] {
  const rows: Row[] = [];
  const walk = (entries: VaultEntry[] | undefined, depth: number) => {
    for (const entry of entries ?? []) {
      rows.push({ entry, depth });
      if (entry.kind === "dir" && expanded.has(entry.path)) walk(entry.children, depth + 1);
    }
  };
  walk(tree?.children, 1);
  return rows;
}

export function findEntry(tree: VaultEntry | null, path: string): VaultEntry | null {
  if (!tree) return null;
  if (tree.path === path) return tree;
  for (const child of tree.children ?? []) {
    if (path === child.path || path.startsWith(child.path + "/")) {
      return findEntry(child, path);
    }
  }
  return null;
}

export function parentPath(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "" : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function joinPath(dir: string, name: string): string {
  return dir === "" ? name : `${dir}/${name}`;
}

export function isMarkdown(name: string): boolean {
  return name.toLowerCase().endsWith(".md");
}

/** Files the editor can open. Others are shown dimmed. */
export function isOpenable(entry: VaultEntry): boolean {
  const n = entry.name.toLowerCase();
  return entry.kind === "file" && (n.endsWith(".md") || n.endsWith(".txt"));
}

/** Notes are shown without their `.md` extension. */
export function displayName(entry: VaultEntry): string {
  return entry.kind === "file" && isMarkdown(entry.name) ? entry.name.slice(0, -3) : entry.name;
}

/** `base + ext`, or `base N + ext` with the smallest N that isn't taken (case-insensitive). */
export function uniqueName(taken: Iterable<string>, base: string, ext = ""): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has((base + ext).toLowerCase())) return base + ext;
  for (let i = 1; ; i++) {
    const candidate = `${base} ${i}${ext}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Final file name after an inline rename. Notes keep their `.md` extension when the
 * user leaves it out. Returns null when there is nothing to do.
 */
export function renamedName(entry: VaultEntry, input: string): string | null {
  const name = input.trim();
  if (!name) return null;
  const final =
    entry.kind === "file" && isMarkdown(entry.name) && !isMarkdown(name) ? `${name}.md` : name;
  return final === entry.name ? null : final;
}

/** Whether `src` may be moved into folder `targetDir` (root is ""). */
export function canMove(src: string, targetDir: string): boolean {
  if (src === "" || src === targetDir) return false;
  if (targetDir.startsWith(src + "/")) return false; // into its own descendant
  return parentPath(src) !== targetDir; // already there
}

/** Rewrite expanded-folder paths after `from` was renamed/moved to `to`. */
export function remapPaths(paths: Iterable<string>, from: string, to: string): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    if (p === from) out.add(to);
    else if (p.startsWith(from + "/")) out.add(to + p.slice(from.length));
    else out.add(p);
  }
  return out;
}
