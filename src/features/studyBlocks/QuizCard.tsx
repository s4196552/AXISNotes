import { useId } from "react";
import { Check, ClipboardCheck, RotateCcw, X } from "lucide-react";
import { matchesAnswer, type QuizBlock, type QuizQuestion, shuffled } from "./model";
import type { StudyCardHost } from "./studyBlocks";
import { mountCard, report, Shell, Text, useSession } from "./shared";

// A ```quiz block (T-267): multiple choice (one answer or "select all that apply") and
// short answers. Checking shows right or wrong, the answer and the explanation; the score
// comes once every question is checked, and goes to the comprehension heatmap.

interface Answer {
  picked: number[];
  typed: string;
  checked: boolean;
  right: boolean;
}

interface State {
  order: number[];
  answers: Record<number, Answer>;
  reported: boolean;
}

const blank: Answer = { picked: [], typed: "", checked: false, right: false };

function isRight(q: QuizQuestion, a: Answer): boolean {
  if (!q.options.length) return matchesAnswer(a.typed, q.answers);
  const want = q.options.flatMap((o, i) => (o.correct ? [i] : []));
  return want.length === a.picked.length && want.every((i) => a.picked.includes(i));
}

export function QuizView({ block, host }: { block: QuizBlock; host: StudyCardHost }) {
  const n = block.questions.length;
  const start = (shuffle: boolean): State => ({
    order: shuffle ? shuffled(n) : [...Array(n).keys()],
    answers: {},
    reported: false,
  });
  const [s, set] = useSession<State>(host, () => start(block.header.shuffle));
  const name = useId();

  const answerOf = (qi: number) => s.answers[qi] ?? blank;
  const checked = s.order.filter((qi) => answerOf(qi).checked);
  const right = checked.filter((qi) => answerOf(qi).right).length;
  const done = checked.length === n;

  const update = (qi: number, a: Answer) => {
    const answers = { ...s.answers, [qi]: a };
    const finished = s.order.every((i) => (answers[i] ?? blank).checked);
    if (finished && !s.reported)
      report(
        host,
        "test",
        s.order.map((i) => answers[i]!.right),
      );
    set({ ...s, answers, reported: s.reported || finished });
  };
  const check = (qi: number) => {
    const a = answerOf(qi);
    const q = block.questions[qi]!;
    if (a.checked || (q.options.length ? !a.picked.length : !a.typed.trim())) return;
    update(qi, { ...a, checked: true, right: isRight(q, a) });
  };

  return (
    <Shell
      kind="quiz"
      icon={<ClipboardCheck size={18} />}
      title={block.header.title}
      host={host}
      sub={
        done ? (
          <>
            Score: {right} of {n}
          </>
        ) : (
          <>
            {n} {n === 1 ? "question" : "questions"} · {checked.length} answered
          </>
        )
      }
    >
      <ol className="quiz-list">
        {s.order.map((qi, num) => {
          const q = block.questions[qi]!;
          const a = answerOf(qi);
          const multi = q.options.filter((o) => o.correct).length > 1;
          const id = `${name}-${qi}`;
          return (
            <li
              key={qi}
              className={`quiz-q${a.checked ? (a.right ? " right" : " wrong") : ""}`}
              aria-labelledby={`${id}-text`}
            >
              <div className="quiz-text" id={`${id}-text`}>
                <span className="quiz-num">{num + 1}.</span> <Text text={q.text} from={host.path} />
              </div>
              {q.options.length ? (
                <fieldset className="quiz-options" disabled={a.checked}>
                  <legend className="study-sub">
                    {multi ? "Select all that apply" : "Choose one"}
                  </legend>
                  {q.options.map((o, oi) => {
                    const picked = a.picked.includes(oi);
                    const mark = a.checked
                      ? o.correct
                        ? " correct"
                        : picked
                          ? " incorrect"
                          : ""
                      : "";
                    return (
                      <label key={oi} className={`quiz-option${picked ? " picked" : ""}${mark}`}>
                        <input
                          type={multi ? "checkbox" : "radio"}
                          name={id}
                          checked={picked}
                          onChange={() =>
                            update(qi, {
                              ...a,
                              picked: multi
                                ? picked
                                  ? a.picked.filter((x) => x !== oi)
                                  : [...a.picked, oi]
                                : [oi],
                            })
                          }
                        />
                        <span>
                          <Text text={o.text} from={host.path} />
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : (
                <input
                  className="quiz-input"
                  type="text"
                  aria-label={`Answer to question ${num + 1}`}
                  placeholder="Type your answer, then press Enter"
                  value={a.typed}
                  readOnly={a.checked}
                  onChange={(e) => update(qi, { ...a, typed: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      check(qi);
                    }
                  }}
                />
              )}
              {a.checked ? (
                <div className="quiz-feedback" role="status">
                  <strong>
                    {a.right ? (
                      <>
                        <Check size={14} aria-hidden /> Right
                      </>
                    ) : (
                      <>
                        <X size={14} aria-hidden /> Not quite
                      </>
                    )}
                  </strong>
                  {!a.right && (
                    <span>
                      {" "}
                      Answer:{" "}
                      {q.options.length ? (
                        q.options
                          .filter((o) => o.correct)
                          .map((o, k) => (
                            <span key={k}>
                              {k > 0 && "; "}
                              <Text text={o.text} from={host.path} />
                            </span>
                          ))
                      ) : (
                        <Text text={q.answers[0]!} from={host.path} />
                      )}
                    </span>
                  )}
                  {q.explanation && (
                    <p className="quiz-why">
                      <Text text={q.explanation} from={host.path} />
                    </p>
                  )}
                </div>
              ) : (
                <button
                  type="button"
                  className="quiz-check"
                  disabled={q.options.length ? !a.picked.length : !a.typed.trim()}
                  onClick={() => check(qi)}
                >
                  Check
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {done && (
        <div className="study-done" role="status">
          <p>
            You got {right} of {n}.
            {right < n && (
              <>
                {" "}
                Missed:{" "}
                {s.order
                  .map((qi, num) => [qi, num + 1] as const)
                  .filter(([qi]) => !answerOf(qi).right)
                  .map(([, num]) => num)
                  .join(", ")}
                .
              </>
            )}
          </p>
          <button type="button" className="primary" onClick={() => set(start(true))}>
            <RotateCcw size={14} /> Try again
          </button>
        </div>
      )}
    </Shell>
  );
}

export const mount = mountCard(QuizView);
