import { create } from "zustand";
import { backend, isBackendError, type VaultEntry, type VaultInfo } from "../ipc";

export interface AppState {
  vault: VaultInfo | null;
  tree: VaultEntry | null;
  /** Vault-relative path of the note open in the editor. */
  activePath: string | null;
  /** Last user-facing error, shown in the status bar. */
  error: string | null;

  openVault(path: string): Promise<void>;
  createVault(parentDir: string, name: string): Promise<void>;
  refreshTree(): Promise<void>;
  openFile(path: string | null): void;
  /** Call after a rename/move so the open note follows its file. */
  onEntryRenamed(from: string, to: string): void;
  /** Call after a trash so an open note inside it is closed. */
  onEntryRemoved(path: string): void;
  setError(message: string | null): void;
}

function describe(e: unknown): string {
  return isBackendError(e) ? e.message : String(e);
}

const isSameOrInside = (path: string, dir: string) => path === dir || path.startsWith(dir + "/");

export const useAppStore = create<AppState>((set, get) => ({
  vault: null,
  tree: null,
  activePath: null,
  error: null,

  async openVault(path) {
    try {
      const vault = await backend.openVault(path);
      set({ vault, activePath: null, error: null });
      await get().refreshTree();
    } catch (e) {
      set({ error: describe(e) });
    }
  },

  async createVault(parentDir, name) {
    try {
      const vault = await backend.createVault(parentDir, name);
      set({ vault, activePath: null, error: null });
      await get().refreshTree();
    } catch (e) {
      set({ error: describe(e) });
    }
  },

  async refreshTree() {
    try {
      set({ tree: await backend.listTree() });
    } catch (e) {
      set({ error: describe(e) });
    }
  },

  openFile(path) {
    set({ activePath: path });
  },

  onEntryRenamed(from, to) {
    const active = get().activePath;
    if (active && isSameOrInside(active, from)) {
      set({ activePath: to + active.slice(from.length) });
    }
  },

  onEntryRemoved(path) {
    const active = get().activePath;
    if (active && isSameOrInside(active, path)) set({ activePath: null });
  },

  setError(message) {
    set({ error: message });
  },
}));
