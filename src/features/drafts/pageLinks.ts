// Links clicked in a vault web page shown in the app (T-192). The page protocol adds a
// handler to every page that posts `{ axisnotesLink: href }` to the app instead of
// following the link (see LINK_SCRIPT in src-tauri/src/pages.rs).

/** Link clicks closer together than this are ignored, so a page can't flood the browser. */
export const LINK_GAP_MS = 1000;

/**
 * Where a link clicked in a page goes: a web address, a vault file (other pages, notes or
 * images beside it), or nowhere. `pageUrl` is the page's own URL, which starts with the
 * page protocol's origin.
 */
export function pageLink(
  href: unknown,
  pageUrl: string,
): { web: string } | { vault: string } | null {
  if (typeof href !== "string" || href.length > 4096) return null;
  const origin = pageUrl.slice(0, pageUrl.indexOf("/", pageUrl.indexOf("//") + 2) + 1);
  if (origin && href.startsWith(origin)) {
    const rest = href.slice(origin.length).split(/[?#]/)[0]!;
    try {
      const path = rest.split("/").map(decodeURIComponent).join("/");
      return path ? { vault: path } : null;
    } catch {
      return null; // a malformed %-escape
    }
  }
  return /^https?:\/\/[^\s]+$/i.test(href) ? { web: href } : null;
}
