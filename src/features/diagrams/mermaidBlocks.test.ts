import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mermaidBlocks } from "./mermaidBlocks";

vi.mock("./mermaid", () => ({
  isDarkTheme: () => false,
  renderMermaid: (code: string) =>
    code.includes("bad")
      ? Promise.reject(new Error("Parse error on line 2"))
      : Promise.resolve(`<svg data-testid="svg"><text>${code}</text></svg>`),
}));

const DOC = "Intro\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nAfter\n\n```js\nx\n```\n";
let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function open(doc: string, cursor = 0) {
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: cursor },
      extensions: [markdown({ base: markdownLanguage }), mermaidBlocks],
    }),
  });
  return view;
}

describe("Mermaid blocks in the editor", () => {
  it("renders ```mermaid blocks (only) as diagrams", async () => {
    const v = open(DOC);
    await vi.waitFor(() => expect(v.dom.querySelectorAll(".cm-mermaid svg")).toHaveLength(1));
    expect(v.dom.querySelector(".cm-mermaid")!.textContent).toBe("flowchart TD\n  A --> B");
    expect(v.contentDOM.textContent).not.toContain("```mermaid");
    expect(v.contentDOM.textContent).toContain("```js");
  });

  it("shows the code while the cursor is in the block", () => {
    const v = open(DOC, DOC.indexOf("A -->"));
    expect(v.dom.querySelector(".cm-mermaid")).toBeNull();
    expect(v.contentDOM.textContent).toContain("```mermaid");
    v.dispatch({ selection: { anchor: 0 } });
    expect(v.dom.querySelector(".cm-mermaid")).not.toBeNull();
  });

  it("opens the source from the diagram and leaves surrounding space inactive", async () => {
    const v = open(DOC);
    await vi.waitFor(() => expect(v.dom.querySelector(".cm-mermaid svg")).not.toBeNull());
    const block = v.dom.querySelector(".cm-mermaid")!;
    fireEvent.mouseDown(block, { button: 0 });
    expect(v.contentDOM.textContent).not.toContain("```mermaid");
    fireEvent.mouseDown(block.querySelector("svg")!, { button: 0 });
    expect(v.contentDOM.textContent).toContain("```mermaid");
    v.dispatch({ selection: { anchor: 0 } });
    expect(v.contentDOM.textContent).not.toContain("```mermaid");
  });

  it("previews a drag, persists the fence width on release, and cancels with Escape", async () => {
    const v = open(DOC.replace("mermaid", "mermaid width=300"));
    await vi.waitFor(() => expect(v.dom.querySelector(".cm-mermaid svg")).not.toBeNull());
    const frame = () => v.dom.querySelector<HTMLElement>(".cm-mermaid-frame")!;
    const handle = () => frame().querySelector('[data-handle="se"]')!;
    expect(frame().style.width).toBe("300px");
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 360 });
    expect(frame().style.width).toBe("360px");
    expect(v.state.doc.line(3).text).toBe("```mermaid width=300");
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 360 });
    expect(v.state.doc.line(3).text).toBe("```mermaid width=360");
    expect(frame().style.width).toBe("360px");
    fireEvent.pointerDown(handle(), { button: 0, pointerId: 1, clientX: 360 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 410 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 410 });
    expect(frame().style.width).toBe("360px");
    expect(v.state.doc.toString()).toBe(DOC.replace("mermaid", "mermaid width=360"));
  });

  it("shows Mermaid's error for an invalid diagram", async () => {
    const doc = "```mermaid\nflowchart TD\n  bad -->\n```\n\nx";
    const v = open(doc, doc.length);
    await vi.waitFor(() =>
      expect(v.dom.querySelector(".cm-mermaid-error")?.textContent).toContain("Parse error"),
    );
  });
});
