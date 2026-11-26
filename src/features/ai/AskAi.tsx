import { useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  FileText,
  HardDrive,
  MessagesSquare,
  RotateCcw,
  Send,
  Square,
  X,
} from "lucide-react";
import { AiIcon } from "./AiIcon";
import {
  type AiEffort,
  type AiRule,
  type AiPlan,
  type AiRunRequest,
  type AiRunResult,
  type PassageRef,
  type VaultPassages,
  backend,
  isBackendError,
} from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { folderScope, MAX_FOLDER_NOTES } from "./folderScope";
import { getActiveEditor } from "../editor/activeEditor";
import { editNote } from "../files/editNote";
import { createUniqueNote } from "../commands/actions";
import { createDraft, folderOf } from "../drafts/drafts";
import { markText } from "../../lib/aiAccess";
import { raiseNoteRule } from "./keepPrivacy";
import { allTurns, conversationMarkdown, type Turn, withHistory } from "./conversation";
import { AnswerText } from "./AnswerText";
import { stricter } from "../../lib/aiAccess";
import { followLink } from "../commands/actions";
import { wikilinkLabel } from "../../lib/inlineMarkdown";
import { citeOf, citesPassage, passageSummary, VAULT_SYSTEM } from "./vaultAsk";
import "./ai.css";

// Ask an AI model about the open note (or a selection). Shows where the request goes and
// roughly how big it is before sending; streams the answer; can be stopped. The note is
// attached by path, so the Rust layer reads it and applies the folder's privacy rule.

export interface AskAiProps {
  /** Note to offer as context. */
  path?: string;
  /** Selected text in that note, if any. */
  selection?: string;
  /** A folder whose notes to offer as context ("" = the vault's top level). */
  folder?: string;
  /** "Ask your vault": find the passages that answer each question and cite them. */
  vault?: boolean;
  onClose(): void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "confirm"; plan: AiPlan }
  | { kind: "running"; runId: string }
  | { kind: "done"; result: AiRunResult }
  | { kind: "error"; message: string; blocked: boolean };

const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");
const folderName = (folder: string) =>
  folder ? folder.slice(folder.lastIndexOf("/") + 1) : "Vault";
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

const errorOf = (e: unknown): Phase => ({
  kind: "error",
  message: isBackendError(e) ? e.message : String(e),
  blocked: isBackendError(e) && e.code === "Blocked",
});

