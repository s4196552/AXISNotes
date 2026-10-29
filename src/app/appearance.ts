import { backend, type OsWindowEffect } from "../ipc";
import type { AxisConfig, EditorWidth, FoldArrow, WindowEffect } from "./config";

// Applies the theme and CSS snippets from the vault config to the document.
// Built-in modes set `data-theme`; user themes and snippets are injected <style> tags.

/**
 * Theme ids saved in the config. A user theme's id is its file name in .axisnotes/themes,
 * so the newer built-ins are `axis:`-prefixed (a colon can't be in a Windows file name):
 * a vault that already has its own `retro.css` keeps getting it.
 */
export const BUILTIN_THEMES = [
  "system",
  "light",
  "dark",
  "axis:darker",
  "axis:minimal",
  "axis:glass",
  "axis:translucent",
  "axis:contrast",
  "axis:retro",
] as const;
export type BuiltinTheme = (typeof BUILTIN_THEMES)[number];

/** Names, one-line descriptions and light/dark mode of the built-in themes (Settings). */
export const THEME_INFO: Record<
  BuiltinTheme,
  { label: string; note: string; mode: "light" | "dark" | "system" }
> = {
  system: { label: "Match system", note: "Light or Dark, following the OS", mode: "system" },
  light: { label: "Light", note: "The classic AXISNotes look", mode: "light" },
  dark: { label: "Dark", note: "Easy on the eyes at night", mode: "dark" },
  "axis:darker": { label: "Darker", note: "Near-black, for OLED screens", mode: "dark" },
  "axis:minimal": { label: "Minimal", note: "Monochrome ink, no distractions", mode: "light" },
  "axis:glass": { label: "Glass", note: "Frosted panels; follows light/dark", mode: "system" },
  "axis:translucent": {
    label: "Translucent",
    note: "See your desktop through it; opacity is yours",
    mode: "system",
  },
  "axis:contrast": {
    label: "High contrast",
    note: "Black, white and yellow; strong edges",
    mode: "dark",
  },
  "axis:retro": { label: "Retro", note: "Cream paper, ink lines, typewriter type", mode: "light" },
};

export function isBuiltinTheme(theme: string): theme is BuiltinTheme {
  return (BUILTIN_THEMES as readonly string[]).includes(theme);
}

/** The `data-theme` / `data-theme-preview` value the CSS uses for a built-in theme. */
export function themeCssName(theme: BuiltinTheme): string {
  return theme.replace(/^axis:/, "");
}
const THEME_STYLE_ID = "axis-user-theme";
const SNIPPET_ATTR = "data-axis-snippet";

function styleTag(id: string): HTMLStyleElement {
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  return el;
}

/** Read `.axisnotes/<dir>/<name>.css`; empty string if missing. */
async function readCss(dir: "themes" | "snippets", name: string): Promise<string> {
  try {
    return (await backend.readFile(`.axisnotes/${dir}/${name}.css`)).content;
  } catch {
    return "";
  }
}

const THEME_CHANGED = "axisnotes:theme-changed";

/**
 * Call `listener` after the theme changes: a new theme or snippets applied, or the OS
 * switching light/dark. For views that read theme colors once (the graph). Returns an
 * unsubscribe function.
 */
export function onThemeChange(listener: () => void): () => void {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_CHANGED, listener);
  media?.addEventListener?.("change", listener);
  return () => {
    window.removeEventListener(THEME_CHANGED, listener);
    media?.removeEventListener?.("change", listener);
  };
}

export async function applyAppearance(config: Pick<AxisConfig, "theme" | "snippets">) {
  const root = document.documentElement;
  const { theme } = config;
  const builtin = isBuiltinTheme(theme);
  if (builtin && theme !== "system") root.dataset.theme = themeCssName(theme);
  else delete root.dataset.theme;

  const themeCss = builtin ? "" : await readCss("themes", config.theme);
  styleTag(THEME_STYLE_ID).textContent = themeCss;

  const wanted = new Set(config.snippets);
  for (const el of document.querySelectorAll<HTMLStyleElement>(`style[${SNIPPET_ATTR}]`)) {
    if (!wanted.has(el.getAttribute(SNIPPET_ATTR)!)) el.remove();
  }
  for (const name of config.snippets) {
    const css = await readCss("snippets", name);
    let el = document.querySelector<HTMLStyleElement>(
      `style[${SNIPPET_ATTR}="${CSS.escape(name)}"]`,
    );
    if (!el) {
      el = document.createElement("style");
      el.setAttribute(SNIPPET_ATTR, name);
      document.head.appendChild(el);
    }
    el.textContent = css;
  }
  window.dispatchEvent(new Event(THEME_CHANGED));
}

export const NOTE_FONT_SIZES = { min: 11, max: 32 };
export const EDITOR_WIDTHS: Record<EditorWidth, { label: string; css: string }> = {
  narrow: { label: "Narrow", css: "640px" },
  medium: { label: "Medium", css: "760px" },
  wide: { label: "Wide", css: "960px" },
  full: { label: "Full width", css: "none" },
};
/** An SVG icon (24×24, black) as a CSS `url()`, for use as a mask. */
const svgUrl = (body: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  )}")`;

