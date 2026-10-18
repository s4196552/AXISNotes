import { FilePlus, Search, X } from "lucide-react";
import { useAppStore } from "../../app/store";
import { newNote } from "../commands/actions";
import { useUi } from "../commands/ui";

/** What an empty tab shows, like Obsidian's "New tab". */
export function NewTab() {
  return (
    <div className="new-tab">
      <div className="new-tab-actions">
        <button onClick={() => void newNote()}>
          <FilePlus size={15} aria-hidden /> Create new note <kbd>Ctrl+N</kbd>
        </button>
        <button onClick={() => useUi.getState().open({ kind: "switcher" })}>
          <Search size={15} aria-hidden /> Open a note <kbd>Ctrl+O</kbd>
        </button>
        <button onClick={() => useAppStore.getState().closeTab()}>
          <X size={15} aria-hidden /> Close tab <kbd>Ctrl+W</kbd>
        </button>
      </div>
    </div>
  );
}
