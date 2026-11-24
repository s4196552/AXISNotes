import {
  type AppColors,
  type AxisConfig,
  DEFAULT_CONFIG,
  type HeadingColors,
  isHexColor,
  NO_APP_COLORS,
  REMOVED_THEMES,
  type Style,
  type TextColor,
  type TextColorKind,
  type TextColors,
} from "./config";
import {
  HEADING_COLORS,
  LETTER_SPACING,
  LINE_HEIGHT,
  NOTE_FONT_SIZES,
  TEXT_COLOR_KINDS,
} from "./appearance";
import { APP_COLOR_PRESETS, normalHex } from "./appColors";

// Styles (Settings → Appearance → Styles, T-277): a whole look in one click. A Style is a
// theme plus the fonts, typography, heading colors, text colors and app colors that go
// with it. Applying one sets all of them (what it leaves out goes back to the default), so
// the same Style always gives the same look; nothing else in the config changes.

/** The appearance settings a Style sets. */
export const STYLE_KEYS = [
  "noteFont",
  "uiFont",
  "noteFontSize",
  "letterSpacing",
  "lineHeight",
  "headingColors",
  "textColors",
  "appColors",
] as const;

type StyleKey = (typeof STYLE_KEYS)[number];
export type StyleLook = Pick<AxisConfig["appearance"], StyleKey>;

export type { Style } from "./config";

// Read when used, not at load: config.ts imports this module to clean saved Styles.
const defaultLook = (): StyleLook =>
  Object.fromEntries(STYLE_KEYS.map((k) => [k, DEFAULT_CONFIG.appearance[k]])) as StyleLook;

/** The Style's look in full: what it leaves out is the default. */
export function fullLook(style: Style): StyleLook {
  const l = style.look;
  const d = defaultLook();
  return {
    ...d,
    ...l,
    textColors: { ...d.textColors, ...l.textColors },
    appColors: { ...NO_APP_COLORS, ...l.appColors },
  };
}

/** The config with `style` applied: its theme and look, and nothing else changed. */
export function applyStyle(config: AxisConfig, style: Style): AxisConfig {
  return {
    ...config,
    theme: style.theme,
    appearance: { ...config.appearance, ...fullLook(style) },
  };
}

/** The current look as a Style called `name`. */
export function captureStyle(config: AxisConfig, name: string): Style {
  const a = config.appearance;
  return {
    name: name.trim(),
    theme: config.theme,
    look: Object.fromEntries(STYLE_KEYS.map((k) => [k, structuredClone(a[k])])) as StyleLook,
  };
}

const sameColor = (a: string, b: string) =>
  a === b || (normalHex(a) !== "" && normalHex(a) === normalHex(b));

function sameTextColor(a: TextColor, b: TextColor): boolean {
  if (a.on !== b.on) return false;
  return !a.on || (sameColor(a.light, b.light) && sameColor(a.dark, b.dark));
}

/** Whether the current settings are exactly `style`'s look. */
export function isActiveStyle(config: AxisConfig, style: Style): boolean {
  if (config.theme !== style.theme) return false;
  const a = config.appearance;
  const l = fullLook(style);
  return (
    a.noteFont === l.noteFont &&
    a.uiFont === l.uiFont &&
    a.noteFontSize === l.noteFontSize &&
    a.letterSpacing === l.letterSpacing &&
    a.lineHeight === l.lineHeight &&
    a.headingColors === l.headingColors &&
    TEXT_COLOR_KINDS.every((k) =>
      sameTextColor(a.textColors[k.id] ?? NO_TEXT, l.textColors[k.id] ?? NO_TEXT),
    ) &&
    (Object.keys(NO_APP_COLORS) as (keyof AppColors)[]).every((k) =>
      sameColor(a.appColors[k], l.appColors[k]),
    )
  );
}

/** The first of `styles` that the current settings match exactly, if any. */
export const activeStyle = (config: AxisConfig, styles: readonly Style[]) =>
  styles.find((s) => isActiveStyle(config, s));

const NO_TEXT: TextColor = { on: false, light: "", dark: "" };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const inRange = (v: unknown, r: { min: number; max: number }) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(r.max, Math.max(r.min, v)) : undefined;

const hexOrEmpty = (v: unknown) => (isHexColor(v) ? v : "");

/**
 * A saved Style made safe (the config is hand-editable), or null if it has no name or
 * theme. Numbers are clamped, only plain hex colours are kept, unknown heading presets
 * become the theme's, and a removed built-in theme becomes its kept counterpart.
 */
