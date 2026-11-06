import type { AppColors, HeadingColors } from "./config";

// App colours (Settings → Appearance): the user's own background and text colours for the
// sidebars (both side panels and the status bar) and the main note area, on top of the
// theme. Each surface gets the theme's colour tokens rebuilt from its two colours, scoped
// to its own elements, so a light sidebar beside a dark note area keeps readable text,
// borders and hovers in both. Unset colours keep the theme's.

/** A preset: sidebar background and text, then main background and text. */
export interface AppColorPreset {
  id: string;
  label: string;
  colors: AppColors;
}

const preset = (
  id: string,
  label: string,
  sidebarBg: string,
  sidebarFg: string,
  mainBg: string,
  mainFg: string,
): AppColorPreset => ({ id, label, colors: { sidebarBg, sidebarFg, mainBg, mainFg } });

/** Twelve two-surface presets. Every text colour meets 4.5:1 on its background. */
export const APP_COLOR_PRESETS: readonly AppColorPreset[] = [
  preset("teal", "Deep teal", "#00212b", "#93a1a1", "#002b36", "#839496"),
  preset("paper", "Paper", "#f3f3f3", "#383838", "#ffffff", "#1f1f1f"),
  preset("cream", "Cream", "#eee8d5", "#52676e", "#fdf6e3", "#586e75"),
  preset("mist", "Mist", "#d6d8df", "#343b58", "#e6e7ed", "#343b58"),
  preset("navy", "Midnight navy", "#060621", "#6688cc", "#000c18", "#7799dd"),
  preset("charcoal", "Charcoal", "#252526", "#cccccc", "#1e1e1e", "#d4d4d4"),
  preset("coffee", "Coffee", "#362712", "#d3af86", "#221a0f", "#d3af86"),
  preset("oxblood", "Oxblood", "#330000", "#f0d0d0", "#390000", "#f8f8f8"),
  preset("plum", "Plum", "#241b2f", "#e0dfe8", "#262335", "#ffffff"),
  preset("indigo", "Indigo night", "#16161e", "#a9b1d6", "#1a1b26", "#a9b1d6"),
  preset("storm", "Storm", "#1f2335", "#a9b1d6", "#24283b", "#c0caf5"),
  preset("sea", "Deep sea", "#001c40", "#d8e2f0", "#002451", "#ffffff"),
];

/** WCAG's minimum contrast for body text. */
export const MIN_CONTRAST = 4.5;

const HEX = /^#([0-9a-f]{6})$/i;

