import { backend } from "../ipc";
import type { AxisConfig } from "./config";

// Applies the theme and CSS snippets from the vault config to the document.
// Built-in modes set `data-theme`; user themes and snippets are injected <style> tags.

export const BUILTIN_THEMES = ["system", "light", "dark"] as const;
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

export async function applyAppearance(config: Pick<AxisConfig, "theme" | "snippets">) {
  const root = document.documentElement;
  const builtin = (BUILTIN_THEMES as readonly string[]).includes(config.theme);
  if (config.theme === "light" || config.theme === "dark") root.dataset.theme = config.theme;
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
}

/** The effective light/dark mode, for "toggle theme". */
export function effectiveMode(theme: string): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
