import { create } from "zustand";
import { useAppStore } from "../../app/store";
import { registerCommands } from "../commands/registry";

/** The folders a vault path sits in, outermost first: `A/B/c.md` → `A`, `A/B`. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_p, i) => parts.slice(0, i + 1).join("/"));
}

/**
 * Asks the file tree to show a path (it listens; see FileTree). `pending` waits for a file
 * tree that isn't mounted yet (its panel was just switched to); the tree clears it.
 */
export const useRevealRequest = create<{ count: number; pending: string | null }>(() => ({
  count: 0,
  pending: null,
}));

/** Show the file tree with `path` selected and in view; a folder also opens (T-275). */
export function revealPath(path: string) {
  useAppStore.getState().setLeftPanel("files");
  useRevealRequest.setState((s) => ({ count: s.count + 1, pending: path }));
}

/** Show the file tree with the open file selected and in view. */
export function revealOpenFile() {
  const store = useAppStore.getState();
  if (!store.activePath) return;
  revealPath(store.activePath);
}

registerCommands([
  {
    id: "reveal-in-tree",
    label: "Reveal open file in the file tree",
    available: () => useAppStore.getState().activePath !== null,
    run: revealOpenFile,
  },
]);
