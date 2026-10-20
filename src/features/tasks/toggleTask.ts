import { isBackendError, type TaskRef } from "../../ipc";
import { useAppStore } from "../../app/store";
import { setTaskDone } from "../../lib/tasks";
import { editNote } from "../files/editNote";

/**
 * Tick a task off (or reopen it) in its note. The line must still be the one indexed; if it
 * changed, nothing is written and the index is refreshed. Errors go to the status bar.
 */
export async function toggleTask(task: TaskRef, today: string): Promise<void> {
  try {
    const changed = await editNote(task.path, (text) => {
      const lines = text.split("\n");
      const current = lines[task.line - 1];
      if (current === undefined || current.replace(/\r$/, "") !== task.raw) return null;
      const cr = current.endsWith("\r") ? "\r" : "";
      lines[task.line - 1] = setTaskDone(task.raw, !task.done, today) + cr;
      return lines.join("\n");
    });
    if (!changed) {
      useAppStore.getState().notify("That task changed in its note; the list was refreshed.");
      useAppStore.getState().bumpIndex();
    }
  } catch (e) {
    useAppStore.getState().setError(isBackendError(e) ? e.message : String(e));
  }
}
