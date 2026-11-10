import { createElement, Fragment, memo, useMemo, type ReactNode } from "react";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { parseTable } from "../../lib/markdownTables";
import { calloutKind } from "../editor/obsidianSyntax";
import { codeColor } from "../editor/codeColors";
import { InlineText } from "../tasks/InlineText";

// Reuse the note editor's parser without mounting editable notes, loading embeds,
// registering commands or starting autosave. HTML/media remain inert React text.
const parser = markdown({
  base: markdownLanguage,
  extensions: {
    defineNodes: ["AnswerWikiLink", "AnswerHighlight"],
    parseInline: [
      {
        name: "AnswerWikiLink",
        before: "Link",
        parse(cx, next, pos) {
          if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
          const rest = cx.slice(pos + 2, cx.end);
          const end = rest.indexOf("]]");
          if (end < 0 || rest.slice(0, end).includes("\n")) return -1;
          return cx.addElement(cx.elt("AnswerWikiLink", pos, pos + end + 4));
        },
      },
      {
        name: "AnswerHighlight",
        before: "Emphasis",
        parse(cx, next, pos) {
          if (next !== 61 || cx.char(pos + 1) !== 61) return -1;
          const rest = cx.slice(pos + 2, cx.end);
          const end = rest.indexOf("==");
          if (end < 1 || rest.slice(0, end).includes("\n")) return -1;
          return cx.addElement(cx.elt("AnswerHighlight", pos, pos + end + 4));
        },
      },
    ],
  },
}).language.parser;
type Node = ReturnType<typeof parser.parse>["topNode"];

interface AnswerProps {
  text: string;
  /** The note the question was about, for resolving [[links]]. */
  from: string;
  onFollow?(): void;
  /** Reject citations that were not among the sources sent. */
  isKnown?: (inner: string) => boolean;
}

const MARKS = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "SubscriptMark",
  "SuperscriptMark",
  "ListMark",
  "QuoteMark",
  "TaskMarker",
]);

