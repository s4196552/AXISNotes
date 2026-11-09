import { create } from "zustand";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { type AxisConfig, useConfig } from "../../app/config";
import { remapIcons, renameEntry } from "../files/renameEntry";

// Ctrl+Z / Ctrl+Y for the file tree: renames and moves, deletes (put back from the OS
// trash), new notes and folders, pasted copies, the order of items, and icons, colours
// and AI access. Each step knows how to reverse itself; reversing returns the step that
// redoes it. The history is per vault and kept in memory only.

export interface UndoStep {
  /** What it did, for "Undid …" ("Rename “Ideas”"). */
  label: string;
  /** Reverse it; returns the step that does it again, or null if it can't be redone. */
  revert(): Promise<UndoStep | null>;
}

const LIMIT = 50;

interface UndoStore {
  root: string | null;
  undo: UndoStep[];
  redo: UndoStep[];
}

export const useTreeUndo = create<UndoStore>(() => ({ root: null, undo: [], redo: [] }));

/** Steps recorded during a `batch` go into one step instead of the history. */
let collecting: UndoStep[] | null = null;

/** Record a step the user just took (clears anything that could be redone). */
export function record(step: UndoStep) {
  if (collecting) {
    collecting.push(step);
    return;
  }
  const root = useAppStore.getState().vault?.root ?? null;
  useTreeUndo.setState((s) => ({
    root,
    undo: [...(s.root === root ? s.undo : []), step].slice(-LIMIT),
    redo: [],
  }));
}

/** Run `fn`, recording everything it does as one step (called `label` if it's several). */
export async function batch<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (collecting) return fn(); // already inside a batch
  const steps: UndoStep[] = [];
  collecting = steps;
  try {
    return await fn();
  } finally {
    collecting = null;
    // One step keeps its own, more exact label ("Paste “Bio”", "Rename …").
    if (steps.length === 1) record(steps[0]!);
    else if (steps.length > 1) record(group(label, steps));
  }
}

/** Several steps as one: reversed newest first; redone in the original order. */
export function group(label: string, steps: UndoStep[]): UndoStep {
  return {
    label,
    async revert() {
      const again: UndoStep[] = [];
      for (const s of [...steps].reverse()) {
        const r = await s.revert();
        if (r) again.unshift(r);
      }
      return again.length ? group(label, again) : null;
    },
  };
}

const describe = (e: unknown) => (isBackendError(e) ? e.message : String(e));

async function step(kind: "undo" | "redo") {
  const store = useAppStore.getState();
  const root = store.vault?.root ?? null;
  const s = useTreeUndo.getState();
  const from = s.root === root ? s[kind] : [];
  const last = from[from.length - 1];
  if (!last) {
    store.notify(kind === "undo" ? "Nothing to undo in the file tree." : "Nothing to redo.");
    return;
  }
  const rest = from.slice(0, -1);
  useTreeUndo.setState({ [kind]: rest });
  try {
    const inverse = await last.revert();
    const other = kind === "undo" ? "redo" : "undo";
    if (inverse) useTreeUndo.setState((x) => ({ [other]: [...x[other], inverse].slice(-LIMIT) }));
    await store.refreshTree();
    store.notify(`${kind === "undo" ? "Undid" : "Redid"}: ${last.label}.`);
  } catch (e) {
    // Nothing was changed (or only part of a group): the step is dropped, not retried.
    store.setError(`Couldn't ${kind} “${last.label}”: ${describe(e)}`);
  }
}

export const undoTree = () => step("undo");
export const redoTree = () => step("redo");

/** Forget the history (a vault was opened). */
export const clearTreeUndo = () => useTreeUndo.setState({ root: null, undo: [], redo: [] });

// ---- Steps ----

/** A name as the tree shows it (notes without ".md"). */
const base = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const parent = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

/** `from` was renamed or moved to `to`. */
export function renamed(from: string, to: string): UndoStep {
  const label = parent(from) === parent(to) ? `Rename “${base(from)}”` : `Move “${base(from)}”`;
  return {
    label,
    async revert() {
      await renameEntry(to, from);
      return renamed(to, from);
    },
  };
}

/** Settings that go with a path (icons, colours, order, dashboards), to bring back. */
type Keyed = Pick<AxisConfig, "folderIcons" | "entryColors" | "fileOrder" | "dashboards">;

function keptFor(paths: string[]): Keyed {
  const c = useConfig.getState().config;
  const pick = <T>(map: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(map).filter(([k]) => paths.some((p) => k === p || k.startsWith(p + "/"))),
    );
  const parents = new Set(paths.map(parent));
  return {
    folderIcons: pick(c.folderIcons),
    entryColors: pick(c.entryColors),
    // The order of the folders they were in too, so they come back in their place.
    fileOrder: Object.fromEntries(
      Object.entries(c.fileOrder).filter(
        ([k]) => parents.has(k) || paths.some((p) => k === p || k.startsWith(p + "/")),
      ),
    ),
    dashboards: pick(c.dashboards),
  };
}

async function bringBack(kept: Keyed) {
  await useConfig.getState().update((c) => ({
    ...c,
    folderIcons: { ...c.folderIcons, ...kept.folderIcons },
    entryColors: { ...c.entryColors, ...kept.entryColors },
    fileOrder: { ...c.fileOrder, ...kept.fileOrder },
    dashboards: { ...c.dashboards, ...kept.dashboards },
  }));
}

/**
 * Call before deleting `paths`; call the result with the paths that were deleted to
 * record the step (which puts them back from the OS trash).
 */
