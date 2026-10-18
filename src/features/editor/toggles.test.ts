import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { findToggles, flipToggle, toggles } from "./toggles";

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

function viewWith(doc: string, cursor = doc.length) {
  const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown(), toggles],
    }),
  });
  views.push(view);
  return view;
}

const DOC = [
  "Intro",
  "> [!toggle|h2]- Cells",
  "> Nucleus",
  "> Mitochondria",
  "",
  "> [!toggle]+ Open list",
  "> inside",
  "",
  "End",
].join("\n");

describe("toggles", () => {
  it("finds toggles with their level, open state and inside", () => {
    const state = EditorState.create({ doc: DOC, extensions: [markdown()] });
    const found = findToggles(state);
    expect(found.map((t) => [t.level, t.open, state.sliceDoc(t.to + 1, t.bodyTo)])).toEqual([
      [2, false, "> Nucleus\n> Mitochondria"],
      [null, true, "> inside"],
    ]);
  });

  it("ignores ordinary callouts and toggles inside code", () => {
    const doc = [
      "> [!note] Not a toggle",
      "",
      "~~~~",
      "> [!toggle]- in code",
      "~~~",
      "> [!toggle]- still in code",
      "~~~~",
      "> [!toggle]+ After",
    ].join("\n");
    const state = EditorState.create({ doc });
    expect(findToggles(state).map((t) => state.sliceDoc(t.from, t.to))).toEqual([
      "> [!toggle]+ After",
    ]);
  });

  it("hides a closed toggle's inside and draws its title as a heading", () => {
    const view = viewWith(DOC);
    const text = view.contentDOM.textContent ?? "";
    expect(text).not.toContain("Nucleus");
    expect(text).toContain("inside");
    expect(view.contentDOM.querySelector(".cm-toggle-title.cm-lp-h2")?.textContent).toContain(
      "Cells",
    );
    expect(view.contentDOM.querySelectorAll(".cm-toggle-arrow")).toHaveLength(2);
  });

  it("opens and closes by flipping + and - in the note", () => {
    const view = viewWith(DOC);
    const [cells, list] = findToggles(view.state);
    flipToggle(view, cells!.from);
    expect(view.state.doc.line(2).text).toBe("> [!toggle|h2]+ Cells");
    expect(view.contentDOM.textContent).toContain("Nucleus");
    flipToggle(view, list!.from);
    expect(view.state.doc.line(6).text).toBe("> [!toggle]- Open list");
    // No state written yet counts as open; the first click closes it.
    const bare = viewWith("> [!toggle] Plain\n> body");
    flipToggle(bare, 0);
    expect(bare.state.doc.line(1).text).toBe("> [!toggle]- Plain");
  });

  it("opens the arrow with a click", () => {
    const view = viewWith(DOC);
    const arrow = view.contentDOM.querySelector<HTMLElement>(".cm-toggle-arrow")!;
    expect(arrow.getAttribute("aria-expanded")).toBe("false");
    arrow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(view.state.doc.line(2).text).toBe("> [!toggle|h2]+ Cells");
  });

  it("shows a closed toggle's inside while the cursor is in it", () => {
    const view = viewWith(DOC);
    view.dispatch({ selection: { anchor: view.state.doc.line(3).from + 3 } });
    expect(view.contentDOM.textContent).toContain("Nucleus");
  });

  it("shows the Markdown on the title line while it's being edited", () => {
    const view = viewWith(DOC, 0);
    expect(view.contentDOM.textContent).not.toContain("[!toggle|h2]");
    view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
    // Not while the editor is unfocused, like the rest of the live preview.
    expect(view.contentDOM.textContent).not.toContain("[!toggle|h2]");
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.line(2).to } });
    expect(view.contentDOM.textContent).toContain("[!toggle|h2]- Cells");
  });
});
