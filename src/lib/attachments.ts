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

// ---- Video, audio and media from the web (T-075) ----

export type MediaKind = "image" | "video" | "audio";

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)$/i;
const AUDIO_EXT = /\.(mp3|wav|ogg|oga|m4a|flac|opus)$/i;

/** What a vault path or web address shows as inline, by its extension; null if nothing. */
export function mediaKind(pathOrUrl: string): MediaKind | null {
  const p = isWebUrl(pathOrUrl) ? pathOrUrl.replace(/[?#].*$/, "") : pathOrUrl;
  if (IMAGE_EXT.test(p)) return "image";
  if (VIDEO_EXT.test(p)) return "video";
  if (AUDIO_EXT.test(p)) return "audio";
  return null;
}

export const isWebUrl = (s: string) => /^https?:\/\//i.test(s.trim());

/** `1h2m3s`, `90s` or `90` as seconds (YouTube's `t=`); 0 if unreadable. */
function seconds(t: string | null): number {
  if (!t) return 0;
  if (/^\d+s?$/.test(t)) return parseInt(t, 10);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(t);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
}

/**
 * A YouTube or Vimeo link as the address of its embeddable player, or null. YouTube uses
 * its privacy-enhanced (no-cookie) player; a `t=` start time is kept.
 */
export function videoPlayerUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, "");
  let id: string | null = null;
  if (host === "youtu.be") id = u.pathname.split("/")[1] ?? null;
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    id =
      u.pathname === "/watch"
        ? u.searchParams.get("v")
        : (/^\/(?:embed|shorts|live|v)\/([^/]+)/.exec(u.pathname)?.[1] ?? null);
  }
  if (id && /^[\w-]{6,20}$/.test(id)) {
    const start = seconds(u.searchParams.get("t") ?? u.searchParams.get("start"));
    return `https://www.youtube-nocookie.com/embed/${id}${start ? `?start=${start}` : ""}`;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const m = /^\/(?:video\/)?(\d+)(?:\/([0-9a-f]+))?\/?$/.exec(u.pathname);
    if (m) {
      const hash = m[2] ?? u.searchParams.get("h");
      return `https://player.vimeo.com/video/${m[1]}${hash ? `?h=${hash}` : ""}`;
    }
  }
  return null;
}

/** What a line that is only a Markdown image, `![alt|300](src "title")`, points at. */
export function parseMarkdownEmbed(
  line: string,
): { alt: string; src: string; width: number | null } | null {
  const m = /^[ \t]*!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^\s()]+)(?:\s+"[^"\n]*")?\s*\)[ \t]*$/.exec(
    line,
  );
  if (!m) return null;
  let alt = m[1]!;
  let width: number | null = null;
  const size = /\|\s*(\d{1,4})(?:x\d{1,4})?\s*$/.exec(alt); // Obsidian's `![alt|300](…)`
  if (size) {
    width = Number(size[1]);
    alt = alt.slice(0, size.index);
  }
  let src = m[2]!.replace(/^<|>$/g, "");
  if (!isWebUrl(src)) {
    try {
      src = decodeURIComponent(src); // `My%20photo.png`
    } catch {
      // Not escaped: keep it as written.
    }
  }
  return { alt: alt.trim(), src, width };
}

/** A `../`-style path written in `from` as a vault path (unchanged if it has none). */
export function resolveRelative(target: string, from: string): string {
  if (!/^\.\.?\//.test(target)) return target;
  const parts = dirOf(from) ? dirOf(from).split("/") : [];
  for (const seg of target.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

/**
 * The vault file an embed's target means. An explicit `./` or `../` path means exactly
 * that file (or nothing); a bare name or path is found like Obsidian does (see
 * `resolveAttachment`).
 */
export function resolveMedia(target: string, from: string, tree: VaultEntry | null): string | null {
  if (!/^\.\.?\//.test(target)) return resolveAttachment(target, from, tree);
  const want = resolveRelative(target, from).toLowerCase();
  return allFiles(tree).find((f) => f.toLowerCase() === want) ?? null;
}

/**
 * The vault folder new attachments for the note `from` go to, from the setting (Obsidian's
 * forms): "" or "/" the vault root, "./" the note's folder, "./name" a folder next to the
 * note, anything else that vault folder.
 */
export function attachmentDir(setting: string, from: string): string {
  const s = setting.trim().replace(/\\/g, "/");
  if (s === "./" || s === ".") return dirOf(from);
  if (s.startsWith("./")) {
    const sub = s.slice(2).replace(/^\/+|\/+$/g, "");
    return [dirOf(from), sub].filter(Boolean).join("/");
  }
  return s.replace(/^\/+|\/+$/g, "");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Obsidian's name for a pasted image: `Pasted image 20261013211845.png`. */
export function pastedName(ext: string, now = new Date()): string {
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/avif": "avif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/ogg": "ogv",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/flac": "flac",
};

/**
 * The file name to save a pasted file under: its own name when it has a real one (a file
 * copied in Explorer), else Obsidian's `Pasted image <time>` (a screenshot). Null if it
 * isn't an image, video or audio file.
 */
export function pastedFileName(file: { name: string; type: string }, now = new Date()) {
  const named = file.name && !/^image\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name);
  if (named && mediaKind(file.name)) return file.name;
  const ext = MIME_EXT[file.type.toLowerCase()];
  return ext ? pastedName(ext, now) : null;
}

/**
 * The embed for an attachment just added at `path`: `![[name]]` like Obsidian, or the
 * full path when another file in the vault has the same name. Names a wikilink can't hold
 * (`#`, `|`, `[`, `]`, `^`) use Markdown's `![](<path>)` instead.
 */
export function embedFor(path: string, tree: VaultEntry | null): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  // `%`, `<` and `>` are escaped so `parseMarkdownEmbed` reads the same path back.
  if (/[#|[\]^]/.test(path))
    return `![](<${path.replace(/[%<>]/g, (c) => encodeURIComponent(c))}>)`;
  const lower = name.toLowerCase();
  const clash = allFiles(tree).some(
    (f) => f !== path && f.slice(f.lastIndexOf("/") + 1).toLowerCase() === lower,
  );
  return `![[${clash ? path : name}]]`;
}
