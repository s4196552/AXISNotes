// A small inline-Markdown tokenizer for one line of text shown outside the editor (task
// lists, the dashboard): wikilinks, links, code, bold, italic and strikethrough. It doesn't
// nest (a bold span is plain text inside) and never produces HTML, so callers render
// tokens as React nodes and nothing in a note can inject markup.

export type InlineToken =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; text: string }
  | { kind: "italic"; text: string }
  | { kind: "strike"; text: string }
  /** `[[target|alias]]`: `inner` is what's between the brackets, as `followLink` takes it. */
  | { kind: "wikilink"; text: string; inner: string }
  /** `[label](url)`. */
  | { kind: "link"; text: string; url: string };

const INLINE = new RegExp(
  [
    String.raw`(\x60+)([^\x60]+?)\1`, // `code` (any number of backticks)
    String.raw`\[\[([^\]\n]+?)\]\]`, // [[wikilink]]
    String.raw`\[([^\]\n]+)\]\(([^)\s]+)\)`, // [label](url)
    String.raw`\*\*(?=\S)([^*\n]+?)(?<=\S)\*\*`, // **bold**
    String.raw`__(?=\S)([^_\n]+?)(?<=\S)__`, // __bold__
    String.raw`~~(?=\S)([^~\n]+?)(?<=\S)~~`, // ~~strike~~
    String.raw`(?<![\w*])\*(?=[^\s*])([^*\n]+?)(?<=\S)\*(?![\w*])`, // *italic*
    String.raw`(?<![\w_])_(?=[^\s_])([^_\n]+?)(?<=\S)_(?![\w_])`, // _italic_, not snake_case
  ].join("|"),
  "g",
);

/** What a wikilink shows: its alias, else the target without `.md` (and `#heading` as ` › heading`). */
export function wikilinkLabel(inner: string): string {
  const bar = inner.indexOf("|");
  if (bar !== -1 && inner.slice(bar + 1).trim()) return inner.slice(bar + 1).trim();
  const target = (bar === -1 ? inner : inner.slice(0, bar)).trim();
  const [page = "", ...rest] = target.split("#");
  const name = page.slice(page.lastIndexOf("/") + 1).replace(/\.md$/i, "");
  const sub = rest.join("#").replace(/^\^/, "");
  return name && sub ? `${name} › ${sub}` : name || sub;
}

export function tokenizeInline(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  const push = (t: InlineToken) => {
    const prev = out[out.length - 1];
    if (t.kind === "text" && prev?.kind === "text") prev.text += t.text;
    else if (t.kind !== "text" || t.text) out.push(t);
  };
  for (const m of text.matchAll(INLINE)) {
    push({ kind: "text", text: text.slice(last, m.index) });
    last = m.index + m[0].length;
    if (m[2] !== undefined) push({ kind: "code", text: m[2] });
    else if (m[3] !== undefined) push({ kind: "wikilink", text: wikilinkLabel(m[3]), inner: m[3] });
    else if (m[4] !== undefined) push({ kind: "link", text: m[4], url: m[5]! });
    else if (m[6] !== undefined) push({ kind: "bold", text: m[6] });
    else if (m[7] !== undefined) push({ kind: "bold", text: m[7] });
    else if (m[8] !== undefined) push({ kind: "strike", text: m[8] });
    else if (m[9] !== undefined) push({ kind: "italic", text: m[9] });
    else if (m[10] !== undefined) push({ kind: "italic", text: m[10] });
  }
  push({ kind: "text", text: text.slice(last) });
  return out;
}

/** The text a reader sees, without the Markdown (for labels and screen readers). */
export const plainInline = (text: string) =>
  tokenizeInline(text)
    .map((t) => t.text)
    .join("");
