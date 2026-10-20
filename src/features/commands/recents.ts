import { useEffect } from "react";
import { useAppStore } from "../../app/store";

// What was used last, so the command palette and quick switcher can list it first. Kept
// per vault in this device's local storage: a convenience, never vault data.

const MAX = { commands: 5, files: 12 } as const;
type Kind = keyof typeof MAX;

function key(kind: Kind) {
  const root = useAppStore.getState().vault?.root ?? "";
  return `axisnotes:recent-${kind}:${root}`;
}

export function recentIds(kind: Kind): string[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(kind)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function pushRecent(kind: Kind, id: string) {
  const next = [id, ...recentIds(kind).filter((x) => x !== id)].slice(0, MAX[kind]);
  try {
    localStorage.setItem(key(kind), JSON.stringify(next));
  } catch {
    // Storage full or blocked: recents are only a convenience.
  }
}

/** Remember each file as it opens. (A renamed note reopens under its new path.) */
export function useTrackRecentFiles() {
  useEffect(
    () =>
      useAppStore.subscribe((s, prev) => {
        if (s.activePath && s.activePath !== prev.activePath) pushRecent("files", s.activePath);
      }),
    [],
  );
}
