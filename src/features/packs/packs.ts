import { create } from "zustand";
import { backend, isBackendError, type Pack, type PackKind } from "../../ipc";

// Icon and image packs the user added, kept in the vault's hidden `.axisnotes/packs/`.
// Icons and covers point at pack files by vault path, so a pack image is used where it
// is (no copy into attachments/). Reloaded whenever a picker or Settings opens, so
// another vault's packs never linger.

const PACKS_PREFIX = ".axisnotes/packs/";

/** A path inside a pack (these aren't in the file tree, so they're used as written). */
export const isPackPath = (path: string) =>
  path.startsWith(PACKS_PREFIX) && !path.split("/").includes("..");

/** "rocket-ship_2.svg" → "rocket ship 2": a pack file's name as words, for search and labels. */
export const packFileLabel = (path: string) =>
  path
    .slice(path.lastIndexOf("/") + 1)
    .replace(/\.[^.]+$/, "")
    .replace(/[-_.]+/g, " ")
    .trim();

/** "12 icons", "1 image". */
export const packCount = (pack: Pack) =>
  `${pack.files.length.toLocaleString()} ${pack.kind === "icons" ? "icon" : "image"}${pack.files.length === 1 ? "" : "s"}`;

/** Whether a pack file matches what's typed in a picker's search box. */
export function matchesPackFile(path: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || packFileLabel(path).toLowerCase().includes(q);
}

interface PacksState {
  packs: Pack[];
  /** False until the first load for the open vault finishes. */
  loaded: boolean;
  error: string;
  load(): Promise<void>;
  /** Ask for a folder or `.zip` and add it as a pack; null if cancelled. Throws a message. */
  add(kind: PackKind, from: "folder" | "zip"): Promise<Pack | null>;
  remove(kind: PackKind, name: string): Promise<void>;
}

const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));

let generation = 0;

export const usePacks = create<PacksState>()((set, get) => ({
  packs: [],
  loaded: false,
  error: "",
  async load() {
    const mine = ++generation;
    try {
      const packs = await backend.listPacks();
      // A newer load (e.g. after switching vaults) wins.
      if (mine === generation) set({ packs, loaded: true, error: "" });
    } catch (e) {
      if (mine === generation) set({ packs: [], loaded: true, error: message(e) });
    }
  },
  async add(kind, from) {
    const source = await backend.pickPackSource(from);
    if (!source) return null;
    let pack: Pack;
    try {
      pack = await backend.importPack(kind, source);
    } catch (e) {
      throw new Error(message(e), { cause: e });
    }
    await get().load();
    return pack;
  },
  async remove(kind, name) {
    try {
      await backend.removePack(kind, name);
    } finally {
      await get().load();
    }
  },
}));
