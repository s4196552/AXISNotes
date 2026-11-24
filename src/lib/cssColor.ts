// Reading a colour token for code that draws (canvas) or compares colours. A token's raw
// value can be a function the browser resolves only when it paints, like
// `light-dark(#fff, #000)` (heading presets, text colours, main text: T-277), which canvas
// and hex parsers can't use. Painting a hidden element with it gives the colour in use.

const RESOLVE = /\b(?:light-dark|var|color-mix)\(/i;

/**
 * The colour `name` (a CSS custom property) has on `el`, resolved to `rgb(…)` when its raw
 * value needs the browser to work it out; `fallback` when it's unset.
 */
export function cssColor(
  name: string,
  fallback: string,
  el: Element = document.documentElement,
): string {
  const raw = getComputedStyle(el).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (!RESOLVE.test(raw)) return raw;
  // A canvas's children aren't styled like ordinary content, so probe beside it.
  const host = el instanceof HTMLCanvasElement ? (el.parentElement ?? el) : el;
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = `var(${name})`;
  host.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  // Where nothing resolves it (no layout engine), keep the raw value.
  return /^(?:rgba?\(|#)/i.test(color) ? color : raw;
}

/** `#rrggbb` for an `rgb(…)`/`rgba(…)` or hex colour; "" for anything else. */
export function colorToHex(color: string): string {
  const c = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
  if (!m) return "";
  return `#${[m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
}