/**
 * The fold arrow styles: the icon of a closed heading or toggle, the icon once it's open
 * (if it changes), and how far the icon turns when it opens.
 */
export const FOLD_ARROWS: Record<
  FoldArrow,
  { label: string; closed: string; open?: string; turn: string }
> = {
  triangle: {
    label: "Triangle",
    closed: svgUrl('<path d="M8 5l10 7-10 7z" fill="black" stroke-width="1.5"/>'),
    turn: "90deg",
  },
  chevron: { label: "Chevron", closed: svgUrl('<path d="m9 6 6 6-6 6"/>'), turn: "90deg" },
  arrow: { label: "Arrow", closed: svgUrl('<path d="M5 12h14M13 6l6 6-6 6"/>'), turn: "90deg" },
  circle: {
    label: "Circled chevron",
    closed: svgUrl('<circle cx="12" cy="12" r="9.5" stroke-width="2"/><path d="m10.5 8 4 4-4 4"/>'),
    turn: "90deg",
  },
  plus: {
    label: "Plus and minus",
    closed: svgUrl('<path d="M5 12h14M12 5v14"/>'),
    open: svgUrl('<path d="M5 12h14"/>'),
    turn: "0deg",
  },
  square: {
    label: "Boxed plus and minus",
    closed: svgUrl(
      '<rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-width="2"/><path d="M8 12h8M12 8v8"/>',
    ),
    open: svgUrl(
      '<rect x="3.5" y="3.5" width="17" height="17" rx="3" stroke-width="2"/><path d="M8 12h8"/>',
    ),
    turn: "0deg",
  },
};

/** The CSS variables that draw a fold arrow style (`.cm-toggle-arrow` in editor.css). */
export function foldArrowVars(style: FoldArrow): Record<string, string> {
  const a = FOLD_ARROWS[style] ?? FOLD_ARROWS.triangle;
  return { "--fold-closed": a.closed, "--fold-open": a.open ?? a.closed, "--fold-turn": a.turn };
}

const UI_FONT_FALLBACK = '"Segoe UI", system-ui, -apple-system, sans-serif';

