import { useMemo, type KeyboardEvent } from "react";
import { ChevronLeft, ChevronRight, Layers, RotateCcw, Shuffle } from "lucide-react";
import { type FlashcardsBlock, shuffled } from "./model";
import type { StudyCardHost } from "./studyBlocks";
import { mountCard, report, Shell, Text, useSession } from "./shared";

// A ```flashcards block (T-267): one card at a time, flipped with a click, Space or Enter.
// "Again" / "Got it" sort the cards for this sitting only; when a round is sorted, it
// goes to the comprehension heatmap. No due dates or review history: that's AXIS Deck's.

type Mark = "known" | "again";

interface State {
  /** Card indexes in the order they're shown this round. */
  order: number[];
  pos: number;
  flipped: boolean;
  marks: Record<number, Mark>;
  /** This round's results were sent to the heatmap. */
  reported: boolean;
}

export function FlashcardsView({ block, host }: { block: FlashcardsBlock; host: StudyCardHost }) {
  const deck = useMemo(
    () =>
      block.cards.flatMap((c) =>
        block.header.reverse
          ? [
              { front: c.front, back: c.back },
              { front: c.back, back: c.front },
            ]
          : [{ front: c.front, back: c.back }],
      ),
    [block],
  );
  const fresh = (cards: number[]): State => ({
    order: block.header.shuffle ? shuffled(cards.length).map((i) => cards[i]!) : cards,
    pos: 0,
    flipped: false,
    marks: {},
    reported: false,
  });
  const all = () => deck.map((_, i) => i);
  const [s, set] = useSession<State>(host, () => fresh(all()));

  const current = s.order[s.pos] ?? 0;
  const card = deck[current]!;
  const sorted = s.order.filter((i) => s.marks[i]).length;
  const known = s.order.filter((i) => s.marks[i] === "known").length;
  const done = sorted === s.order.length;

  const go = (delta: number) =>
    set({ ...s, pos: (s.pos + delta + s.order.length) % s.order.length, flipped: false });
  const flip = () => set({ ...s, flipped: !s.flipped });

  const mark = (m: Mark) => {
    const marks = { ...s.marks, [current]: m };
    const next = [...s.order.keys()]
      .map((k) => (s.pos + 1 + k) % s.order.length)
      .find((p) => !marks[s.order[p]!]);
    const finished = next === undefined;
    if (finished && !s.reported)
      report(
        host,
        "flashcards",
        s.order.map((i) => marks[i] === "known"),
      );
    set({ ...s, marks, pos: next ?? s.pos, flipped: false, reported: s.reported || finished });
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === " " || e.key === "Enter") flip();
    else if (e.key === "ArrowRight") go(1);
    else if (e.key === "ArrowLeft") go(-1);
    else return;
    e.preventDefault();
  };

  const again = s.order.filter((i) => s.marks[i] === "again");
  return (
    <Shell
      kind="flashcards"
      icon={<Layers size={18} />}
      title={block.header.title}
      host={host}
      sub={
        <>
          {s.pos + 1} of {s.order.length} · {known} known
        </>
      }
      actions={
        <button
          type="button"
          aria-label="Shuffle"
          title="Shuffle"
          onClick={() =>
            set({
              ...s,
              order: shuffled(s.order.length).map((i) => s.order[i]!),
              pos: 0,
              flipped: false,
            })
          }
        >
          <Shuffle size={14} />
        </button>
      }
    >
      {done ? (
        <div className="study-done" role="status">
          <p>
            All {s.order.length} sorted: {known} known, {again.length} to study again.
          </p>
          <div className="study-row">
            {again.length > 0 && (
              <button type="button" className="primary" onClick={() => set(fresh(again))}>
                Study the {again.length} again
              </button>
            )}
            <button type="button" onClick={() => set(fresh(all()))}>
              <RotateCcw size={14} /> Start over
            </button>
          </div>
        </div>
      ) : (
        <>
          <div
            className={`flashcard${s.flipped ? " flipped" : ""}${s.marks[current] ? ` ${s.marks[current]}` : ""}`}
            role="button"
            tabIndex={0}
            aria-pressed={s.flipped}
            aria-label={
              s.flipped
                ? "Answer. Press Space to see the question"
                : "Question. Press Space to see the answer"
            }
            onClick={flip}
            onKeyDown={onKey}
          >
            <span className="flashcard-side">{s.flipped ? "Answer" : "Question"}</span>
            <div className="flashcard-text">
              <Text text={s.flipped ? card.back : card.front} from={host.path} />
            </div>
            {!s.flipped && <span className="flashcard-hint">Click or press Space to flip</span>}
          </div>
          <div className="study-row">
            <button
              type="button"
              aria-label="Previous card"
              title="Previous (←)"
              onClick={() => go(-1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button type="button" className="study-again" onClick={() => mark("again")}>
              Again
            </button>
            <button type="button" className="study-known" onClick={() => mark("known")}>
              Got it
            </button>
            <button type="button" aria-label="Next card" title="Next (→)" onClick={() => go(1)}>
              <ChevronRight size={16} />
            </button>
            {sorted > 0 && (
              <button type="button" className="study-quiet" onClick={() => set(fresh(all()))}>
                Start over
              </button>
            )}
          </div>
        </>
      )}
    </Shell>
  );
}

export const mount = mountCard(FlashcardsView);
