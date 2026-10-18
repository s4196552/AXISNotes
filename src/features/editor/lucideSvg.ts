import type { LucideIcon } from "lucide-react";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

// CodeMirror draws its menus with plain DOM, not React. Each Lucide icon is rendered once
// into a detached root, kept as an SVG element, and cloned after that.
const cache = new Map<LucideIcon, SVGElement>();

/** A plain `<svg>` of a Lucide icon (15px, current colour), for non-React DOM. */
export function lucideSvg(icon: LucideIcon): SVGElement {
  let svg = cache.get(icon);
  if (!svg) {
    const host = document.createElement("div");
    const root = createRoot(host);
    flushSync(() => root.render(createElement(icon, { size: 15, "aria-hidden": true })));
    svg = host.firstElementChild!.cloneNode(true) as SVGElement;
    root.unmount();
    cache.set(icon, svg);
  }
  return svg.cloneNode(true) as SVGElement;
}
