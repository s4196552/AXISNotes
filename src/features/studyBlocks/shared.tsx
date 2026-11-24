import { Fragment, type ReactNode } from "react";
import { Code } from "lucide-react";
import { InlineText } from "../tasks/InlineText";
import { KIND_LABEL, type StudyKind } from "./model";
import type { StudyCardHost } from "./studyBlocks";
import "./studyBlocks.css";

// What the three study cards share (loaded with the first card a note shows).

/** A card's frame: an icon, the title and a line under it, its buttons, then its body. */
export function Shell(p: {
  kind: StudyKind;
  icon: ReactNode;
  title: string | null;
  sub: ReactNode;
  actions?: ReactNode;
  host: StudyCardHost;
  children: ReactNode;
}) {
  return (
    <section className={`study-card study-${p.kind}`} aria-label={p.title ?? KIND_LABEL[p.kind]}>
      <header className="study-head">
        <span className="study-icon" aria-hidden>
          {p.icon}
        </span>
        <div className="study-heading">
          <h3>{p.title ?? KIND_LABEL[p.kind]}</h3>
          <span className="study-sub">{p.sub}</span>
        </div>
        <div className="study-actions">
          {p.actions}
          <button
            type="button"
            aria-label="Edit source"
            title="Edit the block's text"
            onClick={p.host.onEditSource}
          >
            <Code size={14} />
          </button>
        </div>
      </header>
      {p.children}
    </section>
  );
}

/** Note text with inline Markdown ([[links]], code, bold, italic); line breaks kept. */
export function Text({ text, from }: { text: string; from: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          <InlineText text={line} from={from} />
        </Fragment>
      ))}
    </>
  );
}
