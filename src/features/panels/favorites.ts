import { useConfig } from "../../app/config";

// Favorite notes, files and folders (T-275): vault paths in the user's order, saved in the
// vault config as `favorites`. They follow renames and moves made in the app (renameEntry).

const save = (fn: (list: string[]) => string[]) =>
  useConfig.getState().update((c) => ({ ...c, favorites: fn(c.favorites) }));

export const isFavorite = (path: string) => useConfig.getState().config.favorites.includes(path);

/** Add paths to the end of the favorites (ones already there stay where they are). */
export function addFavorites(paths: readonly string[]) {
  return save((list) => [
    ...list,
    ...paths.filter((p, i) => !list.includes(p) && paths.indexOf(p) === i),
  ]);
}

export function removeFavorite(path: string) {
  return save((list) => list.filter((p) => p !== path));
}

/** Put `path` before `before` (null: at the end). */
export function moveFavorite(path: string, before: string | null) {
  return save((list) => {
    if (!list.includes(path) || path === before) return list;
    const rest = list.filter((p) => p !== path);
    const at = before === null ? -1 : rest.indexOf(before);
    rest.splice(at === -1 ? rest.length : at, 0, path);
    return rest;
  });
}

/**
 * Favorites after `from` was renamed or moved to `to` (it or anything inside it), or null
 * when none were affected. A trashed entry (`to` null) stays listed, shown as missing, so
 * undoing the delete brings it back as it was.
 */
export function remapFavorites(list: readonly string[], from: string, to: string | null) {
  if (to === null) return null;
  let changed = false;
  const out = list.map((p) => {
    if (typeof p !== "string") return p;
    if (p !== from && !p.startsWith(from + "/")) return p;
    changed = true;
    return to + p.slice(from.length);
  });
  return changed ? [...new Set(out)] : null;
}
