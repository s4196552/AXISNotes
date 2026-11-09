import { foldState } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { toggleCurrentFold } from "../editor/toggles";

export function contextFold(
  target: Element | null = document.activeElement,
): (() => void) | undefined {
  if (!target?.isConnected || target.closest('input, textarea, select, [role="dialog"]')) return;
  if (target instanceof HTMLElement && target.matches('.filetree-body[role="tree"]')) {
    const row = document.getElementById(target.getAttribute("aria-activedescendant") ?? "");
    const folder = row?.hasAttribute("aria-expanded")
      ? row
      : document.getElementById(row?.dataset.parentRow ?? "");
    if (folder && target.contains(folder))
      return () => {
        target.focus();
        folder.click();
      };
    return;
  }

  const section = target.closest(".sidebar-right section");
  const header = section?.querySelector<HTMLButtonElement>(".side-section-toggle");
  if (header)
    return () => {
      header.focus();
      header.click();
    };

  const content = target.closest<HTMLElement>(".cm-content");
  const editor = content?.closest<HTMLElement>(".cm-editor");
  const view = editor && EditorView.findFromDOM(editor);
  if (!view || !view.state.field(foldState, false)) return;
  const arrow = target.closest<HTMLElement>("[data-fold-line]");
  if (
    target !== content &&
    !arrow &&
    target.closest('button, [role="button"], [contenteditable="false"]')
  )
    return;
  return () => {
    // A focused arrow may be on a different line than the last text selection.
    if (arrow) view.dispatch({ selection: { anchor: Number(arrow.dataset.foldLine) } });
    view.focus();
    toggleCurrentFold(view);
  };
}
