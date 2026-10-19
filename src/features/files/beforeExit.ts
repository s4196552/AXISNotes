import { describeUnsaved, saveAll, type UnsavedDocument } from "./unsavedWork";

// Getting ready to close the app — installing an update (T-073) or closing the window
// (T-074): freeze the window, then save every open document.

/** While frozen, nothing in the window can be focused or edited, and the global shortcuts
 *  are ignored: every edit made before this point gets saved, and none can start after. */
export function freezeEditing(on: boolean) {
  document.body.toggleAttribute("inert", on);
  if (on && document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

/**
 * Freeze the window and save everything. Returns what couldn't be saved. The window is
 * unfrozen again then (or if saving throws), and stays frozen — the app is about to
 * close — when everything was saved.
 */
export async function saveBeforeExit(): Promise<UnsavedDocument[]> {
  freezeEditing(true);
  try {
    // Let edits committed by that blur (a grid cell, a canvas text) reach their
    // documents first: some arrive through React or Excalidraw a moment later.
    await new Promise((r) => setTimeout(r, 0));
    const unsaved = await saveAll();
    if (unsaved.length > 0) freezeEditing(false);
    return unsaved;
  } catch (e) {
    freezeEditing(false);
    throw e;
  }
}

/** "Unsaved changes in “Biology” (changed on disk)." plus "it"/"them" for what follows. */
export function unsavedChanges(unsaved: UnsavedDocument[]) {
  return {
    sentence: `Unsaved changes in ${describeUnsaved(unsaved)}.`,
    them: unsaved.length === 1 ? "it" : "them",
  };
}
