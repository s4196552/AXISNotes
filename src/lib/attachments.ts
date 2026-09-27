import type { VaultEntry } from "../ipc";

// Attachments (images, PDFs, ...) referenced from notes as `![[photo.png]]`. Like
// Obsidian, a bare file name matches anywhere in the vault, preferring the note's folder.

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;

export const isImagePath = (p: string) => IMAGE_EXT.test(p);

/** Split `photo.png|300` into the target and an optional width in pixels. */
export function parseImageEmbed(inner: string): { target: string; width: number | null } {
  const [target = "", size = ""] = inner.split("|");
  const w = /^\s*(\d{1,4})(?:x\d{1,4})?\s*$/.exec(size);
  return { target: target.trim(), width: w ? Number(w[1]) : null };
}

function allFiles(tree: VaultEntry | null): string[] {
  const out: string[] = [];
  const walk = (e: VaultEntry) => {
    if (e.children) e.children.forEach(walk);
    else if (e.kind === "file") out.push(e.path);
  };
  if (tree) walk(tree);
  return out;
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** Vault path of the attachment `target` linked from `from`, or null. */
export function resolveAttachment(
  target: string,
  from: string,
  tree: VaultEntry | null,
): string | null {
  const files = allFiles(tree);
  const want = target.replace(/^\.?\//, "").toLowerCase();
  const dir = dirOf(from);
  const candidates = [dir ? `${dir}/${want}`.toLowerCase() : want, want];
  for (const c of candidates) {
    const hit = files.find((f) => f.toLowerCase() === c);
    if (hit) return hit;
  }
  const name = want.slice(want.lastIndexOf("/") + 1);
  const matches = files.filter(
    (f) => f.toLowerCase().endsWith(`/${name}`) || f.toLowerCase() === name,
  );
  if (!matches.length) return null;
  // Closest to the note: same folder, then the shortest path.
  return (
    matches.find((f) => dirOf(f).toLowerCase() === dir.toLowerCase()) ??
    matches.sort((a, b) => a.length - b.length)[0]!
  );
}
