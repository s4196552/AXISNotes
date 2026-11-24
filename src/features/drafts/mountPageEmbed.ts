import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PageEmbed, type PageEmbedProps } from "./PageEmbed";

export { pageHeight } from "./pageHeight";

/** Show a vault web page embed in `host` (loaded with the first one a note has, T-269). */
export function mountPageEmbed(host: HTMLElement, props: PageEmbedProps): Root {
  const root = createRoot(host);
  root.render(createElement(PageEmbed, props));
  return root;
}
