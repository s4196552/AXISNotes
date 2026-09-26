// Which view opens a vault file, decided by extension.

export type DocKind = "markdown" | "grid";

export const GRID_EXT = ".axgrid";

const KINDS: [ext: string, kind: DocKind][] = [
  [".md", "markdown"],
  [".txt", "markdown"],
  [GRID_EXT, "grid"],
];

export function docKind(path: string): DocKind | null {
  const lower = path.toLowerCase();
  return KINDS.find(([ext]) => lower.endsWith(ext))?.[1] ?? null;
}

/** Extensions hidden in the file tree and kept on rename. */
export const HIDDEN_EXTS = [".md", GRID_EXT];

/** The hidden extension `name` ends with (in its original case), or "". */
export function hiddenExt(name: string): string {
  const lower = name.toLowerCase();
  const ext = HIDDEN_EXTS.find((e) => lower.endsWith(e) && lower.length > e.length);
  return ext ? name.slice(name.length - ext.length) : "";
}
