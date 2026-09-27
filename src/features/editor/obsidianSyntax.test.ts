import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { buildObsidian, calloutKind } from "./obsidianSyntax";

function decos(doc: string, cursor = doc.length) {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  });
  const out: string[] = [];
  buildObsidian(state, [{ from: 0, to: doc.length }]).between(
    0,
    doc.length,
    (f, t, d: Decoration) => {
      const cls = (d.spec as { class?: string }).class ?? "hide";
      out.push(`${cls}:${state.sliceDoc(f, t)}`);
    },
  );
  return out;
}

describe("Obsidian syntax", () => {
  it("highlights ==text== and hides the markers off the active line", () => {
    expect(decos("a ==big== b\n\nend")).toEqual(["hide:==", "cm-lp-highlight:big", "hide:=="]);
    expect(decos("a ==big== b", 3)).toEqual(["cm-lp-highlight:big"]);
    expect(decos("`==code==` and a == b")).toEqual([]);
  });

  it("dims %%comments%%, including across lines", () => {
    expect(decos("x %%hidden\nthought%% y")).toEqual(["cm-lp-comment:%%hidden\nthought%%"]);
  });

  it("styles callouts by type", () => {
    const d = decos("> [!warning] Careful\n> body\n\nafter", 0);
    expect(d).toEqual([
      "cm-callout cm-callout-warning cm-callout-first:",
      "cm-callout-type:[!warning]",
      "cm-callout cm-callout-warning:",
    ]);
    expect(calloutKind("TIP")).toBe("tip");
    expect(calloutKind("abstract")).toBe("note");
  });
});