export function sanitizeStyle(raw: unknown): Style | null {
  if (!isRecord(raw)) return null;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const theme = typeof raw.theme === "string" ? raw.theme.trim() : "";
  if (!name || !theme) return null;
  const l = isRecord(raw.look) ? raw.look : {};
  const look: Partial<StyleLook> = {};
  if (typeof l.noteFont === "string") look.noteFont = l.noteFont;
  if (typeof l.uiFont === "string") look.uiFont = l.uiFont;
  const size = inRange(l.noteFontSize, NOTE_FONT_SIZES);
  if (size !== undefined) look.noteFontSize = Math.round(size);
  const spacing = inRange(l.letterSpacing, LETTER_SPACING);
  if (spacing !== undefined) look.letterSpacing = spacing;
  const line = inRange(l.lineHeight, LINE_HEIGHT);
  if (line !== undefined) look.lineHeight = line;
  if (typeof l.headingColors === "string")
    look.headingColors = (
      l.headingColors in HEADING_COLORS ? l.headingColors : "theme"
    ) as HeadingColors;
  if (isRecord(l.textColors)) {
    const t = l.textColors;
    look.textColors = Object.fromEntries(
      TEXT_COLOR_KINDS.map((k) => {
        const c = isRecord(t[k.id]) ? (t[k.id] as Record<string, unknown>) : {};
        return [
          k.id,
          { on: c.on === true, light: hexOrEmpty(c.light), dark: hexOrEmpty(c.dark) },
        ] as [TextColorKind, TextColor];
      }),
    ) as TextColors;
  }
  if (isRecord(l.appColors)) {
    const c = l.appColors;
    look.appColors = {
      sidebarBg: hexOrEmpty(c.sidebarBg),
      sidebarFg: hexOrEmpty(c.sidebarFg),
      mainBg: hexOrEmpty(c.mainBg),
      mainFg: hexOrEmpty(c.mainFg),
    };
  }
  return { name, theme: REMOVED_THEMES.get(theme) ?? theme, look };
}

/** The saved Styles that are usable, one per name (the first wins). */
export function sanitizeStyles(raw: unknown): Style[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Style[] = [];
  for (const r of raw) {
    const s = sanitizeStyle(r);
    if (!s || seen.has(s.name.toLowerCase())) continue;
    seen.add(s.name.toLowerCase());
    out.push(s);
  }
  return out;
}

const colors = (id: string): AppColors => {
  const p = APP_COLOR_PRESETS.find((x) => x.id === id);
  if (!p) throw new Error(`No app color preset ${id}`);
  return { ...p.colors };
};

/** A Style that comes with AXISNotes. `note` says what it's like, for its card. */
export interface BuiltinStyle extends Style {
  id: string;
  note: string;
}

/**
 * The Styles that come with AXISNotes. Fonts are ones Windows includes; where one is
 * missing, the text falls back to the default font.
 */
export const BUILTIN_STYLES: readonly BuiltinStyle[] = [
  {
    id: "default",
    name: "AXIS Default",
    note: "The standard look, following your system's light or dark mode",
    theme: "system",
    look: {},
  },
  {
    id: "paper",
    name: "Paper & Ink",
    note: "Cream pages and a book serif",
    theme: "light",
    look: {
      noteFont: "Georgia",
      noteFontSize: 16,
      lineHeight: 1.7,
      headingColors: "amber",
      appColors: colors("cream"),
    },
  },
  {
    id: "midnight",
    name: "Midnight",
    note: "Indigo night with ocean-blue headings",
    theme: "dark",
    look: { headingColors: "ocean", appColors: colors("indigo") },
  },
  {
    id: "teal",
    name: "Deep Teal",
    note: "Low-glare teal with calm green headings",
    theme: "dark",
    look: {
      noteFont: "Cambria",
      lineHeight: 1.6,
      headingColors: "forest",
      appColors: colors("teal"),
    },
  },
  {
    id: "coffee",
    name: "Coffeehouse",
    note: "Warm browns and a soft serif",
    theme: "dark",
    look: {
      noteFont: "Cambria",
      noteFontSize: 16,
      lineHeight: 1.65,
      headingColors: "amber",
      appColors: colors("coffee"),
    },
  },
  {
    id: "plum",
    name: "Plum",
    note: "Deep purple with berry headings",
    theme: "dark",
    look: { headingColors: "berry", appColors: colors("plum") },
  },
  {
    id: "contrast",
    name: "High Contrast",
    note: "White on black, larger text and wider lines",
    theme: "axis:hc-dark",
    look: { noteFontSize: 18, lineHeight: 1.7, letterSpacing: 0.02 },
  },
  {
    id: "focus",
    name: "Focus",
    note: "Greyscale paper, roomy lines, no distractions",
    theme: "axis:eink",
    look: { noteFont: "Georgia", noteFontSize: 17, lineHeight: 1.8 },
  },
  {
    id: "studio",
    name: "Studio",
    note: "Clean paper with rainbow headings and a modern sans",
    theme: "light",
    look: {
      noteFont: "Calibri",
      uiFont: "Segoe UI",
      noteFontSize: 16,
      headingColors: "rainbow",
      appColors: colors("paper"),
    },
  },
];
