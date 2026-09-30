import { create } from "zustand";
import { isFeatureEnabled } from "../modules/features";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { editNote } from "../files/editNote";
import { appendEntry, closeEntry, parseStamp, stamp } from "./timeLog";

// The one running timer. Its state is the open `time_log` entry in the note itself, so a
// timer survives restarts: `restore()` picks up the latest entry without an `end`.

export interface Running {
  path: string;
  start: string;
  task?: string;
}

interface TimerState {
  running: Running | null;
  busy: boolean;
  /** Start timing `path` (optionally a task in it); stops any other running timer. */
  start(path: string, task?: string): Promise<void>;
  stop(): Promise<void>;
  /** Find a timer left running (e.g. across a restart). */
  restore(): Promise<void>;
  /** Release runtime state without changing persisted time logs. */
  suspend(): void;
}

const report = (e: unknown) =>
  useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));

let restoreGeneration = 0;

export const useTimer = create<TimerState>((set, get) => ({
  running: null,
  busy: false,

  async start(path, task) {
    if (get().busy || !isFeatureEnabled("timeTracking")) return;
    ++restoreGeneration;
    if (get().running) await get().stop();
    if (get().running || !isFeatureEnabled("timeTracking")) return;
    const generation = restoreGeneration;
    const vault = useAppStore.getState().vault?.root;
    const start = stamp(new Date());
    set({ busy: true });
    try {
      await editNote(path, (text) => appendEntry(text, { start, task }));
      if (
        generation === restoreGeneration &&
        vault === useAppStore.getState().vault?.root &&
        isFeatureEnabled("timeTracking")
      )
        set({ running: { path, start, task } });
    } catch (e) {
      report(e);
    } finally {
      set({ busy: false });
    }
  },

  suspend() {
    ++restoreGeneration;
    set({ running: null });
  },

  async stop() {
    if (get().busy) return;
    const generation = ++restoreGeneration;
    const vault = useAppStore.getState().vault?.root;
    const r = get().running;
    if (!r) return;
    set({ busy: true });
    try {
      const end = stamp(new Date());
      const closed = await editNote(r.path, (text) => closeEntry(text, r.start, end));
      if (generation === restoreGeneration && vault === useAppStore.getState().vault?.root)
        set({ running: null });
      if (!closed)
        useAppStore.getState().notify("The running time entry was no longer in its note.");
    } catch (e) {
      report(e);
    } finally {
      set({ busy: false });
    }
  },

  async restore() {
    const generation = ++restoreGeneration;
    const vault = useAppStore.getState().vault?.root;
    try {
      const open = (await backend.timeEntries()).filter((e) => !e.end && parseStamp(e.start));
      if (
        generation !== restoreGeneration ||
        vault !== useAppStore.getState().vault?.root ||
        !isFeatureEnabled("timeTracking")
      )
        return;
      const latest = open.at(-1); // entries are sorted oldest first
      set({
        running: latest
          ? {
              path: latest.path,
              start: latest.start,
              ...(latest.task ? { task: latest.task } : {}),
            }
          : null,
      });
    } catch {
      if (generation === restoreGeneration) set({ running: null });
    }
  },
}));
