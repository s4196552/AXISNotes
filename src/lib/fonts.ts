import type { VaultEntry } from "../ipc";

// Fonts imported into the vault (Settings → Appearance → Typography). They live in a
// normal vault folder, so the vault carries them to another computer, and each file is
// offered as a font family named after the file (`Atkinson Hyperlegible.ttf`).

/** Font files that can be imported (matches the Rust side). */
export const FONT_EXTENSIONS = ["ttf", "otf", "woff", "woff2"] as const;
/** Where imported fonts go (matches `FONTS_FOLDER` on the Rust side). */
export const VAULT_FONTS_FOLDER = "Attachments/Fonts";

const FONT_EXT = new RegExp(`\\.(${FONT_EXTENSIONS.join("|")})$`, "i");
export const isFontPath = (p: string) => FONT_EXT.test(p);

const CSS_FORMAT: Record<string, string> = {
  ttf: "truetype",
  otf: "opentype",
  woff: "woff",
  woff2: "woff2",
};

export interface VaultFont {
  /** The family name it's offered under: the file name without its extension. */
  family: string;
  path: string;
  /** The CSS `format()` hint. */
  format: string;
}

/** The font files directly inside the vault's fonts folder, A–Z by family. */
export function vaultFonts(tree: VaultEntry | null): VaultFont[] {
  let dir: VaultEntry | undefined = tree ?? undefined;
  for (const part of VAULT_FONTS_FOLDER.split("/"))
    dir = dir?.children?.find(
      (c) => c.kind === "dir" && c.name.toLowerCase() === part.toLowerCase(),
    );
  const seen = new Set<string>();
  return (dir?.children ?? [])
    .filter((e) => e.kind === "file" && isFontPath(e.name))
    .map((e) => {
      const dot = e.name.lastIndexOf(".");
      const ext = e.name.slice(dot + 1).toLowerCase();
      return { family: e.name.slice(0, dot).trim(), path: e.path, format: CSS_FORMAT[ext]! };
    })
    .filter(
      (f) => f.family && !seen.has(f.family.toLowerCase()) && seen.add(f.family.toLowerCase()),
    )
    .sort((a, b) => a.family.toLowerCase().localeCompare(b.family.toLowerCase()));
}

/** `@font-face` rules for the vault's fonts; `url(path)` gives each file's URL (or null). */
export function fontFaceCss(fonts: VaultFont[], url: (path: string) => string | null): string {
  const quote = (s: string) => `"${s.replace(/["\\\n\r]/g, "")}"`;
  return fonts
    .map((f) => {
      const src = url(f.path);
      return src
        ? `@font-face { font-family: ${quote(f.family)}; src: url(${quote(src)}) format(${quote(f.format)}); font-display: swap; }`
        : "";
    })
    .filter(Boolean)
    .join("\n");
}
