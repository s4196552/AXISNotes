// Where focus should go when a note's editor next opens: the title (a new note, so it
// can be named straight away) or the text (after renaming from the title).

export type FocusTarget = "title" | "body";

let pending: { path: string; target: FocusTarget } | null = null;

export function requestEditorFocus(path: string, target: FocusTarget) {
  pending = { path, target };
}

/** The request for `path`, if any; it is used up. */
export function takeEditorFocus(path: string): FocusTarget | null {
  if (pending?.path !== path) return null;
  const { target } = pending;
  pending = null;
  return target;
}
