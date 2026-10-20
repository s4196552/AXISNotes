import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { renameInDashboards, trashInDashboards } from "../dashboard/dashboardModel";

/** Re-key path-keyed settings for a renamed entry (or drop them when `to` is null). */
export function remapKeys<T>(map: Record<string, T>, from: string, to: string | null) {
  const affected = Object.keys(map).filter((k) => k === from || k.startsWith(from + "/"));
  if (affected.length === 0) return null;
  const out = { ...map };
  for (const k of affected) {
    const v = out[k]!;
    delete out[k];
    if (to !== null) out[to + k.slice(from.length)] = v;
  }
  return out;
}

/**
 * Move icon, colour and dashboard settings along with a renamed entry. When it was trashed
 * (`to` null), icons and colours go; dashboards inside it are only switched off, so their
 * layouts survive a restore, and pinned links to it show as missing.
 */
export async function remapIcons(from: string, to: string | null) {
  const { folderIcons, entryColors, dashboards } = useConfig.getState().config;
  const boards = (d: typeof dashboards) =>
    to === null ? trashInDashboards(d, from) : renameInDashboards(d, from, to);
  const icons = remapKeys(folderIcons, from, to);
  const colors = remapKeys(entryColors, from, to);
  if (!icons && !colors && !boards(dashboards)) return;
  await useConfig.getState().update((c) => ({
    ...c,
    folderIcons: remapKeys(c.folderIcons, from, to) ?? c.folderIcons,
    entryColors: remapKeys(c.entryColors, from, to) ?? c.entryColors,
    dashboards: boards(c.dashboards) ?? c.dashboards,
  }));
}

/** Rename or move a file or folder, carrying its settings and open tabs along. */
export async function renameEntry(from: string, to: string) {
  await backend.renameEntry(from, to);
  await remapIcons(from, to);
  const store = useAppStore.getState();
  await store.refreshTree();
  store.onEntryRenamed(from, to);
}
