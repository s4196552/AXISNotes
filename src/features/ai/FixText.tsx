import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, HardDrive, Square, WandSparkles, X } from "lucide-react";
import { type AiPlan, type AiRunResult, backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { applySegments, changeCount, diffWords, type Segment } from "../../lib/diff";
import { getActiveEditor } from "../editor/activeEditor";
import { editNote } from "../files/editNote";
import { cleanReply, fixRequest, type FixMode } from "./fixPrompt";
import { AiRun, errorMessage, isCancelled, runAi } from "./runAi";
import "./ai.css";

// "Fix grammar and clarity": sends the selection (or the note's body) to the model set up
// for text fixes, then shows the edits as a word diff. Each change can be rejected by
// clicking it before the result is applied to the note.

export interface FixTextProps {
  path: string;
  /** Range of `original` in the note when the dialog opened. */
  from: number;
  to: number;
  original: string;
  scope: "selection" | "note";
  onClose(): void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "review"; result: AiRunResult; segments: Segment[] }
  | { kind: "error"; message: string };

export function FixText({ path, from, to, original, scope, onClose }: FixTextProps) {
  const [mode, setMode] = useState<FixMode>("grammar");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [streamed, setStreamed] = useState("");
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  const run = useRef<AiRun | null>(null);

  const request = useMemo(() => fixRequest(original, mode, path), [original, mode, path]);

  useEffect(() => {
    let live = true;
    backend.aiPlan(request).then(
      (p) => live && (setPlan(p), setPlanError(null)),
      (e: unknown) => live && (setPlan(null), setPlanError(errorMessage(e))),
    );
    return () => {
      live = false;
    };
  }, [request]);

  async function start() {
    const r = new AiRun();
    run.current = r;
    setStreamed("");
    setRejected(new Set());
    setPhase({ kind: "running" });
    try {
      const result = await runAi(request, (d) => setStreamed((s) => s + d), r);
      const segments = diffWords(original, cleanReply(result.text, original));
      setPhase({ kind: "review", result, segments });
    } catch (e) {
      setPhase(isCancelled(e) ? { kind: "idle" } : { kind: "error", message: errorMessage(e) });
    }
  }

  async function apply() {
    if (phase.kind !== "review") return;
    const next = applySegments(phase.segments, rejected);
    const active = getActiveEditor();
    if (active?.path === path && active.view.state.sliceDoc(from, to) === original) {
      active.view.dispatch({
        changes: { from, to, insert: next },
        selection: { anchor: from, head: from + next.length },
      });
      onClose();
      active.view.focus();
      return;
    }
    // The editor moved on: replace the original text if it is still there exactly once.
    try {
      const ok = await editNote(path, (doc) => {
        const at = doc.indexOf(original);
        if (at < 0 || doc.indexOf(original, at + 1) >= 0) return null;
        return doc.slice(0, at) + next + doc.slice(at + original.length);
      });
      if (!ok) {
        setPhase({
          kind: "error",
          message: "The note changed while the fixes were being prepared. Copy the result instead.",
        });
        return;
      }
      useAppStore.getState().notify("Fixes applied.");
      onClose();
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  }

  const running = phase.kind === "running";
  const segments = phase.kind === "review" ? phase.segments : [];
  const total = changeCount(segments);
  const accepted = total - rejected.size;
  const toggle = (id: number) =>
    setRejected((r) => {
      const next = new Set(r);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="modal-backdrop" onMouseDown={() => !running && onClose()}>
      <div
        className="modal ask-ai fix-text"
        role="dialog"
        aria-label="Fix writing"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !running && onClose()}
      >
        <header className="ask-ai-header">
          <WandSparkles size={15} />{" "}
          <strong>Fix writing · {scope === "selection" ? "selection" : "whole note"}</strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose} disabled={running}>
            <X size={15} />
          </button>
        </header>

        <div className="ask-ai-body">
          <div className="ask-ai-options">
            <label>
              <input
                type="radio"
                name="fix-mode"
                checked={mode === "grammar"}
                disabled={running}
                onChange={() => setMode("grammar")}
              />
              Grammar and spelling
            </label>
            <label>
              <input
                type="radio"
                name="fix-mode"
                checked={mode === "clarity"}
                disabled={running}
                onChange={() => setMode("clarity")}
              />
              Also improve clarity
            </label>
          </div>

          <div className="ask-ai-plan" aria-live="polite" aria-label="Destination">
            {plan && (
              <>
                {plan.local && <HardDrive size={12} aria-label="On this device" />}
                <span>
                  → {plan.providerName} · {plan.model}
                </span>
                <span className="muted">
                  ~{plan.estimatedInputTokens.toLocaleString()} input tokens
                  {plan.estimatedCost !== null && ` · ~$${plan.estimatedCost.toFixed(4)}`}
                </span>
              </>
            )}
            {!plan && planError && <span className="ai-error">{planError}</span>}
          </div>

          {phase.kind === "error" && (
            <p className="ai-error ask-ai-error" role="alert">
              {phase.message}
            </p>
          )}

          {running && (
            <div className="ask-ai-answer" aria-label="Draft" aria-busy>
              {streamed}
              <span className="ask-ai-caret" aria-hidden />
            </div>
          )}

          {phase.kind === "review" &&
            (total === 0 ? (
              <p className="ai-ok" role="status">
                <Check size={13} /> No changes suggested.
              </p>
            ) : (
              <>
                <div className="fix-summary" role="status">
                  {accepted} of {total} change{total === 1 ? "" : "s"} accepted · click a change to
                  keep the original
                  <span className="ask-ai-spacer" />
                  <button onClick={() => setRejected(new Set())}>Accept all</button>
                  <button
                    onClick={() =>
                      setRejected(
                        new Set(segments.flatMap((s) => (s.kind === "change" ? [s.id] : []))),
                      )
                    }
                  >
                    Reject all
                  </button>
                </div>
                <div className="ask-ai-answer fix-diff" aria-label="Changes">
                  {segments.map((s, i) =>
                    s.kind === "same" ? (
                      <span key={i}>{s.text}</span>
                    ) : (
                      <button
                        key={i}
                        className="fix-change"
                        aria-pressed={!rejected.has(s.id)}
                        aria-label={`Change “${s.before}” to “${s.after}”`}
                        title={
                          rejected.has(s.id) ? "Kept original · click to accept" : "Click to reject"
                        }
                        onClick={() => toggle(s.id)}
                      >
                        {rejected.has(s.id) ? (
                          <span className="fix-kept">{s.before || "∅"}</span>
                        ) : (
                          <>
                            {s.before && <del>{s.before}</del>}
                            {s.after && <ins>{s.after}</ins>}
                          </>
                        )}
                      </button>
                    ),
                  )}
                </div>
              </>
            ))}
          {phase.kind === "review" && (
            <div className="ask-ai-meta muted">
              By {phase.result.providerName} · {phase.result.model}
              {phase.result.local && " (on this device)"}
            </div>
          )}
        </div>

        <footer className="ask-ai-footer">
          {phase.kind === "review" && total > 0 && (
            <button
              onClick={() =>
                void navigator.clipboard?.writeText(applySegments(phase.segments, rejected))
              }
            >
              <Copy size={13} /> Copy
            </button>
          )}
          <span className="ask-ai-spacer" />
          {running ? (
            <button onClick={() => run.current?.cancel()}>
              <Square size={12} /> Stop
            </button>
          ) : phase.kind === "review" && total > 0 ? (
            <button className="primary" onClick={() => void apply()} disabled={accepted === 0}>
              <Check size={13} /> Apply {accepted} change{accepted === 1 ? "" : "s"}
            </button>
          ) : (
            <button className="primary" onClick={() => void start()} disabled={!original.trim()}>
              <WandSparkles size={13} /> {phase.kind === "review" ? "Try again" : "Fix"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
