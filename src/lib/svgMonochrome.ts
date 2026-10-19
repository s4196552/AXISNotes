// Mirrors `svg_is_monochrome` in src-tauri/src/packs.rs, for the in-memory backend.

const KEYS = ["fill", "stroke", "stop-color", "flood-color", "color"];
const PLAIN = new Set([
  "none",
  "currentcolor",
  "black",
  "#000",
  "#000f",
  "#000000",
  "#000000ff",
  "rgb(0,0,0)",
  "inherit",
  "transparent",
  "context-fill",
  "context-stroke",
]);

/**
 * Whether an SVG draws in one colour: every fill/stroke/colour it names is black,
 * `currentColor` or none (no colours at all means black). Gradients count as colour.
 */
export function svgIsMonochrome(svg: string): boolean {
  const text = svg.toLowerCase();
  for (const key of KEYS) {
    const re = new RegExp(`(^|[^a-z0-9-])${key}\\s*[=:]\\s*["']?([^"';>\\n}]*)`, "g");
    for (const m of text.matchAll(re)) {
      const value = m[2]!.replace("!important", "").replace(/\s+/g, "");
      if (value && !PLAIN.has(value)) return false;
    }
  }
  return true;
}
