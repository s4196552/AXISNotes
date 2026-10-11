import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { freezeEditing, saveBeforeExit, unsavedChanges } from "./beforeExit";

// Closing the window (T-074): save every open document first. If anything can't be saved
// (an unresolved conflict, a moved file, a failed write), stay open and say which notes.
// Closing again soon after still saves everything it can, then quits without the rest, so
// a failing disk can't trap the user.

/** A second close within this long after a refusal quits without what can't be saved. */
export const CLOSE_AGAIN_MS = 15_000;

let refusedAt = -Infinity;
let busy = false;

const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));

async function close() {
  try {
    await backend.closeWindow();
  } catch (e) {
    freezeEditing(false);
    useAppStore.getState().setError(`Couldn’t close the window: ${message(e)}`);
  }
}

/** Handle one close request (the window's close button, Alt+F4, …). */
export async function onCloseRequested(): Promise<void> {
  if (busy) return; // already saving for an earlier request
  busy = true;
  try {
    const unsaved = await saveBeforeExit();
    const quitAnyway = Date.now() - refusedAt < CLOSE_AGAIN_MS;
    if (unsaved.length === 0 || quitAnyway) {
      freezeEditing(true);
      return await close();
    }
    refusedAt = Date.now();
    const { sentence, them } = unsavedChanges(unsaved);
    useAppStore
      .getState()
      .setError(
        `Not closed, so no edits are lost. ${sentence} Resolve ${them}, or close again to quit without saving ${them}.`,
      );
  } catch (e) {
    useAppStore.getState().setError(`Couldn’t save before closing: ${message(e)}`);
  } finally {
    busy = false;
  }
}

/** Start guarding the window's close; returns the function that stops it. */
export function guardWindowClose(): () => void {
  let unlisten: (() => void) | undefined;
  let stopped = false;
  void backend
    .onCloseRequested(() => void onCloseRequested())
    .then((u) => {
      if (stopped) u();
      else unlisten = u;
    });
  return () => {
    stopped = true;
    unlisten?.();
  };
}

/** For tests. */
export function resetCloseGuard() {
  refusedAt = -Infinity;
  busy = false;
}
