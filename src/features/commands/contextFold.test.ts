import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, expect, it } from "vitest";
import { setActiveEditor } from "../editor/activeEditor";
import { outlineFolding } from "../editor/outliner";
import { toggles, viewFolds } from "../editor/toggles";
import { pageFold } from "./contextFold";

const views: EditorView[] = [];
afterEach(() => {
  setActiveEditor(null);
  views.splice(0).forEach((v) => v.destroy());
  document.body.replaceChildren();
});

function editor(doc: string) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc, extensions: [markdown(), outlineFolding, toggles] }),
  });
  views.push(view);
  return view;
}

it("targets the active note instead of a focused embedded editor", () => {
  const main = editor("# Main\nText\n\n# Other\nMore");
  const embedded = editor("> [!toggle]+ Source\n> Content");
  setActiveEditor(main, "Main.md");
  embedded.focus();
  pageFold(embedded.contentDOM)?.();
  expect(viewFolds(main.state)).toHaveLength(2);
  expect(viewFolds(embedded.state)).toEqual([]);
  expect(embedded.state.doc.toString()).toBe("> [!toggle]+ Source\n> Content");
  expect(main.hasFocus).toBe(true);
});

it("ignores text fields, dialogs and disconnected targets or notes", () => {
  const main = editor("# Main\nText");
  setActiveEditor(main, "Main.md");
  const input = document.createElement("input");
  document.body.append(input);
  expect(pageFold(input)).toBeUndefined();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  const button = document.createElement("button");
  dialog.append(button);
  document.body.append(dialog);
  expect(pageFold(button)).toBeUndefined();
  expect(pageFold(document.createElement("div"))).toBeUndefined();
  main.dom.remove();
  expect(pageFold(document.body)).toBeUndefined();
});

it("uses the active pane from the sidebar and does nothing without a note", () => {
  expect(pageFold(document.body)).toBeUndefined();
  const first = editor("# First\nText");
  const second = editor("# Second\nText");
  setActiveEditor(second, "Second.md");
  pageFold(document.body)?.();
  expect(viewFolds(first.state)).toEqual([]);
  expect(viewFolds(second.state)).toHaveLength(1);
});
