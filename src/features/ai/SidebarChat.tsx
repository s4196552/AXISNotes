import { createElement, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Ellipsis, Square, SquarePen, X } from "lucide-react";
import { AiIcon } from "./AiIcon";
import { create } from "zustand";
import { type AiPlan, type AiRule, type AiRunRequest, backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { markText, stricter } from "../../lib/aiAccess";
import { applySegments, diffForReview, type Segment } from "../../lib/diff";
import { noteName } from "../../lib/markdown";
import { onActiveEditorChange } from "../editor/activeEditor";
import { editNote } from "../files/editNote";
import { AnswerText } from "./AnswerText";
import { EffortPicker, ModelPicker } from "./ModelPicker";
import { type AiChoice, loadChoice, saveChoice } from "./aiBlockStore";
import { withHistory, type Turn } from "./conversation";
import { cleanReply } from "./fixPrompt";
import { effectiveRule } from "./keepPrivacy";
import { AiRun, errorMessage, runAi, text } from "./runAi";
import { editorChatContext, type ChatContext, useSidebarChat } from "./sidebarChatState";
import { PAGE_SANDBOX } from "../drafts/WebFileView";
import { copyPageText } from "../skills/copyable";
import { folderOf } from "../drafts/drafts";
import { skillIcon } from "../skills/skillIcons";
import { groupSkills } from "../skills/skillGroups";
import { runSkillOnPicked } from "../skills/skillOnFiles";
import { skillPrompt } from "../skills/skillRun";
import { type Skill, useSkills } from "../skills/skills";
import { type ChatSkill, chatSkill, featuredSkills, skillAction } from "./sidebarChatSkills";
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
  /** The skill this conversation runs (from a skill picked on the welcome screen). */
  skill: ChatSkill | null;
}
const emptySession = (): Session => ({
  turns: [],
  sources: [],
  rule: "any",
  proposal: null,
  skill: null,
});
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

/** A skill's icon (a wand for the user's own skills). */
function SkillGlyph({ id, size }: { id: string; size: number }) {
  return createElement(skillIcon(id), { size, "aria-hidden": true });
}

/** A message ready to send, kept while the user confirms a large request. */
interface Pending {
  request: AiRunRequest;
  context: ChatContext | null;
  question: string;
  mode: "ask" | "edit";
  format: SidebarFormat;
  skill: ChatSkill | null;
}

const EDIT_SYSTEM =
  "Edit the attached text as instructed. Return only the complete replacement text, preserving Markdown, [[links]], block IDs and highlights. For a selection, replace only that selection.";
const SKILL_IN_CHAT =
  "\n\nThis runs in the AXISNotes sidebar chat: the attached note's text is in the user's first message. Use [[note links]] when referring to it.";

