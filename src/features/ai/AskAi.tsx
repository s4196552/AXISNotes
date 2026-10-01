import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, HardDrive, Send, Sparkles, Square, X } from "lucide-react";
import {
  type AiEffort,
  type AiPlan,
  type AiRunRequest,
  type AiRunResult,
  backend,
  isBackendError,
} from "../../ipc";
import { AiRun, runAi } from "./runAi";
import { useAppStore } from "../../app/store";
import { getActiveEditor } from "../editor/activeEditor";
import { editNote } from "../files/editNote";
import "./ai.css";

// Ask an AI model about the open note (or a selection). Shows where the request goes and
// roughly how big it is before sending; streams the answer; can be stopped. The note is
// attached by path, so the Rust layer reads it and applies the folder's privacy rule.

export interface AskAiProps {
  /** Note to offer as context. */
  path?: string;
  /** Selected text in that note, if any. */
  selection?: string;
  onClose(): void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "confirm"; plan: AiPlan }
  | { kind: "running" }
  | { kind: "done"; result: AiRunResult }
  | { kind: "error"; message: string; blocked: boolean };

const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

const errorOf = (e: unknown): Phase => ({
  kind: "error",
  message: isBackendError(e) ? e.message : String(e),
  blocked: isBackendError(e) && e.code === "Blocked",
});

