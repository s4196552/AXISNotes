import { create } from "zustand";
import { isFeatureEnabled } from "../modules/features";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { editNote } from "../files/editNote";
import { appendEntry, closeEntry, parseStamp, stamp } from "./timeLog";

export interface Running {
  path: string;
  start: string;
  task?: string;
}
interface TimerState {
  running: Running | null;
  busy: boolean;
  restoreStatus: "idle" | "pending" | "ready" | "failed";
  restoredVaultRoot: string | undefined;
  start(path: string, task?: string): Promise<void>;
  stop(): Promise<void>;
  restore(): Promise<void>;
  /** Verify persisted timer state before disabling; this never edits time logs. */
  prepareToDisable(): Promise<void>;
  suspend(): void;
}
const report = (e: unknown) =>
  useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));
let restoreGeneration = 0;
let pendingRestore: {
  generation: number;
  vaultRoot: string | undefined;
  promise: Promise<void>;
} | null = null;
const vaultRoot = () => useAppStore.getState().vault?.root;

export const useTimer = create<TimerState>((set, get) => ({
  running: null,
  busy: false,
  restoreStatus: "idle",
  restoredVaultRoot: undefined,
  async start(path, task) {
    if (get().busy || !isFeatureEnabled("timeTracking")) return;
    const vault = vaultRoot();
    if (get().restoreStatus !== "ready" || get().restoredVaultRoot !== vault || pendingRestore)
      await get().restore();
    if (vault !== vaultRoot() || !isFeatureEnabled("timeTracking") || get().busy) return;
    if (get().restoreStatus !== "ready") {
      useAppStore
        .getState()
        .notify("Timer state could not be restored. Try again before starting a timer.");
      return;
    }
    if (get().running) await get().stop();
    if (get().running || get().busy || vault !== vaultRoot() || !isFeatureEnabled("timeTracking"))
      return;
    const generation = ++restoreGeneration;
    const start = stamp(new Date());
    set({ busy: true });
    try {
      await editNote(path, (text) => appendEntry(text, { start, task }));
      if (
        generation === restoreGeneration &&
        vault === vaultRoot() &&
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
    pendingRestore = null;
    set({ running: null, restoreStatus: "idle", restoredVaultRoot: undefined });
  },
  async stop() {
    if (get().busy) return;
    const r = get().running;
    if (!r) return; // A no-op stop must not discard an in-flight restore.
    const generation = ++restoreGeneration;
    const vault = vaultRoot();
    set({ busy: true });
    try {
      const closed = await editNote(r.path, (text) => closeEntry(text, r.start, stamp(new Date())));
      if (generation === restoreGeneration && vault === vaultRoot()) set({ running: null });
      if (!closed)
        useAppStore.getState().notify("The running time entry was no longer in its note.");
    } catch (e) {
      report(e);
    } finally {
      set({ busy: false });
    }
  },
  async prepareToDisable() {
    const check = () => {
      if (get().busy)
        throw new Error("Wait for the timer to finish saving before disabling time tracking.");
      if (get().running) throw new Error("Stop the running timer before disabling time tracking.");
    };
    check();
    const vault = vaultRoot();
    await get().restore();
    if (vault !== vaultRoot())
      throw new Error("The vault changed. Try again in the current vault.");
    if (get().restoreStatus !== "ready")
      throw new Error(
        "Timer state could not be restored. Try again before disabling time tracking.",
      );
    check();
  },
  restore() {
    if (
      pendingRestore?.generation === restoreGeneration &&
      pendingRestore.vaultRoot === vaultRoot()
    )
      return pendingRestore.promise;
    const generation = ++restoreGeneration;
    const vault = vaultRoot();
    set({ restoreStatus: "pending" });
    const promise = (async () => {
      try {
        const open = (await backend.timeEntries()).filter((e) => !e.end && parseStamp(e.start));
        if (
          generation !== restoreGeneration ||
          vault !== vaultRoot() ||
          !isFeatureEnabled("timeTracking")
        )
          return;
        const latest = open.at(-1);
        set({
          restoreStatus: "ready",
          restoredVaultRoot: vault,
          running: latest
            ? {
                path: latest.path,
                start: latest.start,
                ...(latest.task ? { task: latest.task } : {}),
              }
            : null,
        });
      } catch (e) {
        if (generation === restoreGeneration && vault === vaultRoot()) {
          set({ restoreStatus: "failed" });
          report(e);
        }
      } finally {
        if (pendingRestore?.generation === generation) pendingRestore = null;
      }
    })();
    pendingRestore = { generation, vaultRoot: vault, promise };
    return promise;
  },
}));