export function beforeDelete(paths: string[]): (done: string[]) => void {
  const since = Date.now() - 2000; // a little slack for the trash's clock
  const kept = keptFor(paths);
  return (done) => {
    if (done.length) record(deleted(done, since, kept));
  };
}

function deleted(paths: string[], since: number, kept: Keyed): UndoStep {
  const label = paths.length === 1 ? `Delete “${base(paths[0]!)}”` : `Delete ${paths.length} items`;
  return {
    label,
    async revert() {
      await backend.restoreEntries(paths, since);
      await bringBack(kept);
      return { label, revert: () => toTrash(paths) };
    },
  };
}

/** Put `paths` in the OS trash; returns the step that brings them back. */
async function toTrash(paths: string[]): Promise<UndoStep> {
  const since = Date.now() - 2000;
  const kept = keptFor(paths);
  for (const p of paths) {
    await backend.trashEntry(p);
    useAppStore.getState().onEntryRemoved(p);
    await remapIcons(p, null);
  }
  return deleted(paths, since, kept);
}

/**
 * Something new appeared at `path` (a note, folder or pasted copy) with `content` (null
 * for a folder). Undo puts it in the OS trash, only while it's unchanged, so nothing
 * written since is lost; redo puts it back.
 */
export function created(path: string, content: string | null, label?: string): UndoStep {
  return {
    label: label ?? `New “${base(path)}”`,
    async revert() {
      if (content !== null) {
        const now = await backend.readFile(path);
        if (now.content !== content)
          throw new Error(`“${base(path)}” has changed since; delete it yourself if you meant to`);
      } else {
        const entry = findIn(useAppStore.getState().tree, path);
        if (entry?.children?.length)
          throw new Error(
            `“${base(path)}” has items in it now; delete it yourself if you meant to`,
          );
      }
      return toTrash([path]);
    },
  };
}

/** Pasted copies, as one step (each copy is taken back while it's unchanged). */
export async function copiesMade(paths: string[]): Promise<UndoStep | null> {
  if (!paths.length) return null;
  const steps: UndoStep[] = [];
  for (const p of paths) {
    const entry = findIn(useAppStore.getState().tree, p);
    const content = entry?.kind === "file" ? (await backend.readFile(p)).content : null;
    // A copied folder can't be checked item by item: it goes back to the trash as a whole.
    steps.push(entry?.kind === "dir" ? copiedFolder(p) : created(p, content));
  }
  const label = paths.length === 1 ? `Paste “${base(paths[0]!)}”` : `Paste ${paths.length} items`;
  return steps.length === 1 ? { ...steps[0]!, label } : group(label, steps);
}

function copiedFolder(path: string): UndoStep {
  return {
    label: `Paste “${base(path)}”`,
    revert: () => toTrash([path]),
  };
}

/**
 * A setting stored per path changed (`folderIcons`, `entryColors`, `fileOrder`, or
 * `ai.folders` / `ai.models`): undo puts `before` back (undefined removes it).
 */
export type KeyedSetting = "folderIcons" | "entryColors" | "fileOrder" | "ai.folders" | "ai.models";

function mapOf(c: AxisConfig, which: KeyedSetting): Record<string, unknown> {
  return which === "ai.folders"
    ? c.ai.folders
    : which === "ai.models"
      ? c.ai.models
      : (c[which] as Record<string, unknown>);
}

function withMap(c: AxisConfig, which: KeyedSetting, map: Record<string, unknown>): AxisConfig {
  if (which === "ai.folders")
    return { ...c, ai: { ...c.ai, folders: map as AxisConfig["ai"]["folders"] } };
  if (which === "ai.models")
    return { ...c, ai: { ...c.ai, models: map as AxisConfig["ai"]["models"] } };
  return { ...c, [which]: map };
}

/** The value a path-keyed setting has now (to pass to `settingChanged` before changing it). */
export const settingOf = (which: KeyedSetting, key: string): unknown =>
  structuredClone(mapOf(useConfig.getState().config, which)[key]);

export function settingChanged(
  label: string,
  which: KeyedSetting,
  key: string,
  before: unknown,
): UndoStep {
  return {
    label,
    async revert() {
      const now = settingOf(which, key);
      await useConfig.getState().update((c) => {
        const map = { ...mapOf(c, which) };
        if (before === undefined) delete map[key];
        else map[key] = structuredClone(before);
        return withMap(c, which, map);
      });
      return settingChanged(label, which, key, now);
    },
  };
}

/** Record a change to a path-keyed setting made by `apply`. */
export async function changeSetting(
  label: string,
  which: KeyedSetting,
  key: string,
  apply: () => Promise<unknown> | unknown,
) {
  const before = settingOf(which, key);
  await apply();
  if (JSON.stringify(settingOf(which, key)) !== JSON.stringify(before))
    record(settingChanged(label, which, key, before));
}

function findIn<T extends { path: string; children?: T[] | null }>(
  node: T | null,
  path: string,
): T | null {
  if (!node) return null;
  if (node.path === path) return node;
  for (const c of node.children ?? []) {
    if (path === c.path || path.startsWith(c.path + "/")) return findIn(c, path);
  }
  return null;
}

type Keys = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">;

/** Ctrl/Cmd + Z. */
export const isUndoKey = (e: Keys) =>
  (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "z";

/** Ctrl/Cmd + Y, or Ctrl/Cmd + Shift + Z. */
export const isRedoKey = (e: Keys) =>
  (e.ctrlKey || e.metaKey) &&
  !e.altKey &&
  ((!e.shiftKey && e.key.toLowerCase() === "y") || (e.shiftKey && e.key.toLowerCase() === "z"));
