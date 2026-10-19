// Which view opens a vault file, decided by extension.

export type DocKind = "markdown" | "grid" | "canvas" | "image" | "media" | "other";

export const GRID_EXT = ".axgrid";
export const CANVAS_EXT = ".axcanvas";

const KINDS: [ext: string, kind: DocKind][] = [
  [".md", "markdown"],
  [".txt", "markdown"],
  [GRID_EXT, "grid"],
  [CANVAS_EXT, "canvas"],
];

const IMAGE_RE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
/** Video and audio, played in the app. */
const MEDIA_RE = /\.(mp4|webm|mov|m4v|ogv|mp3|wav|ogg|oga|m4a|flac|opus)$/i;
/** Binary or unknown files that must not be opened as text. */
const OTHER_RE = /\.(pdf|zip|docx?|xlsx?|pptx?|exe|dll|bin)$/i;

export function docKind(path: string): DocKind | null {
  const lower = path.toLowerCase();
  const kind = KINDS.find(([ext]) => lower.endsWith(ext))?.[1];
  if (kind) return kind;
  if (IMAGE_RE.test(lower)) return "image";
  if (MEDIA_RE.test(lower)) return "media";
  if (OTHER_RE.test(lower)) return "other";
  return null;
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
