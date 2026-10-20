import { create } from "zustand";
import { backend, isBackendError, type NoteRef, type VaultEntry, type VaultInfo } from "../ipc";
import { parseWikilinkInner } from "../lib/markdown";
import { markNewVault, rememberVault } from "./recentVaults";
import { showLeftPanel } from "./layout";
import * as T from "./tabs";
import type { GroupColor, TabsState, View } from "./tabs";

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
export type MainView = View;

/** How to open a note. */
export interface OpenOptions {
  /** In a new tab instead of the active one. */
  newTab?: boolean;
}

export interface AppState {
  vault: VaultInfo | null;
  tree: VaultEntry | null;
  /** All notes (for link autocomplete, quick switcher, resolution hints). */
  notes: NoteRef[];
  /** Bumped whenever indexed data may have changed; panels re-query on change. */
  indexVersion: number;
  /** Open tabs (see tabs.ts). `activePath` and `mainView` mirror the active tab. */
  tabs: TabsState;
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
  /** Set while a newly opened vault's index is being caught up. */
  indexing: { done: number; total: number } | null;

  openVault(path: string): Promise<void>;
  /** `files`: notes to start the vault with (path → content). */
  createVault(parentDir: string, name: string, files?: Record<string, string>): Promise<void>;
  /** Re-list files and notes, and bump `indexVersion`. */
  refreshTree(): Promise<void>;
  /** Bump `indexVersion` and re-list notes (after the app's own writes). */
  bumpIndex(): void;
  openFile(path: string | null, target?: OpenTarget, opts?: OpenOptions): void;
  /** Show a folder's dashboard ("" = the vault's Home). */
  openDashboard(folder: string, opts?: OpenOptions): void;
  newTab(): void;
  /** Close a tab (default: the active one). */
  closeTab(id?: string): void;
  closeOtherTabs(id?: string): void;
  closeTabsToRight(id?: string): void;
  activateTab(id: string): void;
  /** Next (+1) or previous (-1) tab, wrapping around. */
  cycleTab(delta: number): void;
  /** The tab at a 0-based position; -1 is the last tab. */
  goToTab(index: number): void;
  goBack(): void;
  goForward(): void;
  /** Move a tab; `group` puts it in that group (null: none), else it keeps its own. */
  moveTab(id: string, to: number, group?: string | null): void;
  togglePinTab(id?: string): void;
  reopenClosedTab(): void;
  /** Ctrl+click ("toggle") or Shift+click ("range") a tab. */
  selectTab(id: string, mode: "toggle" | "range"): void;
  clearTabSelection(): void;
  /** Put tabs (default: the selected ones) in a new group; returns its id. */
  groupTabs(ids?: string[]): string | null;
  addTabsToGroup(ids: string[], groupId: string): void;
  /** Take tabs (default: the selected ones) out of their groups. */
  removeTabsFromGroup(ids?: string[]): void;
  ungroupTabs(groupId: string): void;
  closeTabGroup(groupId: string): void;
  updateTabGroup(groupId: string, patch: { name?: string; color?: GroupColor }): void;
  /** Collapse or expand a group. */
  toggleTabGroup(groupId: string): void;
  newTabInGroup(groupId: string): void;
  moveTabGroup(groupId: string, to: number): void;
  clearPendingTarget(): void;
  /**
   * Follow a wikilink written in note `from` (inner text like `Note#Heading|alias`).
   * Missing notes are created (at the vault root, or at the given path).
   */
  openLink(inner: string, from: string, opts?: OpenOptions): Promise<void>;
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

/**
 * State for a new set of tabs: the tabs plus the active tab mirrored for older callers. A
 * dashboard's path is a folder, not a note, so no note is active while one shows.
 */
function withTabs(tabs: TabsState) {
  const tab = T.activeTab(tabs);
  return { tabs, activePath: tab.view === "dashboard" ? null : tab.path, mainView: tab.view };
}

/** Every file and folder path in the tree ("" being the vault itself). */
function pathsIn(tree: VaultEntry): Set<string> {
  const out = new Set<string>([""]);
  const walk = (e: VaultEntry) => {
    out.add(e.path);
    e.children?.forEach(walk);
  };
  walk(tree);
  return out;
}

/** Set after restoring a vault's tabs: drop tabs for missing files once the tree is in. */
let pruneRestoredTabs = false;

export const useAppStore = create<AppState>((set, get) => ({
  vault: null,
  tree: null,
  notes: [],
  indexVersion: 0,
  tabs: T.initialTabs(),
  activePath: null,
  pendingTarget: null,
  leftPanel: "files",
  mainView: "note",
  searchQuery: "",
  error: null,
  notice: null,
  indexing: null,

  async openVault(path) {
    try {
      const vault = await backend.openVault(path);
      rememberVault(vault);
      set({ vault, activePath: null, error: null });
      await get().refreshTree();
    } catch (e) {
      set({ error: describe(e) });
    }
  },

  async createVault(parentDir, name, files = {}) {
    try {
      const vault = await backend.createVault(parentDir, name);
      for (const [path, content] of Object.entries(files)) {
        const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
        if (dir) await backend.createDir(dir).catch(() => {});
        await backend.createFile(path, content);
      }
      rememberVault(vault);
      markNewVault(vault.root);
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
      if (pruneRestoredTabs) {
        pruneRestoredTabs = false;
        const paths = pathsIn(tree);
        const tabs = T.dropPaths(get().tabs, (p) => paths.has(p));
        if (tabs !== get().tabs) set(withTabs(tabs));
      }
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

  openFile(path, target, opts) {
    set({
      ...withTabs(T.navigate(get().tabs, { path, view: "note" }, opts)),
      pendingTarget: path && target && Object.keys(target).length ? { ...target, path } : null,
    });
  },

  openDashboard(folder, opts) {
    set({
      ...withTabs(T.navigate(get().tabs, { path: folder, view: "dashboard" }, opts)),
      pendingTarget: null,
    });
  },

  newTab: () => set({ ...withTabs(T.newTab(get().tabs)), pendingTarget: null }),
  closeTab(id) {
    const tabs = get().tabs;
    set({ ...withTabs(T.closeTab(tabs, id ?? tabs.active)), pendingTarget: null });
  },
  closeOtherTabs(id) {
    const tabs = get().tabs;
    set({ ...withTabs(T.closeOthers(tabs, id ?? tabs.active)), pendingTarget: null });
  },
  closeTabsToRight(id) {
    const tabs = get().tabs;
    set({ ...withTabs(T.closeToRight(tabs, id ?? tabs.active)), pendingTarget: null });
  },
  activateTab: (id) => set({ ...withTabs(T.activate(get().tabs, id)), pendingTarget: null }),
  cycleTab: (delta) => set({ ...withTabs(T.cycle(get().tabs, delta)), pendingTarget: null }),
  goToTab: (index) => set({ ...withTabs(T.goTo(get().tabs, index)), pendingTarget: null }),
  goBack: () => set({ ...withTabs(T.back(get().tabs)), pendingTarget: null }),
  goForward: () => set({ ...withTabs(T.forward(get().tabs)), pendingTarget: null }),
  moveTab: (id, to, group) => set(withTabs(T.moveTab(get().tabs, id, to, group))),
  togglePinTab(id) {
    const tabs = get().tabs;
    set(withTabs(T.togglePin(tabs, id ?? tabs.active)));
  },
  reopenClosedTab: () => set({ ...withTabs(T.reopenClosed(get().tabs)), pendingTarget: null }),
  selectTab: (id, mode) => set({ tabs: T.selectTab(get().tabs, id, mode) }),
  clearTabSelection: () => set({ tabs: T.clearSelection(get().tabs) }),
  groupTabs(ids) {
    const tabs = T.groupTabs(get().tabs, ids ?? T.selection(get().tabs));
    if (tabs === get().tabs) return null;
    set(withTabs(tabs));
    return tabs.groups.at(-1)!.id;
  },
  addTabsToGroup: (ids, groupId) => set(withTabs(T.addToGroup(get().tabs, ids, groupId))),
  removeTabsFromGroup(ids) {
    const tabs = get().tabs;
    set(withTabs(T.removeFromGroup(tabs, ids ?? T.selection(tabs))));
  },
  ungroupTabs: (groupId) => set(withTabs(T.ungroup(get().tabs, groupId))),
  closeTabGroup: (groupId) =>
    set({ ...withTabs(T.closeGroup(get().tabs, groupId)), pendingTarget: null }),
  updateTabGroup: (groupId, patch) => set({ tabs: T.updateGroup(get().tabs, groupId, patch) }),
  toggleTabGroup: (groupId) =>
    set({ ...withTabs(T.toggleGroup(get().tabs, groupId)), pendingTarget: null }),
  newTabInGroup: (groupId) =>
    set({ ...withTabs(T.newTabInGroup(get().tabs, groupId)), pendingTarget: null }),
  moveTabGroup: (groupId, to) => set(withTabs(T.moveGroup(get().tabs, groupId, to))),

  clearPendingTarget() {
    set({ pendingTarget: null });
  },

  async openLink(inner, from, opts) {
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
      get().openFile(path, target, opts);
    } catch (e) {
      set({ error: describe(e) });
    }
  },

  // Both bring the left panel back if it was hidden, so the result is visible.
  search(query) {
    set({ leftPanel: "search", searchQuery: query });
    showLeftPanel();
  },

  setLeftPanel(panel) {
    set({ leftPanel: panel });
    showLeftPanel();
  },

  // Views live in tabs too: the graph replaces the note in the active tab, and showing
  // "note" again brings that tab's note back (a dashboard's folder is no note to go back to).
  setMainView(view) {
    const tab = T.activeTab(get().tabs);
    const path = tab.view === "dashboard" ? null : tab.path;
    set({ ...withTabs(T.navigate(get().tabs, { path, view })), pendingTarget: null });
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
  },

  onEntryRenamed(from, to) {
    const { activePath: active, tabs } = get();
    // activePath can be set directly (older callers, tests), not through a tab: keep such
    // a path following too. Otherwise the active tab decides.
    const loose = active !== T.activeTab(tabs).path;
    set({
      ...withTabs(T.renamePath(tabs, from, to)),
      ...(loose && active && isSameOrInside(active, from)
        ? { activePath: to + active.slice(from.length) }
        : {}),
    });
  },

  onEntryRemoved(path) {
    const { activePath: active, tabs } = get();
    const loose = active !== T.activeTab(tabs).path;
    set({
      ...withTabs(T.removePath(tabs, path)),
      ...(loose && active && isSameOrInside(active, path) ? { activePath: null } : {}),
    });
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

// ---- Tabs are kept per vault on this device ----

const TABS_KEY = "axisnotes.tabs:";

function loadTabs(root: string): TabsState {
  try {
    return T.deserialize(localStorage.getItem(TABS_KEY + root));
  } catch {
    return T.initialTabs();
  }
}

useAppStore.subscribe((s, prev) => {
  const root = s.vault?.root;
  if (root !== prev.vault?.root) {
    // Another vault (or none): its own tabs, checked against its files once they're listed.
    pruneRestoredTabs = root !== undefined;
    useAppStore.setState({
      ...withTabs(root ? loadTabs(root) : T.initialTabs()),
      pendingTarget: null,
    });
  } else if (root && s.tabs !== prev.tabs) {
    try {
      localStorage.setItem(TABS_KEY + root, T.serialize(s.tabs));
    } catch {
      // Storage full or blocked: tabs just won't come back next time.
    }
  }
});
