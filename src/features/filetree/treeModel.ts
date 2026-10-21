import type { VaultEntry } from "../../ipc";
import { docKind, hiddenExt } from "../../lib/fileKinds";

// Pure helpers for the file tree. Paths are vault-relative with "/" separators; root is "".

export interface Row {
  entry: VaultEntry;
  depth: number;
}

/** Visible rows in display order, skipping children of collapsed folders. `order` is the
 *  custom order by folder (config `fileOrder`). */
export function visibleRows(
  tree: VaultEntry | null,
  expanded: ReadonlySet<string>,
  order: Readonly<Record<string, readonly string[]>> = {},
): Row[] {
  const rows: Row[] = [];
  const walk = (dir: string, entries: VaultEntry[] | undefined, depth: number) => {
    for (const entry of orderedChildren(entries ?? [], order[dir])) {
      rows.push({ entry, depth });
      if (entry.kind === "dir" && expanded.has(entry.path))
        walk(entry.path, entry.children, depth + 1);
    }
  };
  walk("", tree?.children, 1);
  return rows;
}

// ---- Custom order (dragging between items) ----

/** `entries` (folders first, A–Z, as listed) with the names in `order` first, in that
 *  order; the rest follow as they were. */
export function orderedChildren(entries: VaultEntry[], order: unknown): VaultEntry[] {
  if (!Array.isArray(order) || order.length === 0) return entries;
  const rank = new Map<string, number>();
  order.forEach((name, i) => typeof name === "string" && !rank.has(name) && rank.set(name, i));
  const listed = entries.filter((e) => rank.has(e.name));
  if (listed.length === 0) return entries;
  listed.sort((a, b) => rank.get(a.name)! - rank.get(b.name)!);
  return [...listed, ...entries.filter((e) => !rank.has(e.name))];
}

/** Where a drop lands relative to a row: before or after it, or into it (a folder). */
export type DropSide = "before" | "after" | "into";

/** The drop side for a pointer at `y` over a row spanning `top`–`top + height`: the
 *  middle half of a folder drops into it, the edges between rows. */
export function dropSide(y: number, top: number, height: number, isDir: boolean): DropSide {
  const f = height > 0 ? (y - top) / height : 0.5;
  if (isDir) return f < 0.25 ? "before" : f > 0.75 ? "after" : "into";
  return f < 0.5 ? "before" : "after";
}

/** `names` with `name` taken out and put before or after `target`. */
export function placeName(
  names: readonly string[],
  name: string,
  target: string,
  side: "before" | "after",
): string[] {
  const out = names.filter((n) => n !== name);
  const i = out.indexOf(target);
  if (i === -1) return [...out, name];
  out.splice(side === "before" ? i : i + 1, 0, name);
  return out;
}

/**
 * The custom order after `from` was renamed or moved to `to` (or deleted, `to` null): its
 * own and its subfolders' lists follow it, and its name changes in (or leaves) its old
 * folder's list. Returns null when nothing changes.
 */
export function remapOrder(
  order: Readonly<Record<string, readonly string[]>>,
  from: string,
  to: string | null,
): Record<string, string[]> | null {
  let changed = false;
  const out: Record<string, string[]> = {};
  for (const [dir, names] of Object.entries(order)) {
    if (dir === from || dir.startsWith(from + "/")) {
      changed = true;
      if (to !== null) out[to + dir.slice(from.length)] = [...names];
    } else out[dir] = [...names];
  }
  const dir = parentPath(from);
  const list = out[dir];
  if (list?.includes(baseName(from))) {
    changed = true;
    out[dir] =
      to !== null && parentPath(to) === dir
        ? list.map((n) => (n === baseName(from) ? baseName(to) : n))
        : list.filter((n) => n !== baseName(from));
  }
  return changed ? out : null;
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

/** Files the app can open (notes, grids). Others are shown dimmed. */
export function isOpenable(entry: VaultEntry): boolean {
  if (entry.kind !== "file") return false;
  const kind = docKind(entry.name);
  return kind !== null && kind !== "other";
}

/** Notes and grids are shown without their extension. */
export function displayName(entry: VaultEntry): string {
  const ext = entry.kind === "file" ? hiddenExt(entry.name) : "";
  return ext ? entry.name.slice(0, -ext.length) : entry.name;
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
 * Final file name after an inline rename. Notes and grids keep their (hidden) extension
 * when the user leaves it out. Returns null when there is nothing to do.
 */
export function renamedName(entry: VaultEntry, input: string): string | null {
  const name = input.trim();
  if (!name) return null;
  const ext = entry.kind === "file" ? hiddenExt(entry.name) : "";
  const final = ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? name + ext : name;
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
