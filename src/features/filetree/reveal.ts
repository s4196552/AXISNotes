import { create } from "zustand";
import { useAppStore } from "../../app/store";
import { showLeftPanel } from "../../app/layout";
import { registerCommands } from "../commands/registry";

/** The folders a vault path sits in, outermost first: `A/B/c.md` → `A`, `A/B`. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_p, i) => parts.slice(0, i + 1).join("/"));
}

/** Asks the file tree to show the open file (it listens; see FileTree). */
export const useRevealRequest = create<{ count: number }>(() => ({ count: 0 }));

/** Show the file tree with the open file selected and in view. */
export function revealOpenFile() {
  const store = useAppStore.getState();
  if (!store.activePath) return;
  store.setLeftPanel("files");
  showLeftPanel();
  useRevealRequest.setState((s) => ({ count: s.count + 1 }));
}

registerCommands([
  {
    id: "reveal-in-tree",
    label: "Reveal open file in the file tree",
    available: () => useAppStore.getState().activePath !== null,
    run: revealOpenFile,
  },
]);
