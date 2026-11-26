import type { VaultChange } from "../ipc/types";

// Several AXISNotes windows (T-287: "Open in new window"). They share one backend and one
// open vault. The backend tells every window about changes made outside the app, but not
// about the app's own saves, so each window announces its own changes to the others here:
// an open note then reloads (or shows its conflict banner), the file tree re-lists, and
// settings saved in one window are read again in the others.

/** This window was opened for one note with "Open in new window": that note's path. */
export function noteWindowPath(search = typeof location === "undefined" ? "" : location.search) {
  return new URLSearchParams(search).get("note");
}

export type WindowMessage =
  | { kind: "changes"; changes: VaultChange[] }
  /** Another vault was opened (the backend has one open vault for every window). */
  | { kind: "vault"; root: string };

const CHANNEL = "axisnotes.windows";
let channel: BroadcastChannel | null | undefined;
function open(): BroadcastChannel | null {
  if (channel === undefined)
    channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(CHANNEL) : null;
  return channel;
}

/** Tell the other windows (never this one). */
export function tellOtherWindows(message: WindowMessage) {
  try {
    open()?.postMessage(message);
  } catch {
    // A closed channel: there is no other window to tell.
  }
}

/** What the other windows announce. Returns the unsubscribe. */
export function onOtherWindows(cb: (message: WindowMessage) => void): () => void {
  const c = open();
  if (!c) return () => {};
  const listener = (e: MessageEvent<WindowMessage>) => cb(e.data);
  c.addEventListener("message", listener);
  return () => c.removeEventListener("message", listener);
}
