import { invoke } from "@tauri-apps/api/core";

// Clipboard text for the note's Paste menu items (T-288). In the app the Rust core reads
// it (src-tauri/src/clipboard.rs): the page's own clipboard API would make WebView2 ask
// for permission first. In a browser, and where the core can't, the browser API reads it.

const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function readClipboardText(): Promise<string> {
  if (inTauri()) {
    try {
      return await invoke<string>("read_clipboard_text");
    } catch {
      // Not on Windows: the browser API, which may ask for permission.
    }
  }
  return navigator.clipboard.readText();
}

/** Whether the page may read the clipboard (images too) without being asked first. */
export async function clipboardReadAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}
