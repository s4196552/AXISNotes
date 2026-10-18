import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// Colors come only from theme CSS variables, so light/dark and user themes just work.
const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--fg)",
    backgroundColor: "var(--bg)",
    fontSize: "var(--note-font-size)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-note)",
    lineHeight: "1.65",
  },
  ".cm-content": {
    maxWidth: "var(--editor-width)",
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
  // Menus (Ctrl+/, @@, ((, ::, {{, [[, emoji): themed, so they're readable in dark mode.
  ".cm-tooltip": {
    color: "var(--fg)",
    backgroundColor: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    boxShadow: "0 6px 24px rgba(0, 0, 0, 0.18)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    fontFamily: "var(--font-ui)",
    fontSize: "13px",
    maxHeight: "18em",
    minWidth: "240px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "3px 10px", lineHeight: "1.6" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    color: "var(--fg)",
    backgroundColor: "var(--bg-active)",
  },
  ".cm-completionDetail": { color: "var(--fg-muted)", fontStyle: "normal", marginLeft: "1em" },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: "600",
    color: "var(--accent)",
  },
  ".cm-completionIcon": { opacity: "0.55", width: "1.1em", paddingRight: "0.5em" },
  // Command menu, like Notion's: an icon tile instead of CodeMirror's glyph, the label with
  // a description under it, and the Markdown hint on the right.
  ".cm-completionIcon-command": { display: "none" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul:has(> li > .cm-commandIcon)": {
    maxHeight: "min(26em, 45vh)",
    minWidth: "320px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li:has(> .cm-commandIcon)": {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, max-content) minmax(0, 1fr) auto",
    gridTemplateAreas: '"icon label detail hint" "icon desc desc hint"',
    columnGap: "10px",
    alignItems: "center",
    padding: "4px 10px",
    lineHeight: "1.35",
  },
  "li:has(> .cm-commandIcon) > .cm-completionLabel": {
    gridArea: "label",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  "li:has(> .cm-commandIcon) > .cm-completionDetail": { gridArea: "detail", marginLeft: "0" },
  ".cm-commandIcon": {
    gridArea: "icon",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: "30px",
    height: "30px",
    border: "1px solid var(--border)",
    borderRadius: "6px",
    backgroundColor: "var(--bg)",
    color: "var(--fg-muted)",
  },
  "li[aria-selected] > .cm-commandIcon": { color: "var(--fg)" },
  ".cm-commandDescription": {
    gridArea: "desc",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: "12px",
    color: "var(--fg-muted)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > completion-section": {
    padding: "8px 10px 3px",
    borderBottom: "none",
    opacity: "1",
    color: "var(--fg-muted)",
    fontSize: "11.5px",
    fontWeight: "600",
  },
  ".cm-commandMarkdown": {
    gridArea: "hint",
    paddingLeft: "1em",
    fontFamily: "var(--font-mono)",
    fontSize: "13px",
    color: "var(--fg-muted)",
    background: "none",
    border: "none",
  },
});

const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: "700", color: "var(--heading)" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.link, t.url], color: "var(--link)" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--fg-muted)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)" },
  // Code inside fenced blocks
  { tag: [t.keyword, t.operatorKeyword, t.modifier], color: "var(--accent)" },
  { tag: [t.string, t.special(t.string)], color: "var(--fg-muted)", fontStyle: "italic" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "var(--fg-muted)" },
  { tag: [t.number, t.bool, t.null], color: "var(--danger)" },
]);

export const axisTheme = [editorTheme, syntaxHighlighting(highlight)];