function renderMarkdown(text: string, props: AnswerProps, depth = 0, inline = false): ReactNode {
  if (depth > 40) return text;
  const raw = (n: Node) => text.slice(n.from, n.to);
  const again = (s: string, asInline = false) => renderMarkdown(s, props, depth + 1, asInline);
  let nesting = depth;

  function children(n: Node): ReactNode[] {
    const out: ReactNode[] = [];
    let pos = n.from;
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.from > pos) out.push(text.slice(pos, c.from));
      out.push(<Fragment key={c.from}>{render(c)}</Fragment>);
      pos = c.to;
      if (
        ["HeaderMark", "ListMark", "QuoteMark", "TaskMarker"].includes(c.name) &&
        text[pos] === " "
      )
        pos++;
    }
    if (pos < n.to) out.push(text.slice(pos, n.to));
    return out;
  }

  function render(n: Node): ReactNode {
    if (nesting > 40) return raw(n);
    nesting++;
    try {
      return renderNode(n);
    } finally {
      nesting--;
    }
  }

  function renderNode(n: Node): ReactNode {
    if (MARKS.has(n.name)) return null;
    const source = raw(n);
    if (/^(?:ATX|Setext)Heading[1-6]$/.test(n.name)) {
      const level = n.name.at(-1)!;
      return createElement(`h${level}`, { className: `answer-h answer-h${level}` }, children(n));
    }
    switch (n.name) {
      case "Document":
        return children(n);
      case "Paragraph":
        return inline ? <>{children(n)}</> : <p>{children(n)}</p>;
      case "StrongEmphasis":
        return <strong>{children(n)}</strong>;
      case "Emphasis":
        return <em>{children(n)}</em>;
      case "Strikethrough":
        return <s>{children(n)}</s>;
      case "Subscript":
        return <sub>{children(n)}</sub>;
      case "Superscript":
        return <sup>{children(n)}</sup>;
      case "InlineCode":
        return <code>{text.slice(n.firstChild!.to, n.lastChild!.from).replace(/\n/g, " ")}</code>;
      case "AnswerWikiLink":
        return <InlineText text={source} from={props.from} isKnown={props.isKnown} />;
      case "AnswerHighlight":
        return <mark>{again(source.slice(2, -2), true)}</mark>;
      case "BulletList":
        return <ul>{children(n)}</ul>;
      case "OrderedList":
        return <ol start={Number(/^\d+/.exec(source)?.[0] ?? 1)}>{children(n)}</ol>;
      case "ListItem":
        return <li>{children(n)}</li>;
      case "Task":
        return (
          <div className="answer-task">
            <input
              type="checkbox"
              checked={/^\[[xX]\]/.test(source)}
              disabled
              aria-label={/^\[[xX]\]/.test(source) ? "Completed task" : "Task"}
            />
            <span>{children(n)}</span>
          </div>
        );
      case "HorizontalRule":
        return <hr />;
      case "HardBreak":
        return <br />;
      case "Escape":
        return source.slice(1);
      case "FencedCode":
      case "CodeBlock": {
        const info = n.getChild("CodeInfo");
        const language = info ? raw(info) : "";
        const tint = codeColor(language);
        const code = n.getChildren("CodeText");
        const body = code.length ? text.slice(code[0]!.from, code.at(-1)!.to) : "";
        return (
          <pre data-code-color={tint ?? undefined}>
            {language && <span className="answer-code-language">{language}</span>}
            <code>{body}</code>
          </pre>
        );
      }
      case "Blockquote": {
        const body = source.replace(/^ {0,3}>[ \t]?/gm, "");
        const callout = /^\[!([\w-]+)\]([+-])?[ \t]*(.*)(?:\n|$)/.exec(body);
        if (!callout) return <blockquote>{again(body)}</blockquote>;
        const title = callout[3] || callout[1]!;
        const content = again(body.slice(callout[0].length));
        const kind = calloutKind(callout[1]!);
        const className = `answer-callout answer-callout-${kind}`;
        return callout[2] || callout[1]!.toLowerCase() === "toggle" ? (
          <details className={className} open={callout[2] !== "-"}>
            <summary>{again(title, true)}</summary>
            <div>{content}</div>
          </details>
        ) : (
          <aside className={className}>
            <div className="answer-callout-title">{again(title, true)}</div>
            {content}
          </aside>
        );
      }
      case "Table": {
        // The owner parser understands escaped pipes, code and [[note|alias]].
        const table = parseTable(source.split("\n"));
        if (!table) return <p>{source}</p>;
        const row = (cells: string[], head: boolean) =>
          cells.map((cell, i) =>
            createElement(
              head ? "th" : "td",
              { key: i, style: { textAlign: table.alignment[i] ?? undefined } },
              again(cell.replace(/\\\|/g, "|"), true),
            ),
          );
        return (
          <div className="answer-table">
            <table>
              <thead>
                <tr>{row(table.rows[0]!, true)}</tr>
              </thead>
              <tbody>
                {table.rows.slice(1).map((cells, i) => (
                  <tr key={i}>{row(cells, false)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case "Link":
      case "Autolink": {
        const url = n.getChild("URL");
        if (!url) return source;
        const label =
          n.name === "Autolink"
            ? raw(url)
            : text.slice(n.from + 1, n.getChildren("LinkMark")[1]!.from);
        return (
          <span className="inline-weblink" title={raw(url)}>
            {n.name === "Autolink" ? label : again(label, true)}
          </span>
        );
      }
      case "Image":
      case "HTMLBlock":
      case "HTMLTag":
        return source;
      default:
        return n.firstChild ? children(n) : source;
    }
  }
  return render(parser.parse(text).topNode);
}

export const AnswerText = memo(function AnswerText({ text, from, isKnown, onFollow }: AnswerProps) {
  const blocks = useMemo(
    () => renderMarkdown(text, { text, from, isKnown }),
    [text, from, isKnown],
  );
  return (
    <div
      className="answer-text"
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest(".inline-wikilink")) onFollow?.();
      }}
    >
      {blocks}
    </div>
  );
});