/** A CSS font stack with `family` first; its quotes and backslashes are dropped. */
export function fontStack(family: string, fallback: string): string {
  const clean = family.replace(/["\\]/g, "").trim();
  return clean ? `"${clean}", ${fallback}` : fallback;
}

/** Note text size, fonts, editor width and fold arrows, as CSS variables on the document. */
export function applyTypography(
  a: Pick<
    AxisConfig["appearance"],
    "noteFontSize" | "noteFont" | "uiFont" | "editorWidth" | "foldArrow"
  >,
) {
  const style = document.documentElement.style;
  const size = Math.min(
    NOTE_FONT_SIZES.max,
    Math.max(NOTE_FONT_SIZES.min, Math.round(a.noteFontSize) || 15),
  );
  style.setProperty("--note-font-size", `${size}px`);
  style.setProperty("--editor-width", (EDITOR_WIDTHS[a.editorWidth] ?? EDITOR_WIDTHS.medium).css);
  for (const [name, value] of Object.entries(foldArrowVars(a.foldArrow)))
    style.setProperty(name, value);
  if (a.uiFont) style.setProperty("--font-ui", fontStack(a.uiFont, UI_FONT_FALLBACK));
  else style.removeProperty("--font-ui");
  if (a.noteFont) style.setProperty("--font-note", fontStack(a.noteFont, "var(--font-ui)"));
  else style.removeProperty("--font-note");
}

export const WINDOW_OPACITY = { min: 20, max: 100, step: 5 };
const NO_TRANSPARENCY = "(prefers-reduced-transparency: reduce)";

/**
 * What Windows can draw behind the see-through window, from most to least see-through.
 * Everything but Clear is a Windows material (`os`), and needs Windows' "Transparency
 * effects": with them off, Windows paints each one as a solid fill.
 */
export const WINDOW_EFFECTS: readonly {
  id: WindowEffect;
  label: string;
  note: string;
  os: OsWindowEffect | null;
}[] = [
  { id: "clear", label: "Clear", note: "Your desktop shows through as it is.", os: null },
  {
    id: "blur",
    label: "Blur",
    note: "A soft blur of what's behind. On newer Windows 11 it can lag while the window moves.",
    os: "blur",
  },
  {
    id: "frosted",
    label: "Frosted",
    note: "Blurred and lightly grained, like frosted glass (Windows acrylic).",
    os: "acrylic",
  },
  {
    id: "liquid",
    label: "Liquid glass",
    note: "Like Apple's Liquid Glass: floating panes with bright edges, and menus that bend what's under them.",
    os: "acrylic",
  },
  {
    id: "mica",
    label: "Mica",
    note: "Only a soft tint of your wallpaper, like Windows 11's own apps. Windows 11 only.",
    os: "mica",
  },
  {
    id: "micaAlt",
    label: "Mica Alt",
    note: "A deeper wallpaper tint, as in Windows 11's tabbed apps. Windows 11 only.",
    os: "tabbed",
  },
];

/** The effect saved in the config; anything unknown gets the default, Frosted. */
export function windowEffectInfo(id: string) {
  return WINDOW_EFFECTS.find((e) => e.id === id) ?? WINDOW_EFFECTS.find((e) => e.id === "frosted")!;
}

const LENS_ID = "axis-liquid-lens";

/** A displacement map stretched over the glass: `channel` ramps across `axis` near the edges. */
function lensMap(channel: "#f00" | "#0f0", axis: "x2" | "y2"): string {
  const half = channel === "#f00" ? "#800000" : "#008000";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">` +
    `<linearGradient id="g" ${axis}="1"><stop offset="0" stop-color="${channel}"/>` +
    `<stop offset=".16" stop-color="${half}"/><stop offset=".84" stop-color="${half}"/>` +
    `<stop offset="1" stop-color="#000"/></linearGradient>` +
    `<rect width="100" height="100" fill="url(#g)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/**
 * The SVG filter Liquid glass menus and dialogs refract their backdrop through
 * (`backdrop-filter: url(#axis-liquid-lens)`): what's under the middle shows as it is, and
 * near the edges it bends inwards, like the rim of a lens. Sized to each surface.
 */
function ensureLiquidLens() {
  if (document.getElementById(LENS_ID)) return;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  svg.style.position = "absolute";
  svg.innerHTML =
    `<filter id="${LENS_ID}" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">` +
    `<feImage href="${lensMap("#f00", "x2")}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="dx"/>` +
    `<feImage href="${lensMap("#0f0", "y2")}" x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="dy"/>` +
    `<feComposite in="dx" in2="dy" operator="arithmetic" k2="1" k3="1" result="map"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="map" scale="0.06" xChannelSelector="R" yChannelSelector="G"/>` +
    `</filter>`;
  document.body.appendChild(svg);
}

/** True when Windows' "Transparency effects" are off: only Clear shows the desktop then. */
export function transparencyEffectsOff(): boolean {
  return window.matchMedia?.(NO_TRANSPARENCY).matches ?? false;
}

/** Call `listener` when Windows' transparency effects are turned on or off. */
export function onTransparencyEffectsChange(listener: () => void): () => void {
  const media = window.matchMedia?.(NO_TRANSPARENCY);
  media?.addEventListener?.("change", listener);
  return () => media?.removeEventListener?.("change", listener);
}

// What the window was last told, to skip repeat calls. Windows start with no effect, so
// nothing is sent until Translucent wants one. `undefined`: unknown (a call failed).
let sentEffect: OsWindowEffect | null | undefined = null;
let effectQueue: Promise<void> = Promise.resolve();

/**
 * The Translucent theme's see-through window: `--tl-alpha` is the opacity its backdrop
 * uses, and Windows draws the chosen effect behind it. Elsewhere, or where the window
 * can't be see-through, the opacity is 1 and there's no effect. An effect is also left
 * off while Windows' transparency effects are, since it'd be a solid fill: the window
 * looks Clear until they're turned on.
 */
export async function applyTranslucency(
  theme: string,
  a: Pick<AxisConfig["appearance"], "windowOpacity" | "windowEffect">,
) {
  const on = theme === "axis:translucent" && backend.canBeTranslucent();
  const pct = Math.min(
    WINDOW_OPACITY.max,
    Math.max(WINDOW_OPACITY.min, Math.round(a.windowOpacity) || WINDOW_OPACITY.max),
  );
  const alpha = on ? pct / 100 : 1;
  const root = document.documentElement;
  root.style.setProperty("--tl-alpha", String(alpha));
  // Liquid glass is also a look inside the window, so it shows even where it can't be
  // see-through (themes.css).
  if (theme === "axis:translucent" && windowEffectInfo(a.windowEffect).id === "liquid") {
    ensureLiquidLens();
    root.dataset.glass = "liquid";
  } else delete root.dataset.glass;
  const effect =
    on && alpha < 1 && !transparencyEffectsOff() ? windowEffectInfo(a.windowEffect).os : null;
  if (effect === sentEffect) return;
  sentEffect = effect;
  // One change at a time, in order: a slider dragged across the stops sends several, and
  // each clears the window before applying its own.
  effectQueue = effectQueue.then(async () => {
    try {
      await backend.setWindowEffect(effect);
    } catch (e) {
      sentEffect = undefined;
      console.warn("window effect failed", e);
    }
  });
  await effectQueue;
}

/** The effective light/dark mode, for "toggle theme". */
export function effectiveMode(theme: string): "light" | "dark" {
  const mode = isBuiltinTheme(theme) ? THEME_INFO[theme].mode : "system";
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
