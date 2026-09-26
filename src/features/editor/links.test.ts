import { CompletionContext } from "@codemirror/autocomplete";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { yamlFrontmatter } from "@codemirror/lang-yaml";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import type { NoteRef } from "../../ipc";
import {
  buildLinkDecorations,
  frontmatterEnd,
  type LinkHost,
  linkHost,
  wikilinkCompletions,
} from "./links";
import { findTarget, isKnownTarget, minimalChange } from "./targets";
import { convert, inferType } from "./propTypes";

const notes: NoteRef[] = [
  { path: "Project Alpha.md", name: "Project Alpha", title: null, aliases: ["PA"] },
  { path: "Work/Plan.md", name: "Plan", title: "Plan", aliases: [] },
];

function stateFor(doc: string, cursorLine = 1) {
  const host: LinkHost = {
    openLink: () => {},
    openTag: () => {},
    isKnown: (t) => isKnownTarget(notes, t),
    notes: () => notes,
  };
  let state = EditorState.create({
    doc,
    extensions: [
      yamlFrontmatter({ content: markdown({ base: markdownLanguage }) }),
      linkHost.of(host),
    ],
  });
  state = state.update({
    selection: EditorSelection.cursor(state.doc.line(cursorLine).from),
  }).state;
  // Parse fully up front so results don't depend on the parser's time budget.
  ensureSyntaxTree(state, state.doc.length, 10_000);
  return state;
}

function decorations(doc: string, cursorLine = 1) {
  const state = stateFor(doc, cursorLine);
  const out: { from: number; text: string; cls?: string; attrs?: Record<string, string> }[] = [];
  buildLinkDecorations(state).between(0, state.doc.length, (from, to, d: Decoration) => {
    const spec = d.spec as { class?: string; attributes?: Record<string, string> };
    out.push({ from, text: state.sliceDoc(from, to), cls: spec.class, attrs: spec.attributes });
  });
  // Overlapping ranges live in separate layers, so restore document order.
  return out.sort((a, b) => a.from - b.from).map(({ from: _from, ...rest }) => rest);
}

describe("link decorations", () => {
  it("renders wikilinks away from the cursor, hiding brackets and alias targets", () => {
    const d = decorations("x\nsee [[Project Alpha]] and [[Work/Plan|the plan]] and [[Nope]]", 1);
    const hidden = d.filter((x) => !x.cls).map((x) => x.text);
    expect(hidden).toEqual(["[[", "]]", "[[", "Work/Plan|", "]]", "[[", "]]"]);
    const links = d.filter((x) => x.cls?.includes("wikilink"));
    expect(links.map((x) => [x.text, x.cls])).toEqual([
      ["Project Alpha", "cm-lp-wikilink"],
      ["Work/Plan|the plan", "cm-lp-wikilink"],
      ["Nope", "cm-lp-wikilink cm-lp-unresolved"],
    ]);
    expect(links[1]!.attrs).toEqual({ "data-wikilink": "Work/Plan|the plan" });
  });

  it("keeps raw syntax on the cursor line and ignores code and frontmatter", () => {
    expect(decorations("[[Plan]]", 1).filter((x) => !x.cls)).toEqual([]);
    const d = decorations(
      '---\nlink: "[[Plan]]"\ntags: [a]\n---\n`[[Plan]]` #tag\n```\n#no [[Plan]]\n```',
      5,
    );
    expect(d.map((x) => [x.text, x.cls])).toEqual([["#tag", "cm-lp-tag"]]);
  });

  it("marks tags with their lowercase name", () => {
    const d = decorations("x\n#Work/Alpha and (#b) but not a#c or #123", 1);
    expect(d.map((x) => [x.text, x.attrs?.["data-tag"]])).toEqual([
      ["#Work/Alpha", "work/alpha"],
      ["#b", "b"],
    ]);
  });

  it("finds the end of the frontmatter", () => {
    expect(frontmatterEnd(stateFor("---\na: 1\n---\nbody"))).toBe("---\na: 1\n---".length);
    expect(frontmatterEnd(stateFor("body"))).toBe(0);
  });
});

describe("[[ autocomplete", () => {
  function complete(doc: string) {
    const state = stateFor(doc);
    return wikilinkCompletions(new CompletionContext(state, doc.length, false));
  }

  it("offers notes and aliases after [[", () => {
    const r = complete("see [[pro")!;
    expect(r.from).toBe(6);
    expect(r.options.map((o) => [o.label, o.detail])).toEqual([
      ["Project Alpha", ""],
      ["PA", "→ Project Alpha"],
      ["Plan", "Work"],
    ]);
    expect(complete("no link here")).toBeNull();
    expect(complete("[[Plan|alias")).toBeNull();
  });
});

describe("targets", () => {
  it("finds headings, block ids and lines", () => {
    const s = EditorState.create({ doc: "# Top\ntext\n## Goals ##\npara ^b1\nend" });
    expect(findTarget(s, { heading: "goals" })).toBe(s.doc.line(3).from);
    expect(findTarget(s, { block: "b1" })).toBe(s.doc.line(4).from);
    expect(findTarget(s, { line: 99 })).toBe(s.doc.line(5).from);
    expect(findTarget(s, { heading: "missing" })).toBeNull();
  });

  it("knows note names, paths, partial paths and aliases", () => {
    expect(isKnownTarget(notes, "project alpha")).toBe(true);
    expect(isKnownTarget(notes, "Plan.md")).toBe(true);
    expect(isKnownTarget(notes, "Plan#Goals".split("#")[0]!)).toBe(true);
    expect(isKnownTarget(notes, "pa")).toBe(true);
    expect(isKnownTarget(notes, "Other/Plan")).toBe(false);
    expect(isKnownTarget(notes, "Missing")).toBe(false);
  });

  it("computes minimal changes", () => {
    expect(minimalChange("---\na: 1\n---\nbody", "---\na: 2\n---\nbody")).toEqual({
      from: 7,
      to: 8,
      insert: "2",
    });
    expect(minimalChange("same", "same")).toEqual({ from: 4, to: 4, insert: "" });
  });
});

describe("property types", () => {
  it("infers and converts types", () => {
    expect([true, 3, ["a"], "2026-09-26", "hi"].map(inferType)).toEqual([
      "checkbox",
      "number",
      "list",
      "date",
      "text",
    ]);
    expect(convert("a, b", "list")).toEqual(["a", "b"]);
    expect(convert(["a", "b"], "text")).toBe("a, b");
    expect(convert("12", "number")).toBe(12);
    expect(convert("x", "number")).toBe(0);
    expect(convert("true", "checkbox")).toBe(true);
    expect(convert("2026-01-02", "date")).toBe("2026-01-02");
  });
});
