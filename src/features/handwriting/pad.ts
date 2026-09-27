import type { Image } from "./recognize";

// Pen strokes captured by the handwriting pad, and rendering them to an image for the
// vision model: black ink on white, cropped to the ink with a margin.

export interface Point {
  x: number;
  y: number;
  /** Pen pressure 0..1 (0.5 for mice). */
  p: number;
}
export type Stroke = Point[];

export const strokeWidth = (p: number) => 1.5 + p * 3;

/** Draw strokes on a 2D context (already transformed to CSS pixels). */
export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[], color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const s of strokes) {
    if (s.length === 1) {
      ctx.beginPath();
      ctx.arc(s[0]!.x, s[0]!.y, strokeWidth(s[0]!.p) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < s.length; i++) {
      const a = s[i - 1]!;
      const b = s[i]!;
      ctx.lineWidth = strokeWidth((a.p + b.p) / 2);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
}

export function bounds(strokes: Stroke[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const s of strokes)
    for (const pt of s) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  return strokes.some((s) => s.length) ? { minX, minY, maxX, maxY } : null;
}

/** Render the strokes to a PNG (null if there's no ink or no canvas support). */
export function strokesToImage(strokes: Stroke[], maxSize = 1600): Image | null {
  const b = bounds(strokes);
  if (!b) return null;
  const margin = 16;
  const w = b.maxX - b.minX + margin * 2;
  const h = b.maxY - b.minY + margin * 2;
  // Twice the drawn size for crisp ink, capped so large pages stay cheap.
  const scale = Math.min(2, maxSize / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, (margin - b.minX) * scale, (margin - b.minY) * scale);
  drawStrokes(ctx, strokes, "#111111");
  const url = canvas.toDataURL("image/png");
  return { mime: "image/png", data: url.slice(url.indexOf(",") + 1) };
}

/** Base64 of a Blob (for images exported by the canvas). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
