import { CompletionContext } from "@codemirror/autocomplete";
import { history, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { codeFence, codeLanguageCompletions, insertCode } from "./code";
import { axisTheme } from "./theme";

function view(doc: string, from = doc.length, to = from) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: from, head: to },
      extensions: [
        history(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        axisTheme,
      ],
    }),
    parent: document.body,
  });
}

describe("Markdown code", () => {
  it("suggests languages only on opening fences, including tilde fences", () => {
    for (const doc of ["```", "```PY", "~~~java", "intro\n\n```c++"]) {
      const v = view(doc);
      try {
        const result = codeLanguageCompletions(new CompletionContext(v.state, doc.length, false));
        expect(result?.options.map((c) => c.label)).toEqual(
          expect.arrayContaining(["Python", "Java"]),
        );
      } finally {
        v.destroy();
      }
    }
    for (const doc of [
      "```python\nx = 1\n```",
      "text ```",
      "    ```",
      "`python`",
      "```text\n~~~java",
    ]) {
      const v = view(doc);
      try {
        expect(
          codeLanguageCompletions(new CompletionContext(v.state, doc.length, true)),
        ).toBeNull();
      } finally {
        v.destroy();
      }
    }
  });
  it("wraps selected code safely and undoes in one step", () => {
    for (const [block, source, expected] of [
      [false, "value", "`value`"],
      [false, "`value`", "`` `value` ``"],
      [true, "print(1)", "```\nprint(1)\n```"],
      [true, "```", "````\n```\n````"],
    ] as const) {
      const v = view(source, 0, source.length);
      try {
        insertCode(v, block);
        expect(v.state.doc.toString()).toBe(expected);
        expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe(
          source,
        );
        undo(v);
        expect(v.state.doc.toString()).toBe(source);
      } finally {
        v.destroy();
      }
    }
    expect(codeFence("x", "python")).toEqual(["```python\nx", "\n```"]);
  });
  it("places blocks on their own lines and an empty cursor inside the fences", () => {
    const v = view("beforeafter", 6);
    try {
      insertCode(v, true);
      expect(v.state.doc.toString()).toBe("before\n```\n\n```\nafter");
      expect(v.state.selection.main.head).toBe(11);
    } finally {
      v.destroy();
    }
  });
  it.each([
    ["python", 'def hello():\n    return "world" # comment'],
    ["PYTHON", 'def hello():\n    return "world" # comment'],
    ["java", 'public class Hello { String x = "world"; }'],
    ["js", 'const x = "world";'],
  ])("loads and highlights %s without editing the Markdown", async (language, source) => {
    const lang = languages.find((l) => l.alias.includes(language.toLowerCase()));
    await lang!.load();
    const doc = "```" + language + "\n" + source + "\n```";
    const v = view(doc);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(v.dom.querySelector(".cm-code-keyword")).not.toBeNull();
      expect(v.dom.querySelector(".cm-code-string")).not.toBeNull();
      expect(v.state.doc.toString()).toBe(doc);
    } finally {
      v.destroy();
    }
  });
});
