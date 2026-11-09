import { InlineText } from "../tasks/InlineText";

// An AI answer shown as light Markdown: headings, bullet and numbered lists, code blocks,
// and inline styles. `[[links]]` open their note. Nothing in the answer becomes HTML (each
// line is split into tokens rendered as React nodes), so an answer can't inject markup.

export function AnswerText({
  text,
  from,
  onFollow,
  isKnown,
}: {
  text: string;
  /** The note the question was about, for resolving `[[links]]`. */
  from: string;
  /** Called after a `[[link]]` is followed (e.g. to close a dialog). */
  onFollow?(): void;
  /** Citations this rejects (not among the sources sent) are struck through. */
  isKnown?: (inner: string) => boolean;
}) {
  const blocks: React.ReactNode[] = [];
  let code: string[] | null = null;
  text.split("\n").forEach((line, i) => {
    if (/^\s*```/.test(line)) {
      if (code) {
        blocks.push(<pre key={i}>{code.join("\n")}</pre>);
        code = null;
      } else code = [];
      return;
    }
    if (code) {
      code.push(line);
      return;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    const bullet = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (heading)
      blocks.push(
        <p key={i} className={`answer-h answer-h${heading[1]!.length}`}>
          <InlineText text={heading[2]!} from={from} isKnown={isKnown} />
        </p>,
      );
    else if (bullet)
      blocks.push(
        <p key={i} className="answer-li" style={{ paddingLeft: `${1 + bullet[1]!.length / 2}em` }}>
          <span className="answer-bullet" aria-hidden>
            {/\d/.test(bullet[2]!) ? bullet[2] : "•"}
          </span>{" "}
          <InlineText text={bullet[3]!} from={from} isKnown={isKnown} />
        </p>,
      );
    else if (line.trim())
      blocks.push(
        <p key={i}>
          <InlineText text={line} from={from} isKnown={isKnown} />
        </p>,
      );
    else blocks.push(<div key={i} className="answer-gap" />);
  });
  if (code) blocks.push(<pre key="open-code">{(code as string[]).join("\n")}</pre>);
  return (
    <div
      className="answer-text"
      // Capture: the link button stops its click from bubbling.
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest(".inline-wikilink")) onFollow?.();
      }}
    >
      {/* Line breaks between blocks keep the text readable when copied or read aloud. */}
      {blocks.flatMap((b, i) => (i ? ["\n", b] : [b]))}
    </div>
  );
}
