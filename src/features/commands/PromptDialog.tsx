import { useState } from "react";

export function PromptDialog(p: {
  title: string;
  questions: string[];
  initial?: Record<string, string>;
  onDone(answers: Record<string, string> | null): void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(p.questions.map((q) => [q, p.initial?.[q] ?? ""])),
  );
  return (
    <div className="modal-backdrop" onMouseDown={() => p.onDone(null)}>
      <form
        className="modal prompt"
        role="dialog"
        aria-label={p.title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          p.onDone(answers);
        }}
        onKeyDown={(e) => e.key === "Escape" && p.onDone(null)}
      >
        <h2>{p.title}</h2>
        {p.questions.map((q, i) => (
          <label key={q}>
            {q}
            <input
              autoFocus={i === 0}
              value={answers[q] ?? ""}
              onChange={(e) => setAnswers((a) => ({ ...a, [q]: e.target.value }))}
            />
          </label>
        ))}
        <div className="prompt-actions">
          <button type="button" onClick={() => p.onDone(null)}>
            Cancel
          </button>
          <button type="submit" className="primary">
            OK
          </button>
        </div>
      </form>
    </div>
  );
}
