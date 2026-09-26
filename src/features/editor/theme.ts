import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Colors come only from theme CSS variables, so light/dark and user themes just work.
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--fg)",
    backgroundColor: "var(--bg)",
    fontSize: "15px",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-ui)",
    lineHeight: "1.65",
  },
  ".cm-content": {
    maxWidth: "760px",
    margin: "0 auto",
    padding: "8px 24px 40vh",
    caretColor: "var(--accent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--accent)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--selection)",
  },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-panels": { backgroundColor: "var(--bg-sidebar)", color: "var(--fg)" },
  ".cm-panels input, .cm-panels button": { fontSize: "13px" },
  ".cm-searchMatch": { backgroundColor: "var(--bg-active)" },
});

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--fg-muted)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)" },
  // Code inside fenced blocks
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--accent)" },
  { tag: [t.string, t.special(t.string)], color: "var(--fg-muted)", fontStyle: "italic" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--fg-muted)" },
  { tag: [t.number, t.bool, t.null], color: "var(--danger)" },
]);

export const axisTheme = [editorTheme, syntaxHighlighting(highlight)];
