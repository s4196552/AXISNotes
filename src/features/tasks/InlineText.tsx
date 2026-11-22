import { useMemo } from "react";
import { tokenizeInline } from "../../lib/inlineMarkdown";
import { followLink } from "../commands/actions";

/**
 * One line of a note's text rendered outside the editor (task lists, the dashboard):
 * `[[links]]` open their note (Ctrl+click: in a new tab), and code, bold, italic and
 * strikethrough are styled. Web links show their label, with the address on hover.
 */
export function InlineText({
  text,
  from,
  isKnown,
}: {
  text: string;
  from: string;
  /** For AI answers that cite sources: links this rejects are struck through. */
  isKnown?: (inner: string) => boolean;
}) {
  const tokens = useMemo(() => tokenizeInline(text), [text]);
  return (
    <>
      {tokens.map((t, i) => {
        switch (t.kind) {
          case "text":
            return t.text;
          case "code":
            return <code key={i}>{t.text}</code>;
          // Coloured like the note's own bold, italic and strikethrough, when those colours
          // are on in Settings → Appearance (app.css).
          case "bold":
            return (
              <strong key={i} className="inline-bold">
                {t.text}
              </strong>
            );
          case "italic":
            return (
              <em key={i} className="inline-italic">
                {t.text}
              </em>
            );
          case "strike":
            return (
              <s key={i} className="inline-strike">
                {t.text}
              </s>
            );
          case "link":
            return (
              <span key={i} className="inline-weblink" title={t.url}>
                {t.text}
              </span>
            );
          case "wikilink":
            if (isKnown && !isKnown(t.inner))
              return (
                <s key={i} className="cite-unknown" title="Not one of the sources that were sent">
                  {t.text}
                </s>
              );
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
                // Middle-click (the scroll wheel) opens it in a new tab too.
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  e.stopPropagation();
                  void followLink(t.inner, from, { newTab: true });
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