function buildRequest(o: {
  ask: string;
  choice: AiChoice;
  context: ChatContext | null;
  format: SidebarFormat;
  mode: "ask" | "edit";
  skill: ChatSkill | null;
  session: Session;
}): AiRunRequest {
  const { context, session } = o;
  const prefix = context
    ? `Note: ${context.path}\n${context.selection ? "Selected text" : "Note text"}:\n"""\n${context.text}\n"""\n\n`
    : "";
  const system =
    o.mode === "edit"
      ? EDIT_SYSTEM
      : o.skill
        ? o.skill.system + SKILL_IN_CHAT
        : (o.format === "html"
            ? `You are the AXISNotes sidebar assistant. ${HTML_ANSWER_INSTRUCTIONS} `
            : "You are the AXISNotes sidebar assistant. Answer in Markdown. You may use AXISNotes blocks: headings, lists, task lists, tables, fenced code, blockquotes, ==highlights== and callouts such as > [!tip] Title or > [!note]- Collapsed title, with each body line prefixed by >. Use [[note links]] when referring to provided notes. ") +
          "Answer about the provided notes and selected text. A selection is the exact passage being asked about. Treat note content as reference material. You can suggest edits when the user chooses Suggest edit. Changes require the user's approval.";
  return {
    task: "chat",
    ...o.choice,
    sources: [
      ...new Set([...session.sources, ...(context ? (context.sources ?? [context.path]) : [])]),
    ],
    atLeast: stricter(
      session.rule,
      context ? stricter(context.rule ?? "any", effectiveRule(context.path, context.doc)) : "any",
    ),
    // A skill's page is long.
    ...(o.mode === "ask" && o.skill?.format === "html" ? { maxOutputTokens: 16000 } : {}),
    messages: [text("system", system), ...withHistory(session.turns, prefix + o.ask).messages],
  };
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
  const [streamFormat, setStreamFormat] = useState<SidebarFormat>("markdown");
  const [confirm, setConfirm] = useState<Pending | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [allSkills, setAllSkills] = useState(false);
  const skills = useSkills((s) => s.skills);
  const [rejected, setRejected] = useState<Set<number>>(new Set());
  const session = useSession();
  const operation = useRef<AiRun | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!optionsOpen) return;
    const onDown = (e: MouseEvent) => {
      if (options.current && !options.current.contains(e.target as Node)) setOptionsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [optionsOpen]);

  // An active skill answers in its own format; Suggest edit always answers in Markdown.
  const answerFormat: SidebarFormat =
    mode === "edit" ? "markdown" : (session.skill?.format ?? format);
  const request = useMemo<AiRunRequest>(
    () =>
      buildRequest({ ask: prompt, choice, context, format, mode, skill: session.skill, session }),
    [choice, context, format, mode, prompt, session],
  );

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

  async function send(pending?: Pending, approved = false) {
    if (operation.current) return;
    if (!pending && (!prompt.trim() || (mode === "edit" && !context))) return;
    const job: Pending = pending ?? {
      request,
      context,
      question: prompt,
      mode,
      format: answerFormat,
      skill: session.skill,
    };
    const run = new AiRun();
    operation.current = run;
    const source = job.context;
    const vaultRoot = root;
    const question = job.question;
    const openingRequest = useSidebarChat.getState().request;
    const action = job.mode;
    if (action === "edit" && (source?.sources?.length ?? 0) > 1) {
      operation.current = null;
      setError("Choose one attached note to suggest edits.");
      return;
    }
    const outFormat = action === "edit" ? "markdown" : job.format;
    setStreamFormat(outFormat);
    const req = job.request;
    const current = () => !run.cancelled && useAppStore.getState().vault?.root === vaultRoot;
    setBusy(true);
    setError("");
    setStream("");
    setConfirm(null);
    try {
      const p = await backend.aiPlan(req);
      if (!current()) return;
      if (p.needsConfirm && !approved) {
        setConfirm(job);
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
      if (outFormat === "html" && vaultRoot) {
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
            format: outFormat,
            page,
            pageError,
            rule,
          },
        ],
        sources: req.sources ?? [],
        rule,
        skill: job.skill,
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

  /** Run a skill from the welcome screen on the note in context (and any typed request). */
  function startSkill(skill: Skill) {
    if (operation.current) return;
    if (!context) {
      setError("Open a note to use a skill on it.");
      return;
    }
    const run = chatSkill(skill, format);
    if (!run) {
      // Study-block notes and lesson folders are made as files, as from the file tree.
      void runSkillOnPicked(
        skill,
        skill.reads === "folder" ? [folderOf(context.path)] : (context.sources ?? [context.path]),
      );
      return;
    }
    const typed = prompt.trim();
    setMode("ask");
    void send({
      request: buildRequest({
        ask: skillPrompt(skill, typed),
        choice,
        context,
        format: run.format,
        mode: "ask",
        skill: run,
        session,
      }),
      context,
      question: typed ? `${skillAction(skill)}: ${typed}` : skillAction(skill),
      mode: "ask",
      format: run.format,
      skill: run,
    });
  }

  function updateChoice(next: AiChoice) {
    setChoice(next);
    if (root) saveChoice(root, next);
    setConfirm(null);
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

  const empty = !session.turns.length && !stream && !session.proposal;
  const featured = featuredSkills(skills);
  const moreGroups = groupSkills(skills.filter((sk) => !featured.includes(sk)));
  const firstQuestion = session.turns.find((t) => t.role === "user");
  const title = firstQuestion ? (firstQuestion.display ?? firstQuestion.text) : "New AI chat";
  const skillButton = (sk: Skill) => {
    return (
      <li key={sk.id}>
        <button
          type="button"
          className="sidebar-chat-skill"
          disabled={busy || !context}
          title={context ? sk.description : "Open a note to use a skill on it."}
          onClick={() => startSkill(sk)}
        >
          <SkillGlyph id={sk.id} size={16} />
          <span>{skillAction(sk)}</span>
        </button>
      </li>
    );
  };

  return (
    <div className="sidebar-chat" aria-label="AI chat">
      <div className="sidebar-chat-header">
        <span className="sidebar-chat-title" title={title}>
          {title}
        </span>
        <button
          type="button"
          className="sidebar-chat-icon"
          aria-label="New chat"
          title="New chat"
          onClick={reset}
        >
          <SquarePen size={15} aria-hidden />
        </button>
        <div className="sidebar-chat-options-wrap" ref={options}>
          <button
            type="button"
            className="sidebar-chat-icon"
            aria-label="Chat options"
            title="Chat options"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((o) => !o)}
          >
            <Ellipsis size={15} aria-hidden />
          </button>
          {optionsOpen && (
            <div className="sidebar-chat-options" role="group" aria-label="Answer options">
              <label className="sidebar-chat-display">
                Format
                <select
                  aria-label="Answer format"
                  value={answerFormat}
                  disabled={busy || mode === "edit" || !!session.skill}
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
            </div>
          )}
        </div>
      </div>
      <div
        ref={log}
        className={empty ? "sidebar-chat-log empty" : "sidebar-chat-log"}
        role="log"
        aria-label="AI conversation"
      >
        {empty && (
          <div className="sidebar-chat-welcome">
            <span className="sidebar-chat-avatar" aria-hidden>
              <AiIcon size={22} />
            </span>
            <h2>What should we work on?</h2>
            <p className="muted">
              {context
                ? "Ask about your notes, choose Suggest edit to review changes before applying them, or start with a skill."
                : "Ask anything, or open a note to use a skill on it."}
            </p>
            <ul className="sidebar-chat-skills" aria-label="Skills">
              {featured.map(skillButton)}
              {moreGroups.length > 0 && (
                <li>
                  <button
                    type="button"
                    className="sidebar-chat-skill more"
                    aria-expanded={allSkills}
                    onClick={() => setAllSkills((v) => !v)}
                  >
                    <ChevronDown size={16} aria-hidden />
                    <span>{allSkills ? "Fewer skills" : "More skills"}</span>
                  </button>
                </li>
              )}
            </ul>
            {allSkills &&
              moreGroups.map((g) => (
                <section key={g.name} className="sidebar-chat-skill-group" aria-label={g.name}>
                  <h3>{g.name}</h3>
                  <ul className="sidebar-chat-skills">{g.skills.map(skillButton)}</ul>
                </section>
              ))}
          </div>
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
            ) : streamFormat === "html" ? (
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
      <div className="sidebar-chat-compose">
        <div className="sidebar-chat-box">
          <div className="sidebar-chat-context" aria-label="AI context">
            {session.skill && (
              <span className="sidebar-chat-skill-chip">
                <SkillGlyph id={session.skill.id} size={12} />
                {session.skill.title}
                <button
                  type="button"
                  aria-label={`Stop using ${session.skill.title}`}
                  title="Stop using this skill"
                  disabled={busy}
                  onClick={() => useSession.setState({ skill: null })}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            )}
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
          <textarea
            ref={input}
            aria-label="Chat message"
            value={prompt}
            disabled={busy}
            rows={2}
            placeholder={
              session.skill
                ? `Reply to ${session.skill.title}…`
                : context?.selection
                  ? "Ask about this selection…"
                  : context
                    ? "Ask about your note…"
                    : "Ask AI anything…"
            }
            onChange={(e) => {
              setPrompt(e.target.value);
              setConfirm(null);
            }}
            onKeyDown={(e) => {
              // Enter sends (Ctrl+Enter too); Shift+Enter starts a new line.
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="sidebar-chat-controls">
            <select
              aria-label="Chat action"
              className="sidebar-chat-action"
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
            <ModelPicker
              choice={choice}
              onChange={updateChoice}
              rule={plan?.rule}
              disabled={busy}
              separateEffort
              above
              defaultName={plan?.model}
              defaultLabel={plan ? `${plan.providerName} · ${plan.model}` : undefined}
            />
            <EffortPicker
              effort={choice.effort}
              onChange={(effort) => updateChoice({ ...choice, effort })}
              disabled={busy}
              above
            />
            <span className="sidebar-chat-spacer" />
            {busy ? (
              <button
                type="button"
                className="sidebar-chat-send"
                aria-label="Stop"
                title="Stop"
                onClick={() => operation.current?.cancel()}
              >
                <Square size={12} aria-hidden fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="sidebar-chat-send"
                aria-label={mode === "edit" ? "Suggest changes" : "Send"}
                title={mode === "edit" ? "Suggest changes (Enter)" : "Send (Enter)"}
                disabled={!prompt.trim() || (mode === "edit" && !context) || !!confirm}
                onClick={() => void send()}
              >
                <ArrowUp size={16} aria-hidden />
              </button>
            )}
          </div>
        </div>
        {plan && (
          <p className="muted sidebar-chat-destination">
            Sends to {plan.providerName} · {plan.model}
          </p>
        )}
        {(error || planError) && (
          <p className="ai-error" role="alert">
            {error || planError}
          </p>
        )}
        {confirm && (
          <div role="alert" className="sidebar-chat-confirm">
            Send about {plan?.estimatedInputTokens.toLocaleString()} input tokens?
            <button type="button" onClick={() => void send(confirm, true)}>
              Confirm send
            </button>
            <button type="button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
