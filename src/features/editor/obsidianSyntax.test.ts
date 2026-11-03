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

  it("draws a callout as a box: title line, inside, and the raw type while editing", () => {
    const d = decos("> [!warning] Careful\n> body\n\nafter", 0);
    expect(d).toEqual([
      "cm-callout cm-callout-warning cm-callout-title:",
      "cm-callout-type:[!warning]",
      "cm-callout cm-callout-warning cm-callout-body-first cm-callout-last:",
    ]);
    // Off the title line, `[!type] ` gives way to the type's icon.
    expect(decos("> [!warning] Careful\n> body\n\nafter")).toContain("hide:[!warning] ");
    // A title-only callout is a single-line box; a toggle is left to toggles.ts.
    expect(decos("> [!tip]+ Short\n\nafter")).toEqual([
      "cm-callout cm-callout-tip cm-callout-title cm-callout-last:",
      "hide:[!tip]+ ",
    ]);
    expect(decos("> [!toggle]+ Mine\n> inside\n\nafter")).toEqual([]);
  });

  it("draws the title, not raw Markdown, while the editor is unfocused", () => {
    const doc = "> [!warning] Careful\n> body\n\nafter";
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(0) });
    const found: string[] = [];
    buildObsidian(state, [{ from: 0, to: doc.length }], false).between(0, doc.length, (f, t, d) => {
      found.push((d.spec as { class?: string }).class ?? `hide:${state.sliceDoc(f, t)}`);
    });
    expect(found).toContain("hide:[!warning] ");
    expect(found).not.toContain("cm-callout-type");
  });

  it("decorates only the visible lines of a long callout", () => {
    const doc = ["> [!note] Long", ...Array.from({ length: 50 }, (_, i) => `> line ${i}`)].join(
      "\n",
    );
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(0) });
    const from = state.doc.line(20).from;
    const to = state.doc.line(24).to;
    const lines = new Set<number>();
    buildObsidian(state, [{ from, to }]).between(0, doc.length, (f) => {
      lines.add(state.doc.lineAt(f).number);
    });
    expect([...lines]).toEqual([20, 21, 22, 23, 24]);
  });

  it("names an untitled callout after its type, with the type's icon", () => {
    const doc = "> [!faq]\n> body\n\nafter";
    const state = EditorState.create({ doc, selection: EditorSelection.cursor(doc.length) });
    const widgets: { kind: string; label: string }[] = [];
    buildObsidian(state, [{ from: 0, to: doc.length }]).between(0, doc.length, (_f, _t, d) => {
      const w = (d.spec as { widget?: { kind: string; label: string } }).widget;
      if (w) widgets.push({ kind: w.kind, label: w.label });
    });
    expect(widgets).toEqual([{ kind: "question", label: "Faq" }]);
  });

  it("knows Obsidian's callout types and their other names", () => {
    expect(calloutKind("TIP")).toBe("tip");
    expect(calloutKind("abstract")).toBe("abstract");
    expect(calloutKind("tldr")).toBe("abstract");
    expect(calloutKind("error")).toBe("danger");
    expect(calloutKind("cite")).toBe("quote");
    expect(calloutKind("whatever")).toBe("note");
  });
});
