import { create } from "zustand";
import { type AvailableUpdate, backend, isBackendError } from "../../ipc";

// Updates from a folder (T-066): what the last check found, and installing it.

const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));

interface UpdatesState {
  available: AvailableUpdate | null;
  /** "Later" hides the banner until a later check runs. */
  dismissed: boolean;
  checking: boolean;
  /** The last check finished (with or without an update). */
  checked: boolean;
  installing: boolean;
  error: string | null;
  /** Look in the updates folder; returns what it found. */
  check(): Promise<AvailableUpdate | null>;
  install(): Promise<void>;
  dismiss(): void;
}

export const useUpdates = create<UpdatesState>((set, get) => ({
  available: null,
  dismissed: false,
  checking: false,
  checked: false,
  installing: false,
  error: null,
  async check() {
    set({ checking: true, checked: false, error: null });
    try {
      const available = await backend.updatesCheck();
      set({ available, dismissed: false, checked: true });
      return available;
    } catch (e) {
      set({ error: message(e) });
      return null;
    } finally {
      set({ checking: false });
    }
  },
  async install() {
    const update = get().available;
    if (!update) return;
    set({ installing: true, error: null });
    try {
      // On success the app closes while the installer runs, then reopens updated.
      await backend.updatesInstall(update.version);
    } catch (e) {
      set({ installing: false, error: message(e) });
    }
  },
  dismiss: () => set({ dismissed: true }),
}));

/** Once per app start: check the updates folder unless that is turned off. Problems
 *  (e.g. an unreachable network folder) stay quiet here; Settings → Updates shows them. */
export async function checkOnLaunch() {
  try {
    if (!(await backend.updatesSettings()).checkOnLaunch) return;
  } catch {
    return;
  }
  const found = await useUpdates.getState().check();
  if (!found) useUpdates.setState({ error: null });
}
