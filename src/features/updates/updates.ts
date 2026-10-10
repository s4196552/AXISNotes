import { create } from "zustand";
import { type AvailableUpdate, backend, isBackendError } from "../../ipc";
import { describeUnsaved, preserveEdits, saveAll } from "../files/unsavedWork";

// Updates from a folder (T-066): what the last check found, and installing it.

const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));

/** While installing, nothing in the window can be focused or edited (T-073): every edit
 *  made before this point gets saved, and none can start after it. */
function freezeEditing(on: boolean) {
  preserveEdits(on); // first: blurring starts saves, which must not reload over edits
  document.body.toggleAttribute("inert", on);
  if (on && document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

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
    freezeEditing(true);
    try {
      // Installing closes the app: save every open document first, and don't install
      // while any change can't be saved (e.g. a note with an unresolved conflict).
      // Let edits committed by that blur (a grid cell, a canvas text) reach their
      // documents first: some arrive through React or Excalidraw a moment later.
      await new Promise((r) => setTimeout(r, 0));
      const unsaved = await saveAll();
      if (unsaved.length > 0) {
        freezeEditing(false);
        set({
          installing: false,
          error:
            `Not installed, so no edits are lost. Unsaved changes in ${describeUnsaved(unsaved)}. ` +
            `Resolve ${unsaved.length === 1 ? "it" : "them"}, then try again.`,
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
