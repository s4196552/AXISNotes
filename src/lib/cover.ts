// A note's cover banner, kept in its frontmatter in the Obsidian Banners plugin's format so
// vaults move between the two apps unchanged:
//   banner: "[[Trips/attachments/coast.jpg]]"   a vault image (a plain path works too)
//   banner: gradient:dusk                      a built-in gradient (AXISNotes only)
//   banner: "#0090ff"                          a solid colour
//   banner_y: 0.3                              vertical focus of an image, 0 (top) – 1 (bottom)

export const COVER_KEY = "banner";
export const COVER_Y_KEY = "banner_y";
/** Frontmatter keys edited on the cover itself rather than in the properties chip. */
export const COVER_KEYS: ReadonlySet<string> = new Set([COVER_KEY, COVER_Y_KEY]);

export const GRADIENTS: Record<string, { label: string; css: string }> = {
  dusk: { label: "Dusk", css: "linear-gradient(120deg, #1f2a6b 0%, #6e3fa3 50%, #e0607e 100%)" },
  dawn: { label: "Dawn", css: "linear-gradient(120deg, #fbd3a7 0%, #f5a3b4 50%, #b9a4f0 100%)" },
  ocean: { label: "Ocean", css: "linear-gradient(120deg, #0b3d5c 0%, #1679a6 50%, #4fc3c7 100%)" },
  forest: {
    label: "Forest",
    css: "linear-gradient(120deg, #13341f 0%, #2f6b3a 50%, #8fbf5a 100%)",
  },
  ember: { label: "Ember", css: "linear-gradient(120deg, #3b0d0c 0%, #b3261e 55%, #f2a33a 100%)" },
  mint: { label: "Mint", css: "linear-gradient(120deg, #d7f5e6 0%, #9fe3c9 50%, #5cc8b1 100%)" },
  slate: { label: "Slate", css: "linear-gradient(120deg, #1d232c 0%, #39424f 50%, #6b7686 100%)" },
  paper: { label: "Paper", css: "linear-gradient(120deg, #f6f1e7 0%, #ece3d2 100%)" },
};

export const COVER_COLORS = [
  "#e5484d",
  "#f76b15",
  "#ffc53d",
  "#30a46c",
  "#12a594",
  "#0090ff",
  "#6e56cf",
  "#d6409f",
  "#8d8d8d",
];

export type Cover =
  | { kind: "image"; target: string }
  | { kind: "gradient"; name: string; css: string }
  | { kind: "color"; color: string }
  /** A web address: not fetched, so notes stay offline. */
  | { kind: "remote"; url: string };

/** Read a `banner` value; null when there's no cover or it can't be understood. */
export function parseCover(value: unknown): Cover | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  if (!v) return null;
  const g = /^gradient:([a-z0-9-]+)$/i.exec(v);
  if (g) {
    const name = g[1]!.toLowerCase();
    const known = GRADIENTS[name];
    return known ? { kind: "gradient", name, css: known.css } : null;
  }
  if (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return { kind: "color", color: v };
  if (/^https?:\/\//i.test(v)) return { kind: "remote", url: v };
  // `![[x.png]]`, `[[x.png|alias]]` or a plain path.
  const link = /^!?\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]$/.exec(v);
  if (!link && /^!?\[\[/.test(v)) return null;
  const target = (link ? link[1]! : v).trim();
  return target ? { kind: "image", target } : null;
}

/** The `banner` value for a vault image, as Obsidian Banners writes it. */
export const imageCover = (path: string) => `[[${path}]]`;
export const gradientCover = (name: string) => `gradient:${name}`;

/** `banner_y` as 0–1 (0.5 when unset). Values 1–100 are read as percentages. */
export function coverY(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return 0.5;
  const y = n > 1 ? n / 100 : n;
  return Math.min(1, Math.max(0, y));
}

/** Round a focus value for the frontmatter (two decimals is plenty). */
export const roundY = (y: number) => Math.round(Math.min(1, Math.max(0, y)) * 100) / 100;
