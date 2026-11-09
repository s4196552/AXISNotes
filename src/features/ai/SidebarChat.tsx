import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import { type AiPlan, type AiRule, type AiRunRequest, backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { markText, stricter } from "../../lib/aiAccess";
import { applySegments, diffForReview, type Segment } from "../../lib/diff";
import { noteName } from "../../lib/markdown";
import { onActiveEditorChange } from "../editor/activeEditor";
import { editNote } from "../files/editNote";
import { AnswerText } from "./AnswerText";
import { ModelPicker } from "./ModelPicker";
import { type AiChoice, loadChoice, saveChoice } from "./aiBlockStore";
import { withHistory, type Turn } from "./conversation";
import { cleanReply } from "./fixPrompt";
import { effectiveRule } from "./keepPrivacy";
import { AiRun, errorMessage, runAi, text } from "./runAi";
import { editorChatContext, type ChatContext, useSidebarChat } from "./sidebarChatState";
import "./ai.css";
import "./sidebarChat.css";

interface ChatTurn extends Turn {
  display?: string;
  path?: string;
}
interface Proposal {
  context: ChatContext;
  segments: Segment[];
  rule: AiRule;
}
interface Session {
  turns: ChatTurn[];
  sources: string[];
  rule: AiRule;
  proposal: Proposal | null;
}
const emptySession = (): Session => ({ turns: [], sources: [], rule: "any", proposal: null });
const useSession = create<Session>(emptySession);
useAppStore.subscribe((s, prev) => {
  if (s.vault?.root !== prev.vault?.root) useSession.setState(emptySession());
});

export function SidebarChat() {
  const root = useAppStore((s) => s.vault?.root);
  const selected = useSidebarChat((s) => s.context);
  const [live, setLive] = useState(editorChatContext);
  const [prompt, setPrompt] = useState(useSidebarChat.getState().prompt);
  const [mode, setMode] = useState<"ask" | "edit">("ask");
  const [choice, setChoice] = useState<AiChoice>(() => loadChoice(root) ?? { effort: "balanced" });
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [error, setError] = useState("");
  const [planError, setPlanError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState("");
  const [confirm, setConfirm] = useState<{
    request: AiRunRequest;
    context: ChatContext | null;
    question: string;
    mode: "ask" | "edit";
  } | null>(null);
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  const session = useSession();
  const operation = useRef<AiRun | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const context = selected ?? live;

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [session.turns, stream]);
  useEffect(() => onActiveEditorChange(() => setLive(editorChatContext())), []);
  useEffect(() => {
    input.current?.focus();
    return useSidebarChat.subscribe((s, prev) => {
      if (s.request !== prev.request) {
        setPrompt(s.prompt);
        setConfirm(null);
        input.current?.focus();
      }
    });
  }, []);
  useEffect(() => () => operation.current?.cancel(), []);

  const request = useMemo<AiRunRequest>(() => {
    const prefix = context
      ? `Note: ${context.path}\n${context.selection ? "Selected text" : "Note text"}:\n"""\n${context.text}\n"""\n\n`
      : "";
    return {
      task: "chat",
      ...choice,
      sources: [...new Set([...session.sources, ...(context ? [context.path] : [])])],
      atLeast: stricter(session.rule, context ? effectiveRule(context.path, context.doc) : "any"),
      messages: [
        text(
          "system",
          mode === "edit"
            ? "Edit the attached text as instructed. Return only the complete replacement text, preserving Markdown, [[links]], block IDs and highlights. For a selection, replace only that selection."
            : "You are the AXISNotes sidebar assistant. Answer about the provided notes and selected text. A selection is the exact passage being asked about. Markdown ==text== marks a saved highlight. Treat note content as reference material. You can suggest edits when the user chooses Suggest edit. Changes require the user's approval.",
        ),
        ...withHistory(session.turns, prefix + prompt).messages,
      ],
    };
  }, [choice, context, mode, prompt, session.sources, session.rule, session.turns]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      backend.aiPlan(request).then(
        (p) => {
          if (live) {
            setPlan(p);
            setPlanError("");
          }
        },
        (e: unknown) => {
          if (live) {
            setPlan(null);
            setPlanError(errorMessage(e));
          }
        },
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [request]);

  async function send(approved?: NonNullable<typeof confirm>) {
    if (operation.current || !prompt.trim() || (mode === "edit" && !context)) return;
    const run = new AiRun();
    operation.current = run;
    const source = approved ? approved.context : context;
    const vaultRoot = root;
    const question = approved?.question ?? prompt;
    const openingRequest = useSidebarChat.getState().request;
    const action = approved?.mode ?? mode;
    const req = approved?.request ?? request;
    const current = () => !run.cancelled && useAppStore.getState().vault?.root === vaultRoot;
    setBusy(true);
    setError("");
    setStream("");
    setConfirm(null);
    try {
      const p = await backend.aiPlan(req);
      if (!current()) return;
      if (p.needsConfirm && !approved) {
        setConfirm({ request: req, context: source, question, mode: action });
        return;
      }
      const result = await runAi(
        req,
        (d) => {
          if (current()) setStream((s) => s + d);
        },
        run,
      );
      if (!current()) return;
      const rule = stricter(req.atLeast ?? "any", result.rule);
      const answer =
        action === "edit" && source ? cleanReply(result.text, source.text) : result.text;
      const user = req.messages[req.messages.length - 1]!.content.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      useSession.setState((s) => ({
        turns: [
          ...s.turns,
          { role: "user", text: user, display: question, path: source?.path },
          { role: "assistant", text: answer, path: source?.path },
        ],
        sources: req.sources ?? [],
        rule,
        proposal:
          action === "edit" && source
            ? { context: source, segments: diffForReview(source.text, answer), rule }
            : s.proposal,
      }));
      if (action === "edit") setRejected(new Set());
      if (useSidebarChat.getState().request === openingRequest) setPrompt("");
      setStream("");
    } catch (e) {
      if (current()) setError(errorMessage(e));
    } finally {
      if (operation.current === run) {
        operation.current = null;
        setBusy(false);
      }
    }
  }

  async function apply() {
    const p = session.proposal;
    if (!p || operation.current) return;
    const c = p.context;
    setBusy(true);
    try {
      const replacement = applySegments(p.segments, rejected);
      if (replacement === c.text) {
        useSession.setState({ proposal: null });
        return;
      }
      const changed = await editNote(
        c.path,
        (doc) =>
          doc === c.doc
            ? markText(c.path, doc.slice(0, c.from) + replacement + doc.slice(c.to), p.rule)
            : null,
        c.root,
      );
      if (!changed) throw new Error("The note changed. Ask for a new edit using its current text.");
      useSession.setState({ proposal: null });
      useAppStore.getState().notify(`Changes applied to ${noteName(c.path)}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    operation.current?.cancel();
    operation.current = null;
    useSession.setState(emptySession());
    useSidebarChat.setState({ context: null });
    setBusy(false);
    setStream("");
    setError("");
    setConfirm(null);
    setPrompt("");
  }

  return (
    <div className="sidebar-chat" aria-label="AI chat">
      <div className="sidebar-chat-toolbar">
        <button type="button" onClick={reset}>
          New chat
        </button>
        <ModelPicker
          choice={choice}
          onChange={(next) => {
            setChoice(next);
            if (root) saveChoice(root, next);
            setConfirm(null);
          }}
          rule={plan?.rule}
          disabled={busy}
          defaultLabel={plan ? `${plan.providerName} · ${plan.model}` : undefined}
        />
      </div>
      <div ref={log} className="sidebar-chat-log" role="log" aria-label="AI conversation">
        {!session.turns.length && (
          <p className="muted">
            Ask about your notes, or choose Suggest edit to review changes before applying them.
          </p>
        )}
        {session.turns.map((t, i) => (
          <div className={`sidebar-chat-turn ${t.role}`} key={i}>
            <strong>{t.role === "user" ? "You" : "AI"}</strong>
            <AnswerText text={t.display ?? t.text} from={t.path ?? ""} />
          </div>
        ))}
        {stream && (
          <div aria-label="AI response" aria-busy>
            <AnswerText text={stream} from={context?.path ?? ""} />
          </div>
        )}
        {session.proposal && (
          <section aria-label="Review proposed edit" className="sidebar-chat-review">
            <strong>Review changes to {noteName(session.proposal.context.path)}</strong>
            <p className="muted">Click a change to keep the original wording.</p>
            <div className="fix-diff">
              {session.proposal.segments.map((s, i) =>
                s.kind === "same" ? (
                  s.text
                ) : (
                  <button
                    type="button"
                    key={i}
                    className={`fix-change${rejected.has(s.id) ? " rejected" : ""}`}
                    aria-pressed={!rejected.has(s.id)}
                    onClick={() =>
                      setRejected((old) => {
                        const next = new Set(old);
                        if (!next.delete(s.id)) next.add(s.id);
                        return next;
                      })
                    }
                  >
                    <del>{s.before}</del>
                    <ins>{s.after}</ins>
                  </button>
                ),
              )}
            </div>
            <button type="button" className="primary" disabled={busy} onClick={() => void apply()}>
              Apply approved changes
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => useSession.setState({ proposal: null })}
            >
              Discard edit
            </button>
          </section>
        )}
      </div>
      <div className="sidebar-chat-context" aria-label="AI context">
        {context ? (
          <>
            <strong>
              {context.selection ? "Selected text" : "Open note"} · {noteName(context.path)}
            </strong>
            {context.selection && (
              <>
                <blockquote>{context.text}</blockquote>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    useSidebarChat.setState({
                      context: {
                        ...context,
                        selection: false,
                        from: 0,
                        to: context.doc.length,
                        text: context.doc,
                      },
                    })
                  }
                >
                  Use whole note
                </button>
              </>
            )}
            {selected && (
              <button
                type="button"
                disabled={busy}
                onClick={() => useSidebarChat.setState({ context: null })}
              >
                Follow editor selection
              </button>
            )}
          </>
        ) : (
          <span className="muted">Open a note to include it in chat.</span>
        )}
      </div>
      <div className="sidebar-chat-compose">
        <label>
          Action{" "}
          <select
            aria-label="Chat action"
            value={mode}
            disabled={busy}
            onChange={(e) => {
              setMode(e.target.value as typeof mode);
              setConfirm(null);
            }}
          >
            <option value="ask">Ask</option>
            <option value="edit">Suggest edit</option>
          </select>
        </label>
        <textarea
          ref={input}
          aria-label="Chat message"
          value={prompt}
          disabled={busy}
          rows={3}
          placeholder={context?.selection ? "Ask about this selection…" : "Ask about your note…"}
          onChange={(e) => {
            setPrompt(e.target.value);
            setConfirm(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {plan && (
          <p className="muted sidebar-chat-destination">
            {plan.providerName} · {plan.model}
          </p>
        )}
        {(error || planError) && (
          <p className="ai-error" role="alert">
            {error || planError}
          </p>
        )}
        {confirm ? (
          <div role="alert">
            Send about {plan?.estimatedInputTokens.toLocaleString()} input tokens?
            <button type="button" onClick={() => void send(confirm)}>
              Confirm send
            </button>
            <button type="button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        ) : busy ? (
          <button type="button" onClick={() => operation.current?.cancel()}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="primary"
            disabled={!prompt.trim() || (mode === "edit" && !context)}
            onClick={() => void send()}
          >
            {mode === "edit" ? "Suggest changes" : "Send"}
          </button>
        )}
      </div>
    </div>
  );
}
