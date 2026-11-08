import { create } from "zustand";

/** Files and folders copied or cut in the file tree, waiting to be pasted (T-194). Kept
 *  outside the tree so it survives the sidebar closing, and tied to the vault it came
 *  from, so a paste never reaches into another vault. Not the system clipboard. */
export interface TreeClipboard {
  root: string;
  mode: "copy" | "cut";
  paths: string[];
}

interface ClipboardStore {
  clip: TreeClipboard | null;
  set(clip: TreeClipboard | null): void;
}

export const useTreeClipboard = create<ClipboardStore>((set) => ({
  clip: null,
  set: (clip) => set({ clip }),
}));

/** What's waiting to be pasted into the vault at `root` (nothing from another vault). */
export function clipFor(clip: TreeClipboard | null, root: string | undefined) {
  return clip && root !== undefined && clip.root === root && clip.paths.length ? clip : null;
}

/** "Biology.md", "2 items" — for the menu and the status bar. */
export function itemsLabel(paths: readonly string[], name: (path: string) => string): string {
  return paths.length === 1 ? `"${name(paths[0]!)}"` : `${paths.length} items`;
}
