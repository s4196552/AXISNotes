// Web pages that skills make (flash cards, practice tests, lessons) are written by a model,
// and models often turn off text selection or cancel copy and paste, e.g. so a click flips
// a card. Every page a skill makes gets this guard, first in <head> so it runs before the
// page's own script:
// - all text stays selectable, whatever the page's CSS says;
// - copy, cut, paste, select and the right-click menu reach the browser untouched (the
//   page's handlers for them are skipped, so they can't cancel them; typing and the
//   `input` events that follow a paste still reach the page);
// - a click that ends a text selection doesn't also flip a card or answer a question.

/** Marks a page that already has the guard, so it's added once. */
export const COPYABLE_MARK = "data-axisnotes-copyable";

const STYLE =
  "html,body,body *{-webkit-user-select:text!important;user-select:text!important}" +
  "input,textarea,[contenteditable]{-webkit-user-select:auto!important;user-select:auto!important}";

// Listeners on `window` in the capture phase run before any of the page's; stopping the
// event there skips the page's handlers but not the browser's own default action.
const SCRIPT = `(function () {
  var stop = function (e) { e.stopImmediatePropagation(); };
  ["copy", "cut", "paste", "selectstart", "contextmenu"].forEach(function (t) {
    window.addEventListener(t, stop, true);
  });
  window.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[acvx]$/i.test(e.key)) stop(e);
  }, true);
  window.addEventListener("click", function (e) {
    var s = window.getSelection && window.getSelection();
    var t = e.target;
    var control = t && t.closest && t.closest("a,button,input,textarea,select,label,summary,[contenteditable]");
    if (s && !s.isCollapsed && String(s).trim() && !control) stop(e);
  }, true);
})();`;

const GUARD = `<style ${COPYABLE_MARK}>${STYLE}</style>\n<script ${COPYABLE_MARK}>${SCRIPT}</script>\n`;

/** `html` with the copy guard first in its <head> (added once; a page without a <head> gets one). */
export function makeCopyable(html: string): string {
  if (html.includes(COPYABLE_MARK)) return html;
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (head) {
    const at = head.index + head[0].length;
    return `${html.slice(0, at)}\n${GUARD}${html.slice(at)}`;
  }
  const root = /<html(\s[^>]*)?>/i.exec(html);
  if (root) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}\n<head>\n${GUARD}</head>${html.slice(at)}`;
  }
  const doctype = /<!doctype[^>]*>/i.exec(html);
  const at = doctype ? doctype.index + doctype[0].length : 0;
  return `${html.slice(0, at)}\n${GUARD}${html.slice(at)}`;
}

/**
 * Put a page's text on the clipboard ("Copy text"). Returns what to tell the user: how much
 * was copied, or why nothing was (a page whose text is written by its script).
 */
export async function copyPageText(html: string): Promise<string> {
  const text = pageText(html);
  if (!text)
    return "This page writes its text when it runs. Open it in the browser and copy from there.";
  await navigator.clipboard.writeText(text);
  const lines = text.split("\n").filter(Boolean).length;
  return `Copied the page's text (${lines} line${lines === 1 ? "" : "s"}).`;
}

/** The rule every HTML-making run is given, so the page doesn't fight the guard. */
export const COPYABLE_RULE =
  "Any web page you make must let people select, copy and paste all of its text: never turn off text selection, copying, pasting or the right-click menu.";

/** Sits on lines of its own, with a blank line around it (paragraphs, headings, lists). */
const BLOCK =
  /^(address|article|aside|blockquote|details|div|dl|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|summary|table|ul)$/i;
/** Ends its line, with no blank line before the next (list items, table rows). */
const LINE = /^(li|tr|dt|dd)$/i;

/**
 * The text of a page as it is on disk, one block per line, for "Copy text". Scripts don't
 * run here (pages never run inside the app), so text a script writes isn't included.
 */
export function pageText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const el of doc.querySelectorAll("script, style, noscript, template, head")) el.remove();
  const out: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out.push((node.textContent ?? "").replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName;
    if (tag === "BR") return void out.push("\n");
    const block = BLOCK.test(tag);
    if (block) out.push("\n");
    if (tag === "TD" || tag === "TH") out.push("\t");
    for (const child of el.childNodes) walk(child);
    if (block || LINE.test(tag)) out.push("\n");
  };
  walk(doc.body);
  return out
    .join("")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, (m) => (m.includes("\t") ? "\t" : " ")).trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
