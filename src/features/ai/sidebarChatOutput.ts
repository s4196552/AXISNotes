import { backend, type AiRule } from "../../ipc";
import { markText } from "../../lib/aiAccess";
import { useAppStore } from "../../app/store";
import { extractHtml } from "../skills/skills";

export type SidebarFormat = "markdown" | "html";
const key = (root: string) => `axisnotes:sidebar-answer-format:${root}`;

export function loadSidebarFormat(root?: string): SidebarFormat {
  try {
    return root && localStorage.getItem(key(root)) === "html" ? "html" : "markdown";
  } catch {
    return "markdown";
  }
}

export function saveSidebarFormat(root: string | undefined, format: SidebarFormat) {
  try {
    if (root) localStorage.setItem(key(root), format);
  } catch {
    // The choice still works for this session.
  }
}

export const HTML_ANSWER_INSTRUCTIONS =
  "Answer as one complete self-contained HTML document starting with <!doctype html>. " +
  "Use inline CSS and, when useful, inline JavaScript. No external files, fonts, images, frames or network requests. " +
  "Make the page readable in a narrow sidebar, with accessible controls and light/dark mode support. " +
  "Keep all text selectable and copyable; do not disable the copy or context menus. Return only the HTML document.";

// A real wheel gesture inside the opaque-origin frame cannot bubble to installZoom.
// This hook is dormant when the saved draft is opened outside the sidebar preview.
const WHEEL_BRIDGE = `<script>window.addEventListener('wheel',function(e){
if(!e.isTrusted||window.name!=='axis-sidebar-html'||!(e.ctrlKey||e.metaKey)||!e.deltaY)return;
e.preventDefault();e.stopImmediatePropagation();window.focus();
parent.postMessage({axisSidebarZoom:e.deltaY<0?1:-1},'*');
},{capture:true,passive:false});</script>`;

/** Render through the existing offline page protocol; never inject HTML into the app DOM. */
export async function saveSidebarPage(answer: string, rule: AiRule, root: string) {
  const html = extractHtml(answer).replace(/<head(\s[^>]*)?>/i, (head) => head + WHEEL_BRIDGE);
  if (useAppStore.getState().vault?.root !== root) throw new Error("The vault changed.");
  const path = `.axisnotes/drafts/AI chat ${crypto.randomUUID()}.html`;
  await backend.createFile(path, markText(path, html, rule), root);
  return path;
}