export function AskAi({ path, selection, onClose }: AskAiProps) {
  const [prompt, setPrompt] = useState("");
  const [useNote, setUseNote] = useState(Boolean(path) && !selection);
  const [useSelection, setUseSelection] = useState(Boolean(selection));
  const [effort, setEffort] = useState<AiEffort>("balanced");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [answer, setAnswer] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const currentRun = useRef<AiRun | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      currentRun.current?.cancel();
    };
  }, []);

  useEffect(() => {
    backend.aiSettings().then(
      (v) => {
        if (mounted.current) setEffort(v.settings.effort);
      },
      () => {},
    );
  }, []);

  const request = useMemo((): AiRunRequest => {
    const context = useSelection && selection ? `Selected text:\n"""\n${selection}\n"""\n\n` : "";
    return {
      task: "chat",
      effort,
      messages: [
        {
          role: "system",
          content: [
            {
              type: "text",
              text: "You are a helpful assistant inside a Markdown note-taking app. Answer in Markdown.",
            },
          ],
        },
        { role: "user", content: [{ type: "text", text: context + prompt }] },
      ],
      attach: useNote && path ? [path] : [],
      sources: useSelection && selection && path ? [path] : [],
    };
  }, [prompt, useNote, useSelection, selection, path, effort]);

  // Preview where the request would go (debounced while typing).
  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      backend.aiPlan(request).then(
        (p) => {
          if (cancelled) return;
          setPlan(p);
          setPlanError(null);
        },
        (e: unknown) => {
          if (cancelled) return;
          setPlan(null);
          setPlanError(isBackendError(e) ? e.message : String(e));
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [request]);

  async function send(confirmed = false) {
    if (!prompt.trim() || phase.kind === "running") return;
    const vault = useAppStore.getState().vault?.root;
    const run = new AiRun();
    currentRun.current = run;
    if (!confirmed) {
      // The plan only decides whether to ask first. If it fails (e.g. a privacy rule),
      // the run below reports the authoritative error and records it in the request log.
      const p = await backend.aiPlan(request).catch(() => null);
      if (run.cancelled || vault !== useAppStore.getState().vault?.root) {
        run.cancel();
        return;
      }
      if (p?.needsConfirm) {
        setPhase({ kind: "confirm", plan: p });
        return;
      }
    }
    setAnswer("");
    setPhase({ kind: "running" });
    try {
      const result = await runAi(
        request,
        (d) => {
          if (mounted.current) setAnswer((a) => a + d);
        },
        run,
      );
      if (!mounted.current) return;
      setAnswer(result.text);
      setPhase({ kind: "done", result });
    } catch (e) {
      if (!mounted.current) return;
      if (isBackendError(e) && e.code === "Cancelled") setPhase({ kind: "idle" });
      else setPhase(errorOf(e));
    }
  }

  const insert = () => {
    const active = getActiveEditor();
    if (active && active.path === path) {
      const { view } = active;
      const at = view.state.selection.main;
      view.dispatch({
        changes: { from: at.from, to: at.to, insert: answer },
        selection: { anchor: at.from + answer.length },
      });
      onClose();
      view.focus();
    }
  };

  const append = async () => {
    if (!path) return;
    try {
      await editNote(path, (text) => `${text.replace(/\s*$/, "")}\n\n${answer.trim()}\n`);
      useAppStore.getState().notify(`Added to ${noteName(path)}.`);
      onClose();
    } catch (e) {
      setPhase(errorOf(e));
    }
  };

  const running = phase.kind === "running";
  const canInsert = Boolean(path && getActiveEditor()?.path === path);

  return (
    <div className="modal-backdrop" onMouseDown={() => !running && onClose()}>
      <div
        className="modal ask-ai"
        role="dialog"
        aria-label="Ask AI"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !running && onClose()}
      >
        <header className="ask-ai-header">
          <Sparkles size={15} /> <strong>Ask AI</strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose} disabled={running}>
            <X size={15} />
          </button>
        </header>

        <div className="ask-ai-body">
          <textarea
            ref={inputRef}
            className="ask-ai-input"
            aria-label="Question"
            placeholder={path ? `Ask about ${noteName(path)}…` : "Ask anything…"}
            autoFocus
            rows={3}
            value={prompt}
            disabled={running}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="ask-ai-options">
            {path && (
              <label>
                <input
                  type="checkbox"
                  checked={useNote}
                  disabled={running}
                  onChange={(e) => setUseNote(e.target.checked)}
                />
                Include note “{noteName(path)}”
              </label>
            )}
            {selection && (
              <label>
                <input
                  type="checkbox"
                  checked={useSelection}
                  disabled={running}
                  onChange={(e) => setUseSelection(e.target.checked)}
                />
                Include selection
              </label>
            )}
            <select
              aria-label="Effort"
              value={effort}
              disabled={running}
              onChange={(e) => setEffort(e.target.value as AiEffort)}
            >
              <option value="quick">Quick</option>
              <option value="balanced">Balanced</option>
              <option value="deep">Deep</option>
            </select>
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
                {plan.rule === "local" && <span className="ai-badge">Local-only notes</span>}
              </>
            )}
            {!plan && planError && <span className="ai-error">{planError}</span>}
          </div>

          {phase.kind === "confirm" && (
            <div className="editor-banner ask-ai-confirm" role="alert">
              <span>
                This request is about {phase.plan.estimatedInputTokens.toLocaleString()} input
                tokens
                {phase.plan.estimatedCost !== null && ` (~$${phase.plan.estimatedCost.toFixed(4)})`}
                . Send it to {phase.plan.providerName}?
              </span>
              <button onClick={() => setPhase({ kind: "idle" })}>Cancel</button>
              <button className="primary" onClick={() => void send(true)}>
                Send
              </button>
            </div>
          )}
          {phase.kind === "error" && (
            <p className="ai-error ask-ai-error" role="alert">
              {phase.blocked && "Not sent: "}
              {phase.message}
            </p>
          )}

          {(answer || running) && (
            <div className="ask-ai-answer" aria-label="Answer" aria-busy={running}>
              {answer}
              {running && <span className="ask-ai-caret" aria-hidden />}
            </div>
          )}
          {phase.kind === "done" && (
            <div className="ask-ai-meta muted">
              Answered by {phase.result.providerName} · {phase.result.model}
              {phase.result.local && " (on this device)"}
              {phase.result.usage &&
                ` · ${phase.result.usage.inputTokens} in / ${phase.result.usage.outputTokens} out tokens`}
              {phase.result.fallbackFrom && ` · ${phase.result.fallbackFrom} was unavailable`}
            </div>
          )}
        </div>

        <footer className="ask-ai-footer">
          {phase.kind === "done" && (
            <>
              <button onClick={() => void navigator.clipboard?.writeText(answer)}>
                <Copy size={13} /> Copy
              </button>
              {canInsert && <button onClick={insert}>Insert at cursor</button>}
              {path && <button onClick={() => void append()}>Append to note</button>}
            </>
          )}
          <span className="ask-ai-spacer" />
          {running ? (
            <button onClick={() => currentRun.current?.cancel()}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <button
              className="primary"
              disabled={!prompt.trim()}
              onClick={() => void send()}
              title="Ctrl+Enter"
            >
              <Send size={13} /> Ask
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