/** A `#rrggbb` colour in lower case, or "" if `value` isn't one. */
export function normalHex(value: string): string {
  const v = value.trim();
  if (HEX.test(v)) return v.toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  return short
    ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase()
    : "";
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two `#rrggbb` colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** True for a background that wants dark text. */
export function isLight(bg: string): boolean {
  return contrast(bg, "#1a1a1a") >= contrast(bg, "#f2f2f2");
}

/** Text for a background with no text colour chosen: dark on light, light on dark. */
export function autoText(bg: string): string {
  return isLight(bg) ? "#1a1a1a" : "#f2f2f2";
}

/** `a` blended `t` (0–1) of the way towards `b`. */
function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return `#${x
    .map((c, i) =>
      Math.round(c + (y[i]! - c) * t)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** Contrast muted text keeps with its background (WCAG's level for large text). */
export const MUTED_CONTRAST = 3.5;

/**
 * Muted text: the text faded up to a third of the way into the background, but no further
 * than keeps it at `MUTED_CONTRAST` (text already fainter than that isn't faded).
 */
export function mutedText(fg: string, bg: string): string {
  for (let t = 0.35; t > 0; t -= 0.05) {
    const m = mix(fg, bg, t);
    if (contrast(m, bg) >= MUTED_CONTRAST) return m;
  }
  return fg;
}

/** The theme tokens for one surface, from its background and text. */
function surface(bg: string, fg: string): Record<string, string> {
  return {
    "color-scheme": isLight(bg) ? "light" : "dark",
    "--fg": fg,
    "--heading": fg,
    "--fg-muted": mutedText(fg, bg),
    "--border": mix(bg, fg, 0.16),
    "--bg-hover": mix(bg, fg, 0.08),
    "--bg-active": mix(bg, fg, 0.14),
    "--bg-elevated": isLight(bg) ? mix(bg, "#ffffff", 0.6) : mix(bg, fg, 0.06),
    "--code-bg": mix(bg, fg, 0.06),
    "--selection": `color-mix(in srgb, var(--accent) 32%, ${bg})`,
  };
}

/** Text alone on the theme's background: only the text tokens change. */
function textOnly(fg: string): Record<string, string> {
  return {
    "--fg": fg,
    "--heading": fg,
    "--fg-muted": `color-mix(in srgb, ${fg} 65%, var(--bg))`,
  };
}

/** A surface's tokens, or null when neither of its colours is set. */
function surfaceTokens(
  rawBg: string,
  rawFg: string,
  ownBg: "--bg" | "--bg-sidebar",
): Record<string, string> | null {
  const bg = normalHex(rawBg);
  const fg = normalHex(rawFg);
  if (!bg && !fg) return null;
  if (!bg) return textOnly(fg);
  const text = fg || autoText(bg);
  const other = ownBg === "--bg" ? "--bg-sidebar" : "--bg";
  return { ...surface(bg, text), [ownBg]: bg, [other]: mix(bg, text, 0.05) };
}

const rule = (selector: string, vars: Record<string, string>) =>
  `${selector} {\n${Object.entries(vars)
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n")}\n}`;

/**
 * Headings 1–6 follow `--heading` (theme.css), but resolved where they're declared, on
 * :root. A surface with its own text re-points them at its own `--heading`, unless a
 * heading colour preset set them (Settings → Heading colours), which then still applies.
 */
const OWN_HEADINGS = Object.fromEntries(
  [1, 2, 3, 4, 5, 6].map((n) => [`--heading-${n}`, "var(--heading)"]),
);

/**
 * The stylesheet for the chosen colours ("" when none are set, or for Translucent, whose
 * window shows the desktop). The repeated `:root` outranks themes' `:root[data-theme]`.
 */
export function appColorsCss(
  theme: string,
  c: AppColors,
  headingColors: HeadingColors = "theme",
): string {
  if (theme === "axis:translucent") return "";
  const headings = headingColors === "theme" ? OWN_HEADINGS : {};
  const tokens = (bg: string, fg: string, own: "--bg" | "--bg-sidebar") => {
    const t = surfaceTokens(bg, fg, own);
    return t && { ...t, ...headings };
  };
  const main = tokens(c.mainBg, c.mainFg, "--bg");
  const side = tokens(c.sidebarBg, c.sidebarFg, "--bg-sidebar");
  const css: string[] = [];
  // Behind the panes: the sidebars' colour, else the main area's.
  const backdrop = normalHex(c.sidebarBg) || normalHex(c.mainBg);
  if (backdrop) css.push(rule(":root:root:root", { "--app-backdrop": backdrop }));
  // `color` is inherited as a resolved value, so each surface sets it from its own --fg.
  if (main)
    css.push(rule(":root:root .content", { ...main, background: "var(--bg)", color: "var(--fg)" }));
  if (side) css.push(rule(":root:root :is(.sidebar, .statusbar)", { ...side, color: "var(--fg)" }));
  return css.join("\n");
}

const STYLE_ID = "axis-app-colors";

/** Apply the chosen colours (a <style> after the theme's, replaced on every change). */
export function applyAppColors(theme: string, c: AppColors, headingColors?: HeadingColors) {
  const css = appColorsCss(theme, c, headingColors);
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("style");
    el.id = STYLE_ID;
  }
  // Last in <head>, so it follows the user theme and snippets.
  document.head.appendChild(el);
  el.textContent = css;
}

/** The preset whose four colours are exactly `c`, if any. */
export function matchingPreset(c: AppColors): AppColorPreset | undefined {
  const same = (a: string, b: string) => normalHex(a) === normalHex(b);
  return APP_COLOR_PRESETS.find(
    (p) =>
      same(p.colors.sidebarBg, c.sidebarBg) &&
      same(p.colors.sidebarFg, c.sidebarFg) &&
      same(p.colors.mainBg, c.mainBg) &&
      same(p.colors.mainFg, c.mainFg),
  );
}
