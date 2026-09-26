import { useCallback, useEffect, useRef, useState } from "react";
import { backend, isBackendError, type VaultChange } from "../../ipc";
import { useAppStore } from "../../app/store";

// Load / autosave / conflict handling for a file-backed document (grids, canvases).
// Mirrors the Markdown editor's rules: debounced autosave with mtime-checked writes,
// silent reload on outside edits when clean, and a banner when they collide.

export const AUTOSAVE_DELAY_MS = 500;

export type SaveStatus = "loading" | "saved" | "saving" | "dirty" | "error";
export type Banner = null | "conflict" | "removed";

export const STATUS_TEXT: Record<SaveStatus, string> = {
  loading: "Loading…",
  saved: "Saved",
  saving: "Saving…",
  dirty: "Unsaved changes",
  error: "Save failed",
};

export interface FileDocument {
  status: SaveStatus;
  banner: Banner;
  /** File content as last loaded from disk; null until loaded. */
  text: string | null;
  /** Bumped each time `text` is (re)loaded from disk. */
  loadVersion: number;
  /** Record that the document changed; it is saved after the debounce. */
  markDirty(): void;
  /** Save now. `force` skips the on-disk change check ("Keep my version"). */
  save(force?: boolean): Promise<void>;
  /** Discard local changes and load the file from disk. */
  reload(): Promise<void>;
  dismissBanner(): void;
}

/**
 * `serialize` is called at save time to produce the file content; `enabled` false
 * suspends saving (e.g. while the file failed to parse, so it is never clobbered).
 */
export function useFileDocument(
  path: string,
  serialize: () => string,
  enabled = true,
): FileDocument {
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [banner, setBannerState] = useState<Banner>(null);
  const [text, setText] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);

  const mtime = useRef<number | undefined>(undefined);
  const dirty = useRef(false);
  const paused = useRef(false);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serializeRef = useRef(serialize);
  const enabledRef = useRef(enabled);
  /** Counts edits, to tell whether the document changed while a write was in flight. */
  const edits = useRef(0);

  useEffect(() => {
    serializeRef.current = serialize;
    enabledRef.current = enabled;
  });

  const setBanner = useCallback((b: Banner) => {
    paused.current = b !== null;
    setBannerState(b);
  }, []);

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const save = useCallback(
    async (force = false): Promise<void> => {
      clearTimer();
      if (!enabledRef.current) return;
      if (!force && (!dirty.current || paused.current)) return;
      if (saving.current) await saving.current; // one write at a time
      const content = serializeRef.current();
      const editsAtStart = edits.current;
      setStatus("saving");
      const op = (async () => {
        try {
          const res = await backend.writeFile(path, content, force ? undefined : mtime.current);
          mtime.current = res.modifiedMs;
          useAppStore.getState().bumpIndex();
          if (edits.current === editsAtStart) {
            dirty.current = false;
            setStatus("saved");
          } else {
            setStatus("dirty"); // edited while saving; the pending timer saves again
          }
        } catch (e) {
          if (isBackendError(e) && e.code === "Conflict") {
            setBanner("conflict");
            setStatus("dirty");
          } else {
            setStatus("error");
            useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));
          }
        }
      })();
      saving.current = op;
      await op;
      saving.current = null;
    },
    [path, setBanner],
  );

  const markDirty = useCallback(() => {
    edits.current++;
    dirty.current = true;
    setStatus("dirty");
    clearTimer();
    if (!paused.current) timer.current = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
  }, [save]);

  const reload = useCallback(async () => {
    const file = await backend.readFile(path);
    mtime.current = file.modifiedMs;
    dirty.current = false;
    setText(file.content);
    setLoadVersion((v) => v + 1);
    setStatus("saved");
  }, [path]);

  const dismissBanner = useCallback(() => setBanner(null), [setBanner]);

  // Initial load; flush unsaved changes on unmount.
  useEffect(() => {
    let cancelled = false;
    backend.readFile(path).then(
      (file) => {
        if (cancelled) return;
        mtime.current = file.modifiedMs;
        setText(file.content);
        setLoadVersion((v) => v + 1);
        setStatus("saved");
      },
      (e: unknown) => {
        if (cancelled) return;
        setStatus("error");
        useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));
      },
    );
    return () => {
      cancelled = true;
      clearTimer();
      if (dirty.current && !paused.current && enabledRef.current) {
        void backend
          .writeFile(path, serializeRef.current(), mtime.current)
          .catch((e: unknown) =>
            useAppStore.getState().setError(isBackendError(e) ? e.message : String(e)),
          );
      }
    };
  }, [path]);

  // React to edits made outside the app.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    const onChanges = (changes: VaultChange[]) => {
      for (const c of changes) {
        if (!c.paths.includes(path)) continue;
        const movedAway = c.kind === "renamed" && c.paths[0] === path;
        if (c.kind === "removed" || movedAway) {
          clearTimer();
          setBanner("removed");
        } else if (dirty.current) {
          clearTimer();
          setBanner("conflict");
        } else {
          void reload().catch(() => setBanner("removed"));
        }
      }
    };
    backend.onVaultChanged(onChanges).then((u) => {
      if (disposed) u();
      else unlisten = u;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [path, reload, setBanner]);

  return { status, banner, text, loadVersion, markDirty, save, reload, dismissBanner };
}
