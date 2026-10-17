// The welcome screen's ASCII backdrop: a few soft blobs drift slowly, and each
// character cell shows a denser glyph where the field is brighter. Pure functions,
// so the drawing component stays small and the maths is testable without a canvas.

/** Glyphs from empty to dense. Index 0 is a space, so dark cells draw nothing. */
export const ASCII_RAMP = " .,:;i1tfLCG08@";

/** Character cell size in CSS pixels. */
export const CELL = { width: 7, height: 13 } as const;

/** Blob centre (x, y) and radius, as fractions of the screen. */
type Blob = readonly [x: number, y: number, r: number];

function blobs(t: number): Blob[] {
  return [
    [0.3 + 0.04 * Math.sin(t * 0.21), 0.3 + 0.03 * Math.cos(t * 0.17), 0.24],
    [0.8 + 0.03 * Math.cos(t * 0.19), 0.62 + 0.04 * Math.sin(t * 0.23), 0.2],
    [0.08 + 0.02 * Math.sin(t * 0.13), 0.9, 0.22],
    [0.95, 0.08 + 0.03 * Math.cos(t * 0.11), 0.14],
  ];
}

/**
 * Brightness 0..1 at (x, y), both 0..1 across the screen, at time t seconds.
 * `aspect` is width / height, so blobs stay round on wide screens.
 */
export function brightness(x: number, y: number, t: number, aspect = 1): number {
  let v = 0;
  for (const [bx, by, r] of blobs(t)) {
    const d = Math.hypot((x - bx) * aspect, y - by) / r;
    v += Math.max(0, 1 - d * d);
  }
  // A slow ripple gives the blobs texture instead of smooth gradients.
  v *= 0.78 + 0.22 * Math.sin(x * 38 + t * 0.6) * Math.cos(y * 27 - t * 0.4);
  return Math.min(1, Math.max(0, v));
}

/** The glyph for a brightness value. */
export function glyphFor(v: number): string {
  const i = Math.round(Math.min(1, Math.max(0, v)) * (ASCII_RAMP.length - 1));
  return ASCII_RAMP.charAt(i);
}
