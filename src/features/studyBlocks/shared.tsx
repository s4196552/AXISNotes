import { Fragment, useCallback, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Code } from "lucide-react";
import { InlineText } from "../tasks/InlineText";
import { useAppStore } from "../../app/store";
import { sectionsOf } from "../comprehension/model";
import { recordStudy } from "../comprehension/studyResults";
import type { StudyCardHost } from "./studyBlocks";
import { parseStudyBlock, type StudyBlock, type StudyKind } from "./model";
import "./studyBlocks.css";

// What the three study cards share (loaded with the first card a note shows).

/** Mount a card for a block: its parsed data, or the parse error with "Edit source". */
export function mountCard<B extends StudyBlock>(
  Card: (p: { block: B; host: StudyCardHost }) => ReactNode,
) {
  return (el: HTMLElement, host: StudyCardHost): Root => {
    const root = createRoot(el);
    const parsed = parseStudyBlock(host.kind, host.body);
    root.render(
      parsed.ok ? (
        <Card block={parsed.block as B} host={host} />
      ) : (
        <div className="study-error" role="note">
          <strong>{KIND_LABEL[host.kind]}:</strong> line {parsed.line}: {parsed.error}{" "}
          <button type="button" onClick={host.onEditSource}>
            Edit source
          </button>
        </div>
      ),
    );
    return root;
  };
}

export const KIND_LABEL: Record<StudyKind, string> = {
  flashcards: "Flash cards",
  quiz: "Practice test",
  mindmap: "Mind map",
};

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

// Progress stays while the note is open, even when the card scrolls out of view (and
// CodeMirror drops it) or the block is edited elsewhere. It is never saved.
const sessions = new Map<string, unknown>();
const MAX_SESSIONS = 60;

export function useSession<T>(host: StudyCardHost, initial: () => T): [T, (next: T) => void] {
  const key = `${host.kind}\n${host.path}\n${host.body}`;
  const [value, setValue] = useState<T>(() =>
    sessions.has(key) ? (sessions.get(key) as T) : initial(),
  );
  const set = useCallback(
    (next: T) => {
      sessions.delete(key);
      sessions.set(key, next);
      if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      setValue(next);
    },
    [key],
  );
  return [value, set];
}

/** Forget every card's progress (tests). */
export const clearSessions = () => sessions.clear();

/** The heatmap unit a block belongs to: its note, and the section heading it's under. */
export function sourceOf(host: StudyCardHost): string {
  const where = host.where();
  if (!where) return host.path;
  const above = sectionsOf(where.text).filter((h) => h.line < where.line);
  const heading = above.at(-1)?.text;
  return heading ? `${host.path}#${heading}` : host.path;
}

/** Send one finished round to the comprehension heatmap (one item per card or question). */
export function report(host: StudyCardHost, kind: "test" | "flashcards", correct: boolean[]) {
  if (!correct.length || !host.path) return;
  const source = sourceOf(host);
  void recordStudy({ kind, items: correct.map((c) => ({ source, correct: c })) }, [
    host.path,
  ]).catch((err: unknown) =>
    useAppStore
      .getState()
      .notify(`Couldn't save study results: ${err instanceof Error ? err.message : String(err)}`),
  );
}
