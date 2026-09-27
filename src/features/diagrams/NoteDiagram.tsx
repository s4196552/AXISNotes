import { useAppStore } from "../../app/store";
import { getActiveEditor } from "../editor/activeEditor";
import { editNote } from "../files/editNote";
import { DiagramMaker, type DiagramResult } from "./DiagramMaker";

// The diagram maker for a note: the Mermaid block goes on its own lines after the cursor
// or selection (the selection is kept), or at the end if the note isn't open.

export function NoteDiagram(props: { path: string; selection?: string; onClose(): void }) {
  const { path } = props;
  const insert = async (result: DiagramResult) => {
    if (!("mermaid" in result)) return;
    const block = "```mermaid\n" + result.mermaid + "\n```";
    const active = getActiveEditor();
    if (active?.path === path) {
      const { view } = active;
      const line = view.state.doc.lineAt(view.state.selection.main.to);
      const before = line.text.trim() ? "\n\n" : "";
      const insert = `${before}${block}\n`;
      view.dispatch({
        changes: { from: line.to, insert },
        selection: { anchor: line.to + insert.length },
        scrollIntoView: true,
      });
      view.focus();
      return;
    }
    await editNote(path, (doc) => `${doc.replace(/\s*$/, "")}\n\n${block}\n`);
    useAppStore.getState().notify("Diagram added to the note.");
  };
  return <DiagramMaker target="note" {...props} onInsert={insert} />;
}
