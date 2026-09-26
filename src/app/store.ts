import { create } from "zustand";
import { backend, isBackendError, type NoteRef, type VaultEntry, type VaultInfo } from "../ipc";
import { parseWikilinkInner } from "../lib/markdown";

/** Where to put the cursor after opening a note. */
export interface OpenTarget {
  heading?: string;
  block?: string;
  /** 1-based line. */
  line?: number;
}

/** A jump target bound to the note it was requested for. */
export type PendingTarget = OpenTarget & { path: string };

export type LeftPanel = "files" | "search" | "tags";
export type MainView = "note" | "graph" | "tasks" | "time";

export interface AppState {
  vault: VaultInfo | null;
  tree: VaultEntry | null;
  /** All notes (for link autocomplete, quick switcher, resolution hints). */
  notes: NoteRef[];
  /** Bumped whenever indexed data may have changed; panels re-query on change. */
  indexVersion: number;
  /** Vault-relative path of the note open in the editor. */
  activePath: string | null;
  /** Consumed by the editor for `path` after it loads. */
  pendingTarget: PendingTarget | null;
  leftPanel: LeftPanel;
  mainView: MainView;
  searchQuery: string;
  /** Last user-facing error, shown in the status bar. */
  error: string | null;
  /** Short-lived confirmation shown in the status bar. */
  notice: string | null;

  openVault(path: string): Promise<void>;
  createVault(parentDir: string, name: string): Promise<void>;
  /** Re-list files and notes, and bump `indexVersion`. */
  refreshTree(): Promise<void>;
  /** Bump `indexVersion` and re-list notes (after the app's own writes). */
  bumpIndex(): void;
  openFile(path: string | null, target?: OpenTarget): void;
  clearPendingTarget(): void;
  /**
   * Follow a wikilink written in note `from` (inner text like `Note#Heading|alias`).
   * Missing notes are created (at the vault root, or at the given path).
   */
  openLink(inner: string, from: string): Promise<void>;
  /** Show the search panel with `query`. */
  search(query: string): void;
  setLeftPanel(panel: LeftPanel): void;
  setMainView(view: MainView): void;
  setSearchQuery(query: string): void;
  /** Call after a rename/move so the open note follows its file. */
  onEntryRenamed(from: string, to: string): void;
  /** Call after a trash so an open note inside it is closed. */
  onEntryRemoved(path: string): void;
  setError(message: string | null): void;
  /** Show a confirmation in the status bar for a few seconds. */
  notify(message: string): void;
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null;

function describe(e: unknown): string {
  return isBackendError(e) ? e.message : String(e);
}

const isSameOrInside = (path: string, dir: string) => path === dir || path.startsWith(dir + "/");

export const useAppStore = create<AppState>((set, get) => ({
  vault: null,
  tree: null,
  notes: [],
  indexVersion: 0,
  activePath: null,
  pendingTarget: null,
  leftPanel: "files",
  mainView: "note",
  searchQuery: "",
  error: null,
  notice: null,

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
      const [tree, notes] = await Promise.all([backend.listTree(), backend.listNotes()]);
      set((s) => ({ tree, notes, indexVersion: s.indexVersion + 1 }));
    } catch (e) {
      set({ error: describe(e) });
    }
  },

  bumpIndex() {
    set((s) => ({ indexVersion: s.indexVersion + 1 }));
    backend.listNotes().then(
      (notes) => set({ notes }),
      () => {},
    );
  },

  openFile(path, target) {
    set({
      activePath: path,
      mainView: "note",
      pendingTarget: path && target && Object.keys(target).length ? { ...target, path } : null,
    });
  },

  clearPendingTarget() {
    set({ pendingTarget: null });
  },

  async openLink(inner, from) {
    const link = parseWikilinkInner(inner);
    const target: OpenTarget = {};
    if (link.heading) target.heading = link.heading;
    if (link.block) target.block = link.block;
    try {
      let path = await backend.resolveLink(link.target, from);
      if (!path) {
        const clean = link.target.replace(/^\/+/, "").replace(/\.md$/i, "");
        path = `${clean}.md`;
        await backend.createFile(path, "");
        await get().refreshTree();
      }
      get().openFile(path, target);
    } catch (e) {
      set({ error: describe(e) });
    }
  },

  search(query) {
    set({ leftPanel: "search", searchQuery: query });
  },

  setLeftPanel(panel) {
    set({ leftPanel: panel });
  },

  setMainView(view) {
    set({ mainView: view });
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
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

  notify(message) {
    if (noticeTimer) clearTimeout(noticeTimer);
    set({ notice: message });
    noticeTimer = setTimeout(() => set({ notice: null }), 3000);
  },
}));
