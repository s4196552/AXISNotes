// Runs inside the page (injected with chrome.scripting.executeScript({ func })), after the
// vendored Readability and Turndown scripts. It must be self-contained: only its own
// code and those globals are available there.

/**
 * The page's readable article (or the current selection) as Markdown.
 * @param {"page" | "selection"} mode
 * @returns {{ title: string, url: string, markdown: string }}
 */
export function extractPage(mode) {
  const td = new globalThis.TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  if (globalThis.turndownPluginGfm) td.use(globalThis.turndownPluginGfm.gfm);
  td.remove(["script", "style", "noscript", "iframe", "form", "button"]);
  // "- item" / "1. item" (Turndown pads markers to four columns).
  td.addRule("listItem", {
    filter: "li",
    replacement(content, node, options) {
      const parent = node.parentNode;
      let prefix = options.bulletListMarker + " ";
      if (parent.nodeName === "OL") {
        const start = Number(parent.getAttribute("start")) || 1;
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const indent = " ".repeat(prefix.length);
      const body = content
        .replace(/^\n+/, "")
        .replace(/\n+$/, "\n")
        .replace(/\n(?!$)/g, `\n${indent}`);
      return prefix + body + (node.nextSibling && !/\n$/.test(body) ? "\n" : "");
    },
  });
  const absolutize = (root) => {
    root.querySelectorAll("a[href]").forEach((a) => a.setAttribute("href", a.href));
    root.querySelectorAll("img[src]").forEach((i) => i.setAttribute("src", i.src));
  };
  const pageTitle = (document.title || location.hostname).trim();

  if (mode === "selection") {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return { title: pageTitle, url: location.href, markdown: "" };
    const div = document.createElement("div");
    for (let i = 0; i < sel.rangeCount; i++) div.appendChild(sel.getRangeAt(i).cloneContents());
    absolutize(div);
    return { title: pageTitle, url: location.href, markdown: td.turndown(div.innerHTML).trim() };
  }

  // A clone keeps the page's URL, so its links resolve the same; the page isn't touched.
  const clone = document.cloneNode(true);
  absolutize(clone);
  let article;
  try {
    article = new globalThis.Readability(clone).parse();
  } catch {
    article = null; // fall back to the whole body
  }
  const title = (article && article.title ? article.title : pageTitle).trim();
  let markdown = td
    .turndown(article && article.content ? article.content : document.body.innerHTML)
    .trim();
  // The note has its own title heading; drop a leading one that repeats it.
  const first = /^#{1,2}\s+(.+)\n+/.exec(markdown);
  if (first && first[1].trim().toLowerCase() === title.toLowerCase()) {
    markdown = markdown.slice(first[0].length);
  }
  return { title, url: location.href, markdown };
}
