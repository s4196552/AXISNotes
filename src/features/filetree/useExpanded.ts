import { useCallback, useEffect, useState } from "react";

const storageKey = (vaultRoot: string) => `axis:filetree:expanded:${vaultRoot}`;

function load(vaultRoot: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(vaultRoot));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((p) => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

function save(vaultRoot: string, expanded: Set<string>) {
  try {
    localStorage.setItem(storageKey(vaultRoot), JSON.stringify([...expanded]));
  } catch {
    // Storage may be unavailable (private mode, quota); expansion just won't persist.
  }
}

/** Expanded folder paths, persisted per vault. */
export function useExpanded(vaultRoot: string) {
  const [state, setState] = useState(() => ({ root: vaultRoot, set: load(vaultRoot) }));
  // Reload when the vault changes (adjusting state during render, per React docs).
  if (state.root !== vaultRoot) setState({ root: vaultRoot, set: load(vaultRoot) });
  const expanded = state.set;

  useEffect(() => save(state.root, state.set), [state]);

  const update = useCallback(
    (fn: (prev: Set<string>) => Set<string>) => setState((s) => ({ root: s.root, set: fn(s.set) })),
    [],
  );

  const toggle = useCallback(
    (path: string, open?: boolean) =>
      update((prev) => {
        const next = new Set(prev);
        const shouldOpen = open ?? !next.has(path);
        if (shouldOpen) next.add(path);
        else next.delete(path);
        return next;
      }),
    [update],
  );

  const collapseAll = useCallback(() => update(() => new Set()), [update]);

  return { expanded, toggle, collapseAll, update };
}
