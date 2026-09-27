import { useMemo } from "react";
import { useAppStore } from "../../app/store";
import { getActiveEditor } from "../editor/activeEditor";
import { editNote } from "../files/editNote";
import { HandwritingDialog } from "./HandwritingDialog";

// The handwriting pad for a note: the text goes in at the cursor (on its own lines), or
// at the end of the note if it isn't open in the editor.

export function NoteHandwriting({ path, onClose }: { path: string; onClose(): void }) {
  const sources = useMemo(() => [path], [path]);
  const insert = async (text: string) => {
    const active = getActiveEditor();
    if (active?.path === path) {
      const { view } = active;
      const { from, to } = view.state.selection.main;
      const line = view.state.doc.lineAt(from);
      const before = view.state.sliceDoc(line.from, from).trim() ? "\n" : "";
      const after = view.state.sliceDoc(to, view.state.doc.lineAt(to).to).trim() ? "\n" : "";
      const insert = before + text + after;
      view.dispatch({
        changes: { from, to, insert },
        selection: { anchor: from + insert.length - after.length },
        scrollIntoView: true,
      });
      view.focus();
      return;
    }
    await editNote(path, (doc) => `${doc.replace(/\s*$/, "")}\n\n${text}\n`);
    useAppStore.getState().notify("Handwriting added to the note.");
  };
  return (
    <HandwritingDialog
      sources={sources}
      insertLabel="Insert into note"
      onInsert={insert}
      onClose={onClose}
    />
  );
}
