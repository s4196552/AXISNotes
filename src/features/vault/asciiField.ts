// The welcome screen's ASCII art (T-084, from the user's design): a field of letters and
// digits, shown only inside a softly feathered three-cusp star (the AXIS mark's shape),
// tinted warm at the top left to cool at the bottom right. Pure functions, so the drawing
// component stays small and the geometry is testable without a canvas.

/** Glyphs, weighted like the reference: mostly lowercase and digits, a few capitals. */
export const GLYPHS =
  "abcdefghijklmnopqrstuvwxyz0123456789abcdefghijklmnopqrstuvwxyz0123456789AEKRS";

/** Character cell size in CSS pixels (12.5 px monospace, 16 px rows). */
export const CELL = { width: 8.1, height: 16 } as const;
export const FONT_PX = 12.5;

/** The design frame the star is drawn in; it is scaled to cover the screen. */
export const FRAME = { width: 1920, height: 1080 } as const;

type Point = readonly [x: number, y: number];
const TIPS: readonly Point[] = [
  [960, 110],
  [1410, 880],
  [510, 880],
];
/** All three sides curve through this control point, which makes the cusps. */
const CONTROL: Point = [960, 620];
/** The star's bounding box (from the tips). */
const BOX = { x: 510, y: 110, w: 900, h: 770 } as const;
/** Width of the soft edge, in frame pixels (the reference blurs its mask by 6 px). */
const FEATHER = 12;

function quad(a: Point, c: Point, b: Point, t: number): Point {
  const u = 1 - t;
  return [
    u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
    u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
  ];
}

/** The star's outline as a closed polygon (each curve sampled). */
export const STAR: readonly Point[] = (() => {
  const steps = 32;
  const out: Point[] = [];
  for (let i = 0; i < 3; i++) {
    const a = TIPS[i]!;
    const b = TIPS[(i + 1) % 3]!;
    for (let s = 0; s < steps; s++) out.push(quad(a, CONTROL, b, s / steps));
  }
  return out;
})();

function inside(x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = STAR.length - 1; i < STAR.length; j = i++) {
    const [xi, yi] = STAR[i]!;
    const [xj, yj] = STAR[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function edgeDistance(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0, j = STAR.length - 1; i < STAR.length; j = i++) {
    const [x1, y1] = STAR[j]!;
    const [x2, y2] = STAR[i]!;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)));
  }
  return best;
}

/** Piecewise-linear interpolation through [offset, value] stops. */
function stops(t: number, s: readonly (readonly [number, number])[]): number {
  if (t <= s[0]![0]) return s[0]![1];
  for (let i = 1; i < s.length; i++) {
    const [o1, v1] = s[i]!;
    const [o0, v0] = s[i - 1]!;
    if (t <= o1) return v0 + ((v1 - v0) * (t - o0)) / (o1 - o0);
  }
  return s[s.length - 1]![1];
}

const FADE_STOPS = [
  [0, 1],
  [0.55, 0.85],
  [0.88, 0.35],
  [1, 0],
] as const;

/**
 * How visible a glyph is at frame point (x, y), 0..1: the radial fade from the star's
 * centre (58 % down its height), times a soft edge at the star's outline.
 */
export function starMask(x: number, y: number): number {
  const rx = (x - (BOX.x + BOX.w / 2)) / (0.44 * BOX.w);
  const ry = (y - (BOX.y + 0.58 * BOX.h)) / (0.44 * BOX.h);
  const fade = stops(Math.hypot(rx, ry), FADE_STOPS);
  if (fade <= 0) return 0;
  const d = edgeDistance(x, y);
  const signed = inside(x, y) ? d : -d;
  // A smooth step across the outline, like the reference's blurred mask edge.
  const e = Math.max(0, Math.min(1, signed / FEATHER + 0.5));
  return fade * e * e * (3 - 2 * e);
}

/** Position along the tint (0 = warm top left, 1 = cool bottom right). */
export function tintPosition(x: number, y: number): number {
  const x1 = BOX.x + 0.25 * BOX.w;
  const y1 = BOX.y + 0.2 * BOX.h;
  const dx = BOX.x + 0.8 * BOX.w - x1;
  const dy = BOX.y + 0.85 * BOX.h - y1;
  return Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
}

type Rgba = readonly [r: number, g: number, b: number, a: number];
type Stops = readonly (readonly [offset: number, colour: Rgba])[];
/** The reference's tint, for dark themes. */
const DARK_TINT: Stops = [
  [0, [0xd6, 0xc7, 0xb2, 0.26]],
  [0.55, [0xb5, 0xad, 0xa2, 0.22]],
  [1, [0x94, 0xa0, 0xb8, 0.28]],
];
/** The same hues, darker, so the art reads on light themes. */
const LIGHT_TINT: Stops = [
  [0, [0x7a, 0x62, 0x44, 0.24]],
  [0.55, [0x5f, 0x58, 0x4e, 0.2]],
  [1, [0x3f, 0x4f, 0x72, 0.26]],
];

/** The tint at position t (0..1) as [r, g, b, alpha]. */
export function tint(t: number, dark: boolean): Rgba {
  const s = dark ? DARK_TINT : LIGHT_TINT;
  const channel = (k: number) =>
    stops(
      t,
      s.map(([o, c]) => [o, c[k]!] as const),
    );
  return [
    Math.round(channel(0)),
    Math.round(channel(1)),
    Math.round(channel(2)),
    Math.round(channel(3) * 1000) / 1000,
  ];
}

/** Scale and offset that make the frame cover a `width` × `height` screen, centred. */
export function cover(width: number, height: number) {
  const scale = Math.max(width / FRAME.width, height / FRAME.height);
  return {
    scale,
    x: (width - FRAME.width * scale) / 2,
    y: (height - FRAME.height * scale) / 2,
  };
}

/** Whether a CSS colour (#rgb, #rrggbb or rgb()/rgba()) is light; null if unreadable. */
export function isLightColour(css: string): boolean | null {
  const c = css.trim();
  let rgb: number[] | null = null;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c);
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join("") : hex[1]!;
    rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  } else {
    const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(c);
    if (m) rgb = [m[1], m[2], m[3]].map(Number);
  }
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => v / 255) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

/** A random glyph; `random` is injectable for tests. */
export const randomGlyph = (random: () => number = Math.random) =>
  GLYPHS.charAt(Math.floor(random() * GLYPHS.length));
