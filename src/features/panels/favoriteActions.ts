import { useAppStore } from "../../app/store";
import { noteName } from "../../lib/markdown";
import { revealPath } from "../filetree/reveal";
import { findEntry, isOpenable } from "../filetree/treeModel";

const baseName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A favorite's name: a note without `.md`, anything else with its extension. */
export const favoriteName = (path: string) =>
  path.toLowerCase().endsWith(".md") ? noteName(path) : baseName(path);

/** Open a favorite: a folder shows in the file tree, opened; a file opens in a tab. */
export function openFavorite(path: string, newTab = false) {
  const store = useAppStore.getState();
  const entry = findEntry(store.tree, path);
  if (!entry) {
    store.notify(`“${favoriteName(path)}” is no longer in this vault`);
    return;
  }
  if (entry.kind === "dir") revealPath(path);
  else if (isOpenable(entry)) store.openFile(path, undefined, { newTab });
}
