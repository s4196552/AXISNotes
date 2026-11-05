import type { EditorView } from "@codemirror/view";

// The editor currently showing a note, so commands (templates, palette) can edit it. With
// split panes, it's the focused pane's.

let current: { view: EditorView; path: string } | null = null;

export function setActiveEditor(view: EditorView | null, path?: string) {
  current = view && path ? { view, path } : null;
}

/** Forget `view` if it's the active editor (another pane's may be active by now). */
export function clearActiveEditor(view: EditorView | null) {
  if (current && (!view || current.view === view)) current = null;
}

export function getActiveEditor() {
  return current;
}

// ---- The same note open in two panes ----

type SavedListener = (path: string, from: EditorView) => void;
const savedListeners = new Set<SavedListener>();

/** An editor wrote `path`: the others showing it reload (or warn, if they have edits). */
export function noteSaved(path: string, from: EditorView) {
  for (const l of savedListeners) l(path, from);
}

export function onNoteSaved(listener: SavedListener) {
  savedListeners.add(listener);
  return () => void savedListeners.delete(listener);
}
