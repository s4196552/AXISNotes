import { forwardRef, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { dailyDateOf, openDailyNote } from "../commands/actions";
import { renameEntry } from "../files/renameEntry";
import { requestEditorFocus, takeEditorFocus } from "./focusRequest";
import { DAILY_TITLE_FORMAT, titleOf } from "./titleHeading";

/** Characters a note name can't hold (Windows rules, plus `/` which would move it). */
const INVALID = /[\\/:*?"<>|]/;
/** The date a path's daily note is for, or null when it isn't a daily note. */
function useDailyDate(path: string): Date | null {
  const cfg = useConfig((s) => s.config.dailyNotes);
  return dailyDateOf(path, cfg);
}

interface NoteTitleProps {
  path: string;
  /** Write unsaved edits first; false when they couldn't be saved (don't rename then). */
  beforeRename(): Promise<boolean>;
  /** Put the cursor in the note's text. */
  focusBody(): void;
}

/**
 * The note's title, edited in place: Enter or leaving the field renames the file (links
 * follow, as with a rename in the file tree). Daily notes show their date instead, with
 * buttons for the day before and after, since renaming one would stop it being a daily note.
 */
export const NoteTitle = forwardRef<HTMLInputElement, NoteTitleProps>(function NoteTitle(
  { path, beforeRename, focusBody },
  ref,
) {
  const name = titleOf(path);
  const [draft, setDraft] = useState(name);
  const busy = useRef(false);
  const daily = useDailyDate(path);

  if (daily) {
    const step = (days: number) => {
      const d = new Date(daily);
      d.setDate(d.getDate() + days);
      void openDailyNote(d);
    };
    return (
      <div className="editor-title-row">
        <h1 className="editor-title" title={`${name}.md`}>
          {formatDate(daily, DAILY_TITLE_FORMAT)}
        </h1>
        <button
          className="editor-tool editor-day"
          aria-label="Previous day"
          title="Previous day"
          onClick={() => step(-1)}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          className="editor-tool editor-day"
          aria-label="Next day"
          title="Next day"
          onClick={() => step(1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    );
  }

  /** Rename to the draft; true once the file has a new name (the editor then remounts). */
  const commit = async (thenFocusBody: boolean): Promise<boolean> => {
    const next = draft.trim();
    if (next === name || busy.current) return false;
    const store = useAppStore.getState();
    if (!next || INVALID.test(next) || next.startsWith(".")) {
      setDraft(name);
      if (next) store.setError(`A note name can't start with "." or contain \\ / : * ? " < > |`);
      return false;
    }
    const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
    const to = `${dir}${next}.md`;
    const clash = store.notes.some(
      (n) => n.path.toLowerCase() === to.toLowerCase() && n.path !== path,
    );
    if (clash) {
      setDraft(name);
      store.setError(`A note named "${next}" already exists in this folder.`);
      return false;
    }
    busy.current = true;
    try {
      if (!(await beforeRename())) {
        setDraft(name);
        return false;
      }
      if (thenFocusBody) requestEditorFocus(to, "body");
      await renameEntry(path, to);
      return true;
    } catch (e) {
      takeEditorFocus(to);
      setDraft(name);
      store.setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      busy.current = false;
    }
  };

  return (
    <input
      ref={ref}
      className="editor-title"
      aria-label="Note title"
      placeholder="Untitled"
      spellCheck={false}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit(false)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "ArrowDown") {
          e.preventDefault();
          // A rename remounts the editor on the new path, which takes the focus request.
          void commit(true).then((renamed) => renamed || focusBody());
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(name);
          focusBody();
        }
      }}
    />
  );
});
