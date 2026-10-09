import { backend } from "../ipc";
import type { AxisConfig, EditorWidth } from "./config";

// Applies the theme and CSS snippets from the vault config to the document.
// Built-in modes set `data-theme`; user themes and snippets are injected <style> tags.

export const BUILTIN_THEMES = [
  "system",
  "light",
  "dark",
  "darker",
  "minimal",
  "glass",
  "contrast",
  "retro",
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
  darker: { label: "Darker", note: "Near-black, for OLED screens", mode: "dark" },
  minimal: { label: "Minimal", note: "Monochrome ink, no distractions", mode: "light" },
  glass: { label: "Glass", note: "Frosted panels; follows light/dark", mode: "system" },
  contrast: { label: "High contrast", note: "Black, white and yellow; strong edges", mode: "dark" },
  retro: { label: "Retro", note: "Cream paper, ink lines, typewriter type", mode: "light" },
};

function isBuiltin(theme: string): theme is BuiltinTheme {
  return (BUILTIN_THEMES as readonly string[]).includes(theme);
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
  const builtin = isBuiltin(config.theme);
  if (builtin && config.theme !== "system") root.dataset.theme = config.theme;
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
const UI_FONT_FALLBACK = '"Segoe UI", system-ui, -apple-system, sans-serif';

/** A CSS font stack with `family` first; its quotes and backslashes are dropped. */
export function fontStack(family: string, fallback: string): string {
  const clean = family.replace(/["\\]/g, "").trim();
  return clean ? `"${clean}", ${fallback}` : fallback;
}

/** Note text size, fonts and editor width, as CSS variables on the document. */
export function applyTypography(a: AxisConfig["appearance"]) {
  const style = document.documentElement.style;
  const size = Math.min(
    NOTE_FONT_SIZES.max,
    Math.max(NOTE_FONT_SIZES.min, Math.round(a.noteFontSize) || 15),
  );
  style.setProperty("--note-font-size", `${size}px`);
  style.setProperty("--editor-width", (EDITOR_WIDTHS[a.editorWidth] ?? EDITOR_WIDTHS.medium).css);
  if (a.uiFont) style.setProperty("--font-ui", fontStack(a.uiFont, UI_FONT_FALLBACK));
  else style.removeProperty("--font-ui");
  if (a.noteFont) style.setProperty("--font-note", fontStack(a.noteFont, "var(--font-ui)"));
  else style.removeProperty("--font-note");
}

/** The effective light/dark mode, for "toggle theme". */
export function effectiveMode(theme: string): "light" | "dark" {
  const mode = isBuiltin(theme) ? THEME_INFO[theme].mode : "system";
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
