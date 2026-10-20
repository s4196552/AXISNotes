import { useMemo } from "react";
import { tokenizeInline } from "../../lib/inlineMarkdown";
import { followLink } from "../commands/actions";

/**
 * One line of a note's text rendered outside the editor (task lists, the dashboard):
 * `[[links]]` open their note (Ctrl+click: in a new tab), and code, bold, italic and
 * strikethrough are styled. Web links show their label, with the address on hover.
 */
export function InlineText({ text, from }: { text: string; from: string }) {
  const tokens = useMemo(() => tokenizeInline(text), [text]);
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case "text":
            return t.text;
          case "code":
            return <code key={i}>{t.text}</code>;
          case "bold":
            return <strong key={i}>{t.text}</strong>;
          case "italic":
            return <em key={i}>{t.text}</em>;
          case "strike":
            return <s key={i}>{t.text}</s>;
          case "link":
            return (
              <span key={i} className="inline-weblink" title={t.url}>
                {t.text}
              </span>
            );
          case "wikilink":
            return (
              <button
                key={i}
                type="button"
                className="inline-wikilink"
                title={t.inner}
                onClick={(e) => {
                  e.stopPropagation();
                  void followLink(t.inner, from, { newTab: e.ctrlKey || e.metaKey });
                }}
              >
                {t.text}
              </button>
            );
        }
      })}
    </>
  );
}
