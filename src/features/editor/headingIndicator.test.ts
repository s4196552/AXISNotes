import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { afterEach, describe, expect, it } from "vitest";
import {
  activeHeading,
  headingIndicator,
  indicatorHeadings,
  lineWidth,
  LEFT_ROOM,
  LINE_WIDTHS,
  MIN_ROOM,
  placement,
} from "./headingIndicator";

const stateOf = (doc: string) => EditorState.create({ doc, extensions: [markdown()] });

describe("heading indicator (T-254)", () => {
  it("counts depth from the note's biggest heading, whatever its level", () => {
    const hs = indicatorHeadings(
      stateOf("#### Plan\n\ntext\n\n##### Step one\n\n###### Detail\n\n#### Review\n"),
    );
    expect(hs.map((h) => [h.title, h.depth])).toEqual([
      ["Plan", 0],
      ["Step one", 1],
      ["Detail", 2],
      ["Review", 0],
    ]);
    // The biggest heading always gets the longest line; deeper ones get shorter lines.
    expect(lineWidth(0)).toBe(LINE_WIDTHS[0]);
    expect(lineWidth(1)).toBeLessThan(lineWidth(0));
    expect(lineWidth(9)).toBe(LINE_WIDTHS[LINE_WIDTHS.length - 1]);
  });

  it("leaves out headings in code blocks and frontmatter-like text", () => {
    const hs = indicatorHeadings(stateOf("# One\n\n```\n# not a heading\n```\n\n## Two\n"));
    expect(hs.map((h) => h.title)).toEqual(["One", "Two"]);
  });

  it("fits the margin between the text and the scrollbar (T-258)", () => {
    // Both side panels open: 24 px between the text and a 10 px scrollbar.
    expect(placement(24, 10)).toBe(10);
    // More room: centred in it.
    expect(placement(64, 10)).toBe(30);
    // Too little room: hidden.
    expect(placement(MIN_ROOM - 1, 10)).toBeNull();
  });

  it("finds the section holding a position", () => {
    const hs = [
      { from: 10, title: "A", depth: 0 },
      { from: 50, title: "B", depth: 1 },
    ];
    expect(activeHeading(hs, 0)).toBe(0);
    expect(activeHeading(hs, 49)).toBe(0);
    expect(activeHeading(hs, 50)).toBe(1);
    expect(activeHeading([], 5)).toBe(-1);
  });

  describe("in the editor", () => {
    let view: EditorView | null = null;
    afterEach(() => {
      view?.destroy();
      view = null;
    });
    const mount = (doc: string, side?: "left" | "right") => {
      view = new EditorView({
        state: EditorState.create({ doc, extensions: [markdown(), headingIndicator(side)] }),
        parent: document.body,
      });
      return view;
    };

    it("draws a line per heading and lists them; picking one moves there", () => {
      const v = mount("# Title\n\nIntro\n\n## Part\n\nBody\n\n### Small\n");
      const nav = v.dom.querySelector<HTMLElement>("nav.cm-heading-indicator")!;
      expect(nav).toHaveAttribute("aria-label", "Headings in this note");
      const lines = [...nav.querySelectorAll<HTMLElement>(".cm-heading-line")];
      expect(lines.map((l) => l.style.width)).toEqual(["16px", "12px", "9px"]);
      const items = [...nav.querySelectorAll("button")];
      expect(items.map((b) => b.textContent)).toEqual(["Title", "Part", "Small"]);
      items[1]!.click();
      expect(v.state.selection.main.head).toBe(v.state.doc.toString().indexOf("## Part"));
    });

    it("sits on the right by default and on the left when chosen (T-265)", () => {
      const right = mount("# One\n\n## Two\n");
      const r = right.dom.querySelector<HTMLElement>("nav.cm-heading-indicator")!;
      expect(r).toHaveClass("cm-heading-indicator-right");
      expect(r.style.left).toBe("");
      right.destroy();
      const left = mount("# One\n\n## Two\n", "left");
      const l = left.dom.querySelector<HTMLElement>("nav.cm-heading-indicator")!;
      expect(l).toHaveClass("cm-heading-indicator-left");
      expect(l).not.toHaveClass("cm-heading-indicator-right");
      // The left side widens the note's start margin for the rail; the right side doesn't.
      expect(left.dom).toHaveClass("cm-heading-side-left");
      expect(right.dom).not.toHaveClass("cm-heading-side-left");
      expect(LEFT_ROOM).toBeGreaterThanOrEqual(MIN_ROOM);
      // Same plugin for the same side, so reconfiguring doesn't rebuild it needlessly.
      expect(headingIndicator("left")).toBe(headingIndicator("left"));
      expect(headingIndicator()).not.toBe(headingIndicator("left"));
    });

    it("follows edits and goes away when the plugin is turned off", () => {
      const v = mount("# One\n");
      v.dispatch({ changes: { from: v.state.doc.length, insert: "\n## Two\n" } });
      const nav = v.dom.querySelector("nav.cm-heading-indicator")!;
      expect([...nav.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["One", "Two"]);
      v.destroy();
      view = null;
      expect(document.querySelector("nav.cm-heading-indicator")).toBeNull();
    });
  });
});
