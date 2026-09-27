import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
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

  it("shows Mermaid's error for an invalid diagram", async () => {
    const doc = "```mermaid\nflowchart TD\n  bad -->\n```\n\nx";
    const v = open(doc, doc.length);
    await vi.waitFor(() =>
      expect(v.dom.querySelector(".cm-mermaid-error")?.textContent).toContain("Parse error"),
    );
  });
});
