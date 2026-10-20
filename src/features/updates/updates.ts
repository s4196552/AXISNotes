import { create } from "zustand";
import { type AvailableUpdate, backend, isBackendError, type UpdateSettings } from "../../ipc";
import { freezeEditing, saveBeforeExit, unsavedChanges } from "../files/beforeExit";

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
    if (!update || get().installing) return;
    set({ installing: true, error: null });
    try {
      // Installing closes the app (T-073): freeze the window and save every open document
      // first, and don't install while any change can't be saved (e.g. a note with an
      // unresolved conflict).
      const unsaved = await saveBeforeExit();
      if (unsaved.length > 0) {
        const { sentence, them } = unsavedChanges(unsaved);
        set({
          installing: false,
          error: `Not installed, so no edits are lost. ${sentence} Resolve ${them}, then try again.`,
        });
        return;
      }
      // On success the app closes while the installer runs, then reopens updated.
      await backend.updatesInstall(update.version);
    } catch (e) {
      freezeEditing(false);
      set({ installing: false, error: message(e) });
    }
  },
  dismiss: () => set({ dismissed: true }),
}));

/** Once per app start: check the updates folder unless that is turned off, and install
 *  what it finds when automatic install is on (the default) and this build can install.
 *  Problems (e.g. an unreachable network folder) stay quiet here; Settings → Updates shows
 *  them. Installing still saves every open document first and refuses over unsaved edits,
 *  showing why in the banner. */
export async function checkOnLaunch() {
  let settings: UpdateSettings;
  try {
    settings = await backend.updatesSettings();
    if (!settings.checkOnLaunch) return;
  } catch {
    return;
  }
  const found = await useUpdates.getState().check();
  if (!found) useUpdates.setState({ error: null });
  else if (settings.autoInstall && settings.canInstall) await useUpdates.getState().install();
}
