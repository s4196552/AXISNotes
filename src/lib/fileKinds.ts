// Which view opens a vault file, decided by extension.

export type DocKind = "markdown" | "grid" | "canvas";

export const GRID_EXT = ".axgrid";
export const CANVAS_EXT = ".axcanvas";

const KINDS: [ext: string, kind: DocKind][] = [
  [".md", "markdown"],
  [".txt", "markdown"],
  [GRID_EXT, "grid"],
  [CANVAS_EXT, "canvas"],
];

export function docKind(path: string): DocKind | null {
  const lower = path.toLowerCase();
  return KINDS.find(([ext]) => lower.endsWith(ext))?.[1] ?? null;
}

/** Drag type the file tree sets with an entry's path (e.g. to drop notes onto a canvas). */
export const PATH_MIME = "application/x-axis-path";

/** Extensions hidden in the file tree and kept on rename. */
export const HIDDEN_EXTS = [".md", GRID_EXT, CANVAS_EXT];

/** The hidden extension `name` ends with (in its original case), or "". */
export function hiddenExt(name: string): string {
  const lower = name.toLowerCase();
  const ext = HIDDEN_EXTS.find((e) => lower.endsWith(e) && lower.length > e.length);
  return ext ? name.slice(name.length - ext.length) : "";
}
