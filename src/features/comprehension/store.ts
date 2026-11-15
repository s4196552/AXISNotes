import { useEffect } from "react";
import { create } from "zustand";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import {
  COMPREHENSION_PATH,
  type ComprehensionFile,
  emptyFile,
  parseFile,
  serialize,
} from "./model";

// The open vault's levels file, `.axisnotes/comprehension.json`. Every change reads the
// file again first, so edits made outside the app (or by another window) aren't lost.

interface ComprehensionState {
  file: ComprehensionFile;
  /** The vault the file was read from (null: not read yet). */
  root: string | null;
  load(): Promise<void>;
  /** Apply `fn` to the file as it is on disk now, save it, and return the result. */
  change(fn: (f: ComprehensionFile) => ComprehensionFile): Promise<ComprehensionFile>;
}

async function readNow(): Promise<ComprehensionFile> {
  try {
    return parseFile((await backend.readFile(COMPREHENSION_PATH)).content);
  } catch (e) {
    if (isBackendError(e) && e.code === "NotFound") return emptyFile();
    throw e;
  }
}

let queue: Promise<unknown> = Promise.resolve();

export const useComprehension = create<ComprehensionState>((set, get) => ({
  file: emptyFile(),
  root: null,

  async load() {
    const root = useAppStore.getState().vault?.root ?? null;
    if (!root) return;
    const file = await readNow().catch(() => emptyFile());
    if (useAppStore.getState().vault?.root === root) set({ file, root });
  },

  change(fn) {
    // One change at a time, in order.
    const run = queue.then(async () => {
      const root = useAppStore.getState().vault?.root ?? null;
      if (!root) throw new Error("Open a vault first.");
      const next = fn(await readNow());
      await backend.writeFile(COMPREHENSION_PATH, serialize(next));
      if (useAppStore.getState().vault?.root === root) set({ file: next, root });
      return next;
    });
    queue = run.catch(() => {});
    return run.then(() => get().file);
  },
}));

/** Read the file once for the open vault (views call this as they mount). */
export function useComprehensionFile(): ComprehensionFile {
  const root = useAppStore((s) => s.vault?.root ?? null);
  const loaded = useComprehension((s) => s.root);
  const file = useComprehension((s) => s.file);
  useEffect(() => {
    if (root && loaded !== root) void useComprehension.getState().load();
  }, [root, loaded]);
  return loaded === root ? file : EMPTY;
}

const EMPTY = emptyFile();
