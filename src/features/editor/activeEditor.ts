import type { EditorView } from "@codemirror/view";

// The editor currently showing a note, so commands (templates, palette) can edit it.

let current: { view: EditorView; path: string } | null = null;

export function setActiveEditor(view: EditorView | null, path?: string) {
  current = view && path ? { view, path } : null;
}

export function getActiveEditor() {
  return current;
}
