/** Crop removes percentages from the four edges of the original image. */
export type ImageCrop = [left: number, top: number, right: number, bottom: number];
export interface ImageLayout {
  width: number | null;
  height: number | null;
  crop: ImageCrop;
}
export const DEFAULT_IMAGE_LAYOUT: ImageLayout = { width: null, height: null, crop: [0, 0, 0, 0] };
const META = /\s*<!-- axis-image (\{[^\n]*\}) -->\s*$/;
const SIZE = /\|\s*(\d{1,4})(?:x(\d{1,4}))?\s*$/;
const dimension = (n: unknown): n is number =>
  Number.isInteger(n) && Number(n) > 0 && Number(n) <= 9999;
export const validCrop = (crop: unknown): crop is ImageCrop =>
  Array.isArray(crop) &&
  crop.length === 4 &&
  crop.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 100) &&
  crop[0] + crop[2] < 100 &&
  crop[1] + crop[3] < 100;

/** Obsidian dimensions plus a portable, optional AXIS comment for reversible crops. */
export function readImageLayout(line: string): { embed: string; layout: ImageLayout } {
  const match = META.exec(line);
  const embed = match ? line.slice(0, match.index) : line;
  const label =
    /^\s*!\[\[([^\n]*)\]\]\s*$/.exec(embed)?.[1] ?? /^\s*!\[([^\]\n]*)\]\(/.exec(embed)?.[1] ?? "";
  const size = SIZE.exec(label);
  const layout: ImageLayout = {
    width: size && dimension(Number(size[1])) ? Number(size[1]) : null,
    height: size?.[2] && dimension(Number(size[2])) ? Number(size[2]) : null,
    crop: [0, 0, 0, 0],
  };
  if (match) {
    try {
      const meta = JSON.parse(match[1]!) as Record<string, unknown> | null;
      if (meta && validCrop(meta.crop)) layout.crop = meta.crop;
      if (meta && (dimension(meta.width) || meta.width === null)) layout.width = meta.width;
      if (meta && (dimension(meta.height) || meta.height === null)) layout.height = meta.height;
    } catch {
      /* Malformed metadata is ignored; it is never executable markup. */
    }
  }
  return { embed, layout };
}

export function writeImageLayout(line: string, layout: ImageLayout): string {
  if (
    (layout.width !== null && !dimension(layout.width)) ||
    (layout.height !== null && !dimension(layout.height)) ||
    !validCrop(layout.crop)
  )
    throw new Error("Choose dimensions from 1 to 9999 and leave some image visible.");
  const { embed } = readImageLayout(line);
  const meta: { width?: number | null; height?: number | null; crop?: ImageCrop } = {};
  const size = layout.width ? `|${layout.width}${layout.height ? `x${layout.height}` : ""}` : "";
  let next = embed;
  const wiki = /^(\s*!\[\[)([^\n]*)(\]\]\s*)$/.exec(embed);
  if (wiki) {
    const inner = wiki[2]!;
    const base = inner.replace(SIZE, "");
    // Preserve a nonnumeric alias instead of discarding user-authored text.
    if (base.includes("|")) {
      meta.width = layout.width;
      meta.height = layout.height;
    } else next = wiki[1] + base + size + wiki[3];
  } else
    next = embed.replace(
      /^(\s*!\[)([^\]\n]*)(\]\()/,
      (_match, before: string, alt: string, after: string) =>
        before + alt.replace(SIZE, "") + size + after,
    );
  if (layout.height && !layout.width) meta.height = layout.height;
  if (layout.crop.some((n) => n !== 0)) meta.crop = layout.crop;
  return (
    next.trimEnd() +
    (Object.keys(meta).length ? ` <!-- axis-image ${JSON.stringify(meta)} -->` : "")
  );
}
