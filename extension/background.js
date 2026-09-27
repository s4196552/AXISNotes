// AXISNotes Web Clipper background worker (Chrome/Edge service worker, Firefox event page).
// Takes clips from the popup and the context menu, sends them to the AXISNotes desktop app on
// 127.0.0.1, and keeps them in a queue while AXISNotes isn't running.

import { extractPage } from "./lib/extract.js";
import { deliver, flush, newClip, pair, queued, status } from "./lib/queue.js";

const VENDOR = ["vendor/Readability.js", "vendor/turndown.js", "vendor/turndown-plugin-gfm.js"];

const storage = {
  get: async (key) => (await chrome.storage.local.get(key))[key],
  set: (key, value) => chrome.storage.local.set({ [key]: value }),
};

async function env() {
  const { token = null, port } = await chrome.storage.local.get(["token", "port"]);
  return { fetch: (...a) => fetch(...a), storage, token, port: port || undefined };
}

async function updateBadge() {
  const n = (await queued(storage)).length;
  await chrome.action.setBadgeText({ text: n ? String(n) : "" });
  await chrome.action.setBadgeBackgroundColor({ color: "#7c6cf0" });
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Build a clip of the given kind from a tab (and optional context-menu info). */
async function capture(kind, tab, info = {}) {
  if (kind === "link") {
    return newClip("url", { title: info.selectionText || info.linkUrl, url: info.linkUrl });
  }
  if (kind === "url") return newClip("url", { title: tab.title, url: tab.url });
  if (kind === "screenshot") {
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
    return newClip("screenshot", { title: tab.title, url: tab.url, image });
  }
  const target = { tabId: tab.id };
  await chrome.scripting.executeScript({ target, files: VENDOR });
  const [{ result }] = await chrome.scripting.executeScript({
    target,
    func: extractPage,
    args: [kind],
  });
  if (!result.markdown)
    throw new Error(
      kind === "selection" ? "Nothing is selected." : "This page has no readable text.",
    );
  return newClip(kind, result);
}

/** Clip and deliver; the result is shown by the popup. */
async function clip(kind, tab, info) {
  try {
    const c = await capture(kind, tab, info);
    const r = await deliver(c, await env());
    await updateBadge();
    if (r === "sent") return { ok: true, message: "Saved to AXISNotes." };
    if (r === "retry")
      return { ok: true, message: "AXISNotes isn't running; the clip will be sent when it is." };
    if (r === "unpaired")
      return { ok: false, message: "Pair with AXISNotes first; the clip is kept until then." };
    return { ok: false, message: r.error };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

async function retry() {
  const r = await flush(await env());
  await updateBadge();
  return r;
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    switch (msg.type) {
      case "status":
        return status(await env());
      case "pair": {
        const r = await pair(msg.code, msg.name, await env());
        if (r.token) {
          await chrome.storage.local.set({ token: r.token });
          await retry();
        }
        return r;
      }
      case "unpair":
        await chrome.storage.local.remove("token");
        return { ok: true };
      case "port":
        await chrome.storage.local.set({ port: Number(msg.port) || null });
        return { ok: true };
      case "clip":
        return clip(msg.kind, await activeTab());
      case "retry":
        return retry();
      default:
        return { error: "unknown message" };
    }
  })().then(reply);
  return true; // async reply
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "page", title: "Clip page to AXISNotes", contexts: ["page"] });
    chrome.contextMenus.create({
      id: "selection",
      title: "Clip selection to AXISNotes",
      contexts: ["selection"],
    });
    chrome.contextMenus.create({ id: "link", title: "Save link to AXISNotes", contexts: ["link"] });
  });
  chrome.alarms.create("flush", { periodInMinutes: 1 });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (tab) void clip(String(info.menuItemId), tab, info);
});

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "flush") void retry();
});

chrome.runtime.onStartup.addListener(() => void retry());
