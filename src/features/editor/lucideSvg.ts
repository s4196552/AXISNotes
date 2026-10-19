import type { LucideIcon } from "lucide-react";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

// CodeMirror draws its menus with plain DOM, not React. Each Lucide icon is rendered once
// per size into a detached root, kept as an SVG element, and cloned after that.
const cache = new Map<LucideIcon, Map<number, SVGElement>>();

/** A plain `<svg>` of a Lucide icon (current colour), for non-React DOM. */
export function lucideSvg(icon: LucideIcon, size = 15): SVGElement {
  let sizes = cache.get(icon);
  if (!sizes) cache.set(icon, (sizes = new Map()));
  let svg = sizes.get(size);
  if (!svg) {
    const host = document.createElement("div");
    const root = createRoot(host);
    flushSync(() => root.render(createElement(icon, { size, "aria-hidden": true })));
    svg = host.firstElementChild!.cloneNode(true) as SVGElement;
    root.unmount();
    sizes.set(size, svg);
  }
  return svg.cloneNode(true) as SVGElement;
}
