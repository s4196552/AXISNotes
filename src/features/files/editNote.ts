import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { getActiveEditor } from "../editor/activeEditor";
import { minimalChange } from "../editor/targets";

/**
 * Change a note's text from outside its editor (task toggles, timers). If the note is
 * open in the editor, the change goes through the editor (so it autosaves and joins
 * undo history); otherwise the file is rewritten with an on-disk change check.
 *
 * `edit` returns the new text, or null to leave the note untouched (e.g. when the text
 * no longer matches what the caller expected). Resolves to whether the note changed.
 */
export async function editNote(
  path: string,
  edit: (text: string) => string | null,
): Promise<boolean> {
  const active = getActiveEditor();
  if (active?.path === path) {
    const view = active.view;
    const text = view.state.doc.toString();
    const next = edit(text);
    if (next === null || next === text) return false;
    view.dispatch({ changes: minimalChange(text, next) });
    return true;
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const file = await backend.readFile(path);
    const next = edit(file.content);
    if (next === null || next === file.content) return false;
    try {
      await backend.writeFile(path, next, file.modifiedMs);
      useAppStore.getState().bumpIndex();
      return true;
    } catch (e) {
      // Changed between our read and write: re-read and re-apply once.
      if (!(isBackendError(e) && e.code === "Conflict")) throw e;
    }
  }
  throw new Error(`${path} keeps changing on disk; try again.`);
}
