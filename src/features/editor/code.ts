import type { CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { ensureSyntaxTree } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export const CODE_LANGUAGES = [
  ["Python", "python"],
  ["Java", "java"],
  ["JavaScript", "javascript"],
  ["TypeScript", "typescript"],
  ["HTML", "html"],
  ["CSS", "css"],
  ["JSON", "json"],
  ["SQL", "sql"],
  ["Bash", "bash"],
  ["C", "c"],
  ["C++", "cpp"],
  ["C#", "csharp"],
  ["Rust", "rust"],
] as const;

/** Suggestions use the installed lazy parser catalogue, including its aliases. */
export function codeLanguageCompletions(context: CompletionContext): CompletionResult | null {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const match = /^( {0,3})(`{3,}|~{3,})([\w+#.-]*)$/.exec(state.sliceDoc(line.from, pos));
  if (!match || !/^[\w+#.-]*$/.test(state.sliceDoc(pos, line.to))) return null;
  const tree = ensureSyntaxTree(state, pos, 50);
  let node = tree?.resolveInner(line.from + match[1]!.length, 1);
  while (node && node.name !== "FencedCode") node = node.parent ?? undefined;
  // A closing fence, YAML or fence-looking code is never an opening fence.
  if (!node || state.doc.lineAt(node.from).number !== line.number) return null;
  return {
    from: line.from + match[1]!.length + match[2]!.length,
    to: line.to,
    options: languages.map((lang) => ({
      label: lang.name,
      apply: lang.alias[0] ?? lang.name.toLowerCase(),
      detail: lang.alias.join(", "),
      type: "type",
    })),
    validFor: /^[\w+#.-]*$/,
  };
}

/** A fence longer than any backtick run keeps selected source literal. */
export function codeFence(text: string, language = ""): readonly [string, string] {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return [`${fence}${language}\n${text}`, `\n${fence}`];
}

export function insertCode(view: EditorView, block: boolean): boolean {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to);
      let before: string, after: string;
      if (block) {
        const [head, tail] = codeFence(text);
        before = (range.from > state.doc.lineAt(range.from).from ? "\n" : "") + head;
        after = tail + (range.to < state.doc.lineAt(range.to).to ? "\n" : "");
      } else {
        // CommonMark code spans need padding for edge backticks or nonblank edge spaces.
        const delimiter = "`".repeat(
          Math.max(0, ...Array.from(text.matchAll(/`+/g), (m) => m[0].length)) + 1,
        );
        const pad = /^`|`$/.test(text) || (/^ .* $/.test(text) && /[^ ]/.test(text)) ? " " : "";
        before = delimiter + pad + text;
        after = pad + delimiter;
      }
      const start = range.from + before.length - text.length;
      return {
        changes: { from: range.from, to: range.to, insert: before + after },
        range: EditorSelection.range(start, start + text.length),
      };
    }),
  );
  view.focus();
  return true;
}
