import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { buildDecorations, CheckboxWidget } from "./livePreview";

interface Found {
  text: string;
  kind: "hide" | "widget" | "mark" | "line";
  cls?: string;
}

/** Build a state with the cursor on `cursorLine` (1-based) and list its decorations. */
function decorate(doc: string, cursorLine = 1): Found[] {
  let state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  state = state.update({
    selection: EditorSelection.cursor(state.doc.line(cursorLine).from),
  }).state;
  const found: Found[] = [];
  buildDecorations(state).between(0, state.doc.length, (from, to, deco: Decoration) => {
    const spec = deco.spec as { class?: string; widget?: unknown };
    const text = state.sliceDoc(from, to);
    if (from === to && spec.class) found.push({ text: "", kind: "line", cls: spec.class });
    else if (spec.widget) found.push({ text, kind: "widget", cls: spec.widget.constructor.name });
    else if (spec.class) found.push({ text, kind: "mark", cls: spec.class });
    else found.push({ text, kind: "hide" });
  });
  return found;
}

const hidden = (f: Found[]) => f.filter((d) => d.kind === "hide").map((d) => d.text);

describe("live preview decorations", () => {
  it("hides heading marks on inactive lines only, but always styles headings", () => {
    const doc = "intro\n## Title";
    expect(hidden(decorate(doc, 1))).toEqual(["## "]);
    expect(hidden(decorate(doc, 2))).toEqual([]);
    for (const line of [1, 2]) {
      expect(decorate(doc, line)).toContainEqual({
        text: "",
        kind: "line",
        cls: "cm-lp-h cm-lp-h2",
      });
    }
  });

  it("hides emphasis, strikethrough and inline-code marks and styles the content", () => {
    const f = decorate("x\n**bold** *it* ~~no~~ `code`", 1);
    expect(hidden(f)).toEqual(["**", "**", "*", "*", "~~", "~~", "`", "`"]);
    expect(f).toContainEqual({ text: "**bold**", kind: "mark", cls: "cm-lp-strong" });
    expect(f).toContainEqual({ text: "`code`", kind: "mark", cls: "cm-lp-code" });
    expect(hidden(decorate("x\n**bold**", 2))).toEqual([]);
  });

  it("shows only the text of links", () => {
    const f = decorate("x\nsee [AXIS](https://axis.app) now", 1);
    expect(hidden(f)).toEqual(["[", "](https://axis.app)"]);
    expect(f).toContainEqual({ text: "[AXIS](https://axis.app)", kind: "mark", cls: "cm-lp-link" });
  });

  it("leaves bracketed text that is not an inline link untouched", () => {
    const f = decorate("x\nsee [[Links]] and [ref]", 1);
    expect(hidden(f)).toEqual([]);
    expect(f.filter((d) => d.cls === "cm-lp-link")).toEqual([]);
  });

  it("renders bullets, rules and tasks as widgets away from the cursor", () => {
    const doc = "x\n- item\n- [ ] todo\n- [x] done\n\n---";
    const f = decorate(doc, 1);
    const widgets = f.filter((d) => d.kind === "widget");
    expect(widgets).toEqual([
      { text: "-", kind: "widget", cls: "BulletWidget" },
      { text: "- [ ] ", kind: "widget", cls: "CheckboxWidget" },
      { text: "- [x] ", kind: "widget", cls: "CheckboxWidget" },
      { text: "---", kind: "widget", cls: "RuleWidget" },
    ]);
    expect(f).toContainEqual({ text: "done", kind: "mark", cls: "cm-lp-done" });
    // On the task's own line the raw Markdown stays visible.
    expect(decorate(doc, 3).filter((d) => d.cls === "CheckboxWidget")).toHaveLength(1);
  });

  it("tracks checkbox state and position", () => {
    const a = new CheckboxWidget(true, 4);
    expect(a.eq(new CheckboxWidget(true, 4))).toBe(true);
    expect(a.eq(new CheckboxWidget(false, 4))).toBe(false);
  });

  it("styles fenced code lines and dims the fences without hiding code", () => {
    const f = decorate("x\n```js\nlet a = 1;\n```", 1);
    const lines = f.filter((d) => d.kind === "line").map((d) => d.cls);
    expect(lines).toEqual([
      "cm-lp-codeblock cm-lp-fence",
      "cm-lp-codeblock",
      "cm-lp-codeblock cm-lp-fence",
    ]);
    expect(hidden(f)).toEqual([]);
  });

  it("hides quote marks and styles every quoted line", () => {
    const f = decorate("x\n> one\n> two", 1);
    expect(hidden(f)).toEqual(["> ", "> "]);
    expect(f.filter((d) => d.cls === "cm-lp-quote")).toHaveLength(2);
  });
});