export function AskAi({ path, selection, folder, vault = false, onClose }: AskAiProps) {
  const [prompt, setPrompt] = useState("");
  const [useNote, setUseNote] = useState(Boolean(path) && !selection);
  const [useSelection, setUseSelection] = useState(Boolean(selection));
  const [effort, setEffort] = useState<AiEffort>("balanced");
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [answer, setAnswer] = useState("");
  /** Finished exchanges (question, answer, ...), including the latest once it's done. */
  const [turns, setTurns] = useState<Turn[]>([]);
  /** The question the current (or running) answer is for. */
  const [asked, setAsked] = useState("");
  /** The strictest rule of the conversation's answers: follow-ups are held to it. */
  const [convRule, setConvRule] = useState<AiRule>("any");
  /** Ask your vault: also use local-only notes (the request then needs a local model). */
  const [includeLocal, setIncludeLocal] = useState(false);
  /** Ask your vault: the passages found for the current question. */
  const [found, setFound] = useState<VaultPassages | null>(null);
  const [searching, setSearching] = useState(false);
  // Once a conversation has started, its earlier answers are sent again with each
  // follow-up: what it reads can't change, or a local-only answer could go to the cloud.
  const locked = turns.length > 0;
  /** Exchanges before the current question (the latest done one shows as the answer). */
  const earlier = phase.kind === "running" ? turns : turns.slice(0, -2);

  /** Start over: forget the conversation (what it reads can be changed again). */
  const restart = () => {
    setTurns([]);
    setConvRule("any");
    setFound(null);
    setAsked("");
    setAnswer("");
    setPhase({ kind: "idle" });
    inputRef.current?.focus();
  };
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isFolder = folder !== undefined;
  const [useFolder, setUseFolder] = useState(true);
  const [subfolders, setSubfolders] = useState(false);
  const notes = useAppStore((s) => s.notes);
  const rules = useConfig((s) => s.config.ai.folders);
  const scope = useMemo(
    () => (isFolder ? folderScope(notes, folder, subfolders, rules) : null),
    [isFolder, notes, folder, subfolders, rules],
  );

  useEffect(() => {
    backend.aiSettings().then(
      (v) => setEffort(v.settings.effort),
      () => {},
    );
  }, []);

  /** The request for the question in the box (with `passages` for Ask your vault). */
  const buildRequest = (passages: PassageRef[]): AiRunRequest => {
    const context =
      !vault && useSelection && selection ? `Selected text:\n"""\n${selection}\n"""\n\n` : "";
    const system = vault
      ? VAULT_SYSTEM
      : "You are a helpful assistant inside a Markdown note-taking app. Answer in Markdown." +
        (scope && useFolder
          ? ` The attached notes are the notes in the folder "${folderName(folder!)}"; mention a note by its name when you use it.`
          : "");
    return {
      task: "chat",
      effort,
      messages: [
        { role: "system", content: [{ type: "text", text: system }] },
        ...withHistory(turns, prompt, context).messages,
      ],
      attach: vault ? [] : scope ? (useFolder ? scope.include : []) : useNote && path ? [path] : [],
      sources: !vault && useSelection && selection && path ? [path] : [],
      ...(vault ? { passages: passages.map(({ path, heading }) => ({ path, heading })) } : {}),
      // Follow-ups re-send earlier answers: hold them to those answers' rule.
      ...(turns.length ? { atLeast: convRule } : {}),
    };
  };
  const request = useMemo(
    () => buildRequest([]),
    // buildRequest reads only these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      prompt,
      turns,
      useNote,
      useSelection,
      selection,
      path,
      effort,
      scope,
      useFolder,
      folder,
      vault,
      convRule,
    ],
  );

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
    if (!prompt.trim() || phase.kind === "running" || searching) return;
    let req = request;
    if (vault) {
      // Find the passages for this question (again after a confirm, so they're current).
      setSearching(true);
      let result: VaultPassages;
      try {
        result = await backend.vaultPassages(prompt, includeLocal);
      } catch (e) {
        setSearching(false);
        setPhase(errorOf(e));
        return;
      }
      setSearching(false);
      setFound(result);
      if (!result.passages.length) {
        setPhase({
          kind: "error",
          blocked: false,
          message:
            result.leftOut > 0
              ? `Only notes the AI may not read (${result.leftOut}) match this question.`
              : "No notes match this question. Try other words.",
        });
        return;
      }
      req = buildRequest(result.passages);
    }
    if (!confirmed) {
      // The plan only decides whether to ask first. If it fails (e.g. a privacy rule),
      // the run below reports the authoritative error and records it in the request log.
      const p = await backend.aiPlan(req).catch(() => null);
      if (p?.needsConfirm) {
        setPhase({ kind: "confirm", plan: p });
        return;
      }
    }
    const runId = crypto.randomUUID();
    setAnswer("");
    setAsked(prompt);
    setPhase({ kind: "running", runId });
    try {
      const result = await backend.aiRun(runId, req, (d) => setAnswer((a) => a + d));
      setAnswer(result.text);
      setPhase({ kind: "done", result });
      setConvRule((r) => stricter(r, result.rule));
      setTurns((t) => allTurns(t, prompt, result.text));
      setPrompt("");
    } catch (e) {
      if (isBackendError(e) && e.code === "Cancelled") setPhase({ kind: "idle" });
      else setPhase(errorOf(e));
    }
  }

  /** The privacy rule of what the answer was made from (see keepPrivacy.ts). */
  const answerRule = phase.kind === "done" ? phase.result.rule : "any";

  const insert = () => {
    const active = getActiveEditor();
    if (active && active.path === path) {
      const { view } = active;
      const at = view.state.selection.main;
      view.dispatch({
        changes: { from: at.from, to: at.to, insert: answer },
        selection: { anchor: at.from + answer.length },
      });
      if (path) void raiseNoteRule(path, answerRule);
      onClose();
      view.focus();
    }
  };

  const append = async () => {
    if (!path) return;
    try {
      await editNote(path, (text) => `${text.replace(/\s*$/, "")}\n\n${answer.trim()}\n`);
      useAppStore.getState().notify(`Added to ${noteName(path)}.`);
      await raiseNoteRule(path, answerRule);
      onClose();
    } catch (e) {
      setPhase(errorOf(e));
    }
  };

  /** Save a folder answer as a new note in that folder, and open it. */
  const saveAsNote = async () => {
    try {
      const created = await createUniqueNote(
        folder ?? "",
        "AI answer",
        markText("AI answer.md", `${answer.trim()}\n`, answerRule),
        ".md",
      );
      await useAppStore.getState().refreshTree();
      useAppStore.getState().openFile(created);
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
          <AiIcon size={15} /> <strong>{vault ? "Ask your vault" : "Ask AI"}</strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose} disabled={running}>
            <X size={15} />
          </button>
        </header>

        <div className="ask-ai-body">
          <textarea
            ref={inputRef}
            className="ask-ai-input"
            aria-label="Question"
            placeholder={
              locked
                ? "Ask a follow-up…"
                : vault
                  ? "Ask anything about your notes…"
                  : isFolder
                    ? `Ask about the notes in ${folderName(folder)}…`
                    : path
                      ? `Ask about ${noteName(path)}…`
                      : "Ask anything…"
            }
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
            {vault && (
              <label title="Notes set to “AI: local models only” are left out unless you tick this; then only a model on this computer can answer.">
                <input
                  type="checkbox"
                  checked={includeLocal}
                  disabled={running || locked}
                  onChange={(e) => setIncludeLocal(e.target.checked)}
                />
                Include local-only notes
              </label>
            )}
            {scope && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={useFolder}
                    disabled={running || locked}
                    onChange={(e) => setUseFolder(e.target.checked)}
                  />
                  Include {plural(scope.include.length, "note")} in “{folderName(folder!)}”
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={subfolders}
                    disabled={running || locked}
                    onChange={(e) => setSubfolders(e.target.checked)}
                  />
                  Subfolders
                </label>
              </>
            )}
            {path && !isFolder && (
              <label>
                <input
                  type="checkbox"
                  checked={useNote}
                  disabled={running || locked}
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
                  disabled={running || locked}
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

          {scope && useFolder && (scope.never.length > 0 || scope.overLimit > 0) && (
            <p className="ask-ai-skipped muted" aria-label="Left out">
              {scope.never.length > 0 && (
                <span title={scope.never.join("\n")}>
                  {plural(scope.never.length, "note")} marked “AI: never” left out.
                </span>
              )}
              {scope.overLimit > 0 && (
                <span>
                  {" "}
                  Only the first {MAX_FOLDER_NOTES} notes are sent; {scope.overLimit} more left out.
                </span>
              )}
            </p>
          )}
          {scope && useFolder && scope.include.length === 0 && (
            <p className="ask-ai-skipped muted">This folder has no notes the AI may read.</p>
          )}

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
          {vault && searching && <p className="muted ask-ai-found">Searching your notes…</p>}
          {vault && found && found.passages.length > 0 && (
            <details className="ask-ai-found" aria-label="Passages sent">
              <summary className="muted">
                Using {passageSummary(found.passages)}
                {found.leftOut > 0 && ` · ${plural(found.leftOut, "note")} left out by AI rules`}
              </summary>
              <ul>
                {found.passages.map((p, i) => (
                  <li key={i}>
                    {citeOf(p)} <span className="muted">~{p.tokens} tokens</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {phase.kind === "error" && (
            <p className="ai-error ask-ai-error" role="alert">
              {phase.blocked && "Not sent: "}
              {phase.message}
            </p>
          )}

          {earlier.length > 0 && (
            <div className="ask-ai-history" aria-label="Earlier in this conversation">
              {earlier.map((t, i) =>
                t.role === "user" ? (
                  <p key={i} className="ai-turn ai-turn-user">
                    <strong>You:</strong> {t.text}
                  </p>
                ) : (
                  <div key={i} className="ai-turn ai-turn-assistant">
                    <AnswerText text={t.text} from={path ?? ""} onFollow={onClose} />
                  </div>
                ),
              )}
              <p className="ai-turn ai-turn-user">
                <strong>You:</strong> {asked}
              </p>
            </div>
          )}
          {(answer || running) && (
            <div className="ask-ai-answer" aria-label="Answer" aria-busy={running}>
              <AnswerText
                text={answer}
                from={path ?? ""}
                onFollow={onClose}
                isKnown={
                  vault && found ? (inner) => citesPassage(inner, found.passages) : undefined
                }
              />
              {running && <span className="ask-ai-caret" aria-hidden />}
            </div>
          )}
          {vault && phase.kind === "done" && found && (
            <div className="ask-ai-sources" aria-label="Sources">
              <span className="muted">Sources:</span>
              {found.passages.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  className="inline-wikilink"
                  onClick={() => {
                    onClose();
                    void followLink(citeOf(p), "");
                  }}
                >
                  {wikilinkLabel(citeOf(p))}
                </button>
              ))}
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
              <button
                onClick={() =>
                  void createDraft({
                    title: asked.split(/\r?\n/)[0] ?? "",
                    content: `${answer.trim()}\n`,
                    folder: isFolder ? folder : path ? folderOf(path) : "",
                    rule: answerRule,
                  }).then(onClose, (e: unknown) => setPhase(errorOf(e)))
                }
              >
                <FileText size={13} /> Open as draft
              </button>
              <button onClick={() => void navigator.clipboard?.writeText(answer)}>
                <Copy size={13} /> Copy
              </button>
              {canInsert && <button onClick={insert}>Insert at cursor</button>}
              {path && !isFolder && <button onClick={() => void append()}>Append to note</button>}
              {isFolder && <button onClick={() => void saveAsNote()}>Save as a note here</button>}
              {turns.length > 2 && (
                <button
                  onClick={() =>
                    void createDraft({
                      title: turns[0]!.text.split(/\r?\n/)[0] ?? "",
                      content: conversationMarkdown(turns[0]!.text.split(/\r?\n/)[0] ?? "", turns),
                      folder: isFolder ? folder : path ? folderOf(path) : "",
                      rule: answerRule,
                    }).then(onClose, (e: unknown) => setPhase(errorOf(e)))
                  }
                >
                  <MessagesSquare size={13} /> Save conversation
                </button>
              )}
            </>
          )}
          {locked && !running && (
            <button onClick={restart} title="Forget this conversation and start over">
              <RotateCcw size={13} /> New question
            </button>
          )}
          <span className="ask-ai-spacer" />
          {running ? (
            <button onClick={() => phase.kind === "running" && void backend.aiCancel(phase.runId)}>
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
