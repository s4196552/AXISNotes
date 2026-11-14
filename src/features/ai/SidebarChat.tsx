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
import { PAGE_SANDBOX } from "../drafts/WebFileView";
import { copyPageText } from "../skills/copyable";
import {
  HTML_ANSWER_INSTRUCTIONS,
  loadSidebarFormat,
  saveSidebarFormat,
  saveSidebarPage,
  type SidebarFormat,
} from "./sidebarChatOutput";
import "./ai.css";
import "./sidebarChat.css";

interface ChatTurn extends Turn {
  display?: string;
  path?: string;
  format?: SidebarFormat;
  page?: string;
  pageError?: string;
  rule?: AiRule;
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

function HtmlAnswer({ path }: { path: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    let last = 0;
    const zoom = (event: MessageEvent) => {
      const target = frame.current;
      if (
        !target ||
        event.source !== target.contentWindow ||
        (document.activeElement !== target && !target.matches(":hover"))
      )
        return;
      const value: unknown = event.data;
      if (!value || typeof value !== "object" || !("axisSidebarZoom" in value)) return;
      const direction = value.axisSidebarZoom;
      if ((direction !== 1 && direction !== -1) || Date.now() - last < 80) return;
      last = Date.now();
      // Delegate only this bounded UI action to the existing per-area zoom handler.
      target.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: direction > 0 ? -100 : 100,
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    window.addEventListener("message", zoom);
    return () => window.removeEventListener("message", zoom);
  }, []);
  return (
    <iframe
      ref={frame}
      className="sidebar-chat-html"
      title="AI HTML answer"
      name="axis-sidebar-html"
      loading="lazy"
      src={backend.pageUrl(path)!}
      sandbox={PAGE_SANDBOX}
      referrerPolicy="no-referrer"
    />
  );
}

export function SidebarChat() {
  const root = useAppStore((s) => s.vault?.root);
  const selected = useSidebarChat((s) => s.context);
  const [live, setLive] = useState(editorChatContext);
  const [prompt, setPrompt] = useState(useSidebarChat.getState().prompt);
  const [chosenMode, setMode] = useState<"ask" | "edit">("ask");
  const [display, setDisplay] = useState<"markdown" | "source">("markdown");
  const [format, setFormat] = useState<SidebarFormat>(() => loadSidebarFormat(root));
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
    format: SidebarFormat;
  } | null>(null);
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  const session = useSession();
  const operation = useRef<AiRun | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const candidate = selected ?? live;
  const context = candidate?.root === root ? candidate : null;
  const mode = (context?.sources?.length ?? 0) > 1 ? "ask" : chosenMode;

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
      sources: [
        ...new Set([...session.sources, ...(context ? (context.sources ?? [context.path]) : [])]),
      ],
      atLeast: stricter(
        session.rule,
        context ? stricter(context.rule ?? "any", effectiveRule(context.path, context.doc)) : "any",
      ),
      messages: [
        text(
          "system",
          mode === "edit"
            ? "Edit the attached text as instructed. Return only the complete replacement text, preserving Markdown, [[links]], block IDs and highlights. For a selection, replace only that selection."
            : (format === "html"
                ? `You are the AXISNotes sidebar assistant. ${HTML_ANSWER_INSTRUCTIONS} `
                : "You are the AXISNotes sidebar assistant. Answer in Markdown. You may use AXISNotes blocks: headings, lists, task lists, tables, fenced code, blockquotes, ==highlights== and callouts such as > [!tip] Title or > [!note]- Collapsed title, with each body line prefixed by >. Use [[note links]] when referring to provided notes. ") +
                "Answer about the provided notes and selected text. A selection is the exact passage being asked about. Treat note content as reference material. You can suggest edits when the user chooses Suggest edit. Changes require the user's approval.",
        ),
        ...withHistory(session.turns, prefix + prompt).messages,
      ],
    };
  }, [choice, context, format, mode, prompt, session.sources, session.rule, session.turns]);

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
    if (action === "edit" && (source?.sources?.length ?? 0) > 1) {
      operation.current = null;
      setError("Choose one attached note to suggest edits.");
      return;
    }
    const answerFormat = action === "edit" ? "markdown" : (approved?.format ?? format);
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
        setConfirm({ request: req, context: source, question, mode: action, format: answerFormat });
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
      let page: string | undefined, pageError: string | undefined;
      if (answerFormat === "html" && vaultRoot) {
        try {
          page = await saveSidebarPage(answer, rule, vaultRoot);
        } catch (e) {
          pageError = errorMessage(e);
        }
        if (!current()) return;
      }
      const user = req.messages[req.messages.length - 1]!.content.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      useSession.setState((s) => ({
        turns: [
          ...s.turns,
          { role: "user", text: user, display: question, path: source?.path },
          {
            role: "assistant",
            text: answer,
            path: source?.path,
            format: answerFormat,
            page,
            pageError,
            rule,
          },
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

  async function copyAnswer(turn: ChatTurn, plain = false) {
    try {
      if (plain) useAppStore.getState().notify(await copyPageText(turn.text));
      else {
        await navigator.clipboard.writeText(turn.text);
        useAppStore.getState().notify("Copied AI answer.");
      }
    } catch (e) {
      useAppStore.getState().notify(`Couldn't copy the answer: ${errorMessage(e)}`);
    }
  }

  async function retryPage(turn: ChatTurn) {
    const vaultRoot = root;
    if (!vaultRoot) return;
    setError("");
    try {
      const page = await saveSidebarPage(turn.text, turn.rule ?? "any", vaultRoot);
      if (useAppStore.getState().vault?.root !== vaultRoot) return;
      useSession.setState((s) => ({
        turns: s.turns.map((t) => (t === turn ? { ...t, page, pageError: undefined } : t)),
      }));
    } catch (e) {
      if (useAppStore.getState().vault?.root === vaultRoot) setError(errorMessage(e));
    }
  }

  return (
    <div className="sidebar-chat" aria-label="AI chat">
      <div className="sidebar-chat-toolbar">
        <button type="button" onClick={reset}>
          New chat
        </button>
        <label className="sidebar-chat-display">
          Format
          <select
            aria-label="Answer format"
            value={mode === "edit" ? "markdown" : format}
            disabled={busy || mode === "edit"}
            onChange={(e) => {
              const next = e.target.value as SidebarFormat;
              setFormat(next);
              saveSidebarFormat(root, next);
              setConfirm(null);
            }}
          >
            <option value="markdown">Markdown</option>
            <option value="html">HTML</option>
          </select>
        </label>
        <label className="sidebar-chat-display">
          View
          <select
            aria-label="Answer display"
            value={display}
            onChange={(e) => setDisplay(e.target.value as typeof display)}
          >
            <option value="markdown">Rendered</option>
            <option value="source">Source</option>
          </select>
        </label>
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
            {t.role === "assistant" && (
              <div className="sidebar-chat-answer-actions">
                <button type="button" onClick={() => void copyAnswer(t)}>
                  Copy answer
                </button>
                {t.format === "html" && (
                  <button type="button" onClick={() => void copyAnswer(t, true)}>
                    Copy text
                  </button>
                )}
                {t.page && (
                  <button
                    type="button"
                    onClick={() =>
                      useAppStore.getState().openFile(t.page!, undefined, { newTab: true })
                    }
                  >
                    Open HTML page
                  </button>
                )}
              </div>
            )}
            {t.role === "assistant" && display === "source" ? (
              <pre className="sidebar-chat-source">{t.text}</pre>
            ) : t.role === "assistant" && t.format === "html" ? (
              <>
                {t.page && backend.pageUrl(t.page) ? (
                  <HtmlAnswer path={t.page} />
                ) : (
                  <pre className="sidebar-chat-source">{t.text}</pre>
                )}
                {t.pageError && (
                  <p className="ai-error" role="alert">
                    {t.pageError}{" "}
                    <button type="button" onClick={() => void retryPage(t)}>
                      Retry HTML preview
                    </button>
                  </p>
                )}
              </>
            ) : (
              <AnswerText text={t.display ?? t.text} from={t.path ?? ""} />
            )}
          </div>
        ))}
        {stream && (
          <div aria-label="AI response" aria-busy>
            {display === "source" ? (
              <pre className="sidebar-chat-source">{stream}</pre>
            ) : mode === "ask" && format === "html" ? (
              <p className="muted">Writing HTML… {stream.length.toLocaleString()} characters</p>
            ) : (
              <AnswerText text={stream} from={context?.path ?? ""} />
            )}
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
            {context.selection ? (
              <details>
                <summary>Selected text · {noteName(context.path)}</summary>
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
              </details>
            ) : context.sources ? (
              <details>
                <summary>Attached notes · {context.sources.length}</summary>
                <ul>
                  {context.sources.map((path) => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              </details>
            ) : (
              <strong>Open note · {noteName(context.path)}</strong>
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
            <option value="edit" disabled={(context?.sources?.length ?? 0) > 1}>
              Suggest edit
            </option>
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
