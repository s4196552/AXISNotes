import { create } from "zustand";
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
  /** Start timing `path` (optionally a task in it); stops any other running timer. */
  start(path: string, task?: string): Promise<void>;
  stop(): Promise<void>;
  /** Find a timer left running (e.g. across a restart). */
  restore(): Promise<void>;
}

const report = (e: unknown) =>
  useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));

export const useTimer = create<TimerState>((set, get) => ({
  running: null,

  async start(path, task) {
    if (get().running) await get().stop();
    const start = stamp(new Date());
    try {
      await editNote(path, (text) => appendEntry(text, { start, task }));
      set({ running: { path, start, task } });
    } catch (e) {
      report(e);
    }
  },

  async stop() {
    const r = get().running;
    if (!r) return;
    set({ running: null });
    try {
      const end = stamp(new Date());
      const closed = await editNote(r.path, (text) => closeEntry(text, r.start, end));
      if (!closed)
        useAppStore.getState().notify("The running time entry was no longer in its note.");
    } catch (e) {
      report(e);
    }
  },

  async restore() {
    try {
      const open = (await backend.timeEntries()).filter((e) => !e.end && parseStamp(e.start));
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
      set({ running: null });
    }
  },
}));
