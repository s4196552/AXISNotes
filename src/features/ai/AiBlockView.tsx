import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  Copy,
  FileText,
  CornerDownLeft,
  Eraser,
  HardDrive,
  MessagesSquare,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { type AiPlan, type AiRunRequest, backend, isBackendError } from "../../ipc";
import { stricter } from "../../lib/aiAccess";
import { useAppStore } from "../../app/store";
import { aiBlockSpec, closeAiBlock, insertionFor } from "./aiBlock";
import { createDraft } from "../drafts/drafts";
import { raiseNoteRule } from "./keepPrivacy";
import { allTurns, conversationMarkdown, withHistory } from "./conversation";
import { AnswerText } from "./AnswerText";
import {
  type AiBlockPhase,
  type AiBlockState,
  type AiChoice,
  loadChoice,
  promptCallout,
  saveChoice,
  useAiBlocks,
} from "./aiBlockStore";
import { ModelPicker } from "./ModelPicker";
import {
  defaultFormat,
  FORMAT_LABELS,
  formatsOf,
  freshSkill,
  useSkills,
  withFormat,
} from "../skills/skills";
import {
  homeFolder,
  runSkill,
  saveConversation,
  savePageNextTo,
  skillPrompt,
  skillRequest,
  writeFiles,
} from "../skills/skillRun";
import { ChatActions, ChatTranscript, FilesResult, PageResult } from "../skills/SkillResult";
import { skillIcon } from "../skills/skillIcons";
import { useUi } from "../commands/ui";
import { cleanReply } from "./fixPrompt";
// The block is the first AI view many sessions open: load its styles with it.
import "./ai.css";

// One AI block in a note: a prompt, what the request reads (this note, the selection),
// the model and effort, then the streamed answer to insert, retry or discard. The note
// is attached by path, so the Rust layer reads it and applies its AI rule.

export interface AiBlockProps {
  id: string;
  /** The note the block is in. */
  path: string;
  view: EditorView;
}

const SYSTEM =
  "You are an assistant inside a Markdown note-taking app. The user typed this request in a " +
  "note. Reply with Markdown that can go straight into the note: no preamble, no closing remarks.";

const noteName = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

const errorPhase = (e: unknown): AiBlockPhase => ({
  kind: "error",
  message: isBackendError(e) ? e.message : String(e),
  blocked: isBackendError(e) && e.code === "Blocked",
});

function initialState(hasSelection: boolean, skill: string | null): AiBlockState {
  const vault = useAppStore.getState().vault?.root;
  return {
    skill,
    turns: [],
    html: null,
    files: null,
    prompt: "",
    useNote: !hasSelection,
    useSelection: hasSelection,
    keepPrompt: false,
    choice: loadChoice(vault) ?? { effort: "balanced" },
    phase: { kind: "idle" },
    answer: "",
  };
}

export function AiBlock({ id, path, view }: AiBlockProps) {
  const spec = aiBlockSpec(view.state, id);
  const selection = spec?.selection;
  const state = useAiBlocks((s) => s.blocks[id]);
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const fresh = useRef(!useAiBlocks.getState().blocks[id]);
  const baseSkill =
    useSkills((s) => (state?.skill ? s.skills.find((k) => k.id === state.skill) : undefined)) ??
    null;
  // The skill as it runs in the chosen format (Markdown, HTML or, for Teach, both).
  const skill = useMemo(
    () => (baseSkill ? withFormat(baseSkill, state?.format) : null),
    [baseSkill, state?.format],
  );
  const format = baseSkill ? (state?.format ?? defaultFormat(baseSkill)) : null;

  useEffect(() => {
    if (useAiBlocks.getState().blocks[id]) return;
    useAiBlocks.getState().init(id, initialState(Boolean(selection?.text), spec?.skill ?? null));
    // Without a remembered choice, start from the effort set in Settings → AI.
    if (!loadChoice(useAppStore.getState().vault?.root))
      backend.aiSettings().then(
        (v) =>
          useAiBlocks.getState().patch(id, {
            choice: { ...useAiBlocks.getState().blocks[id]!.choice, effort: v.settings.effort },
          }),
        () => {},
      );
  }, [id, path, selection?.text, spec?.skill]);

  useEffect(() => {
    if (fresh.current && state) {
      fresh.current = false;
      input.current?.focus();
    }
  }, [state]);

  const patch = (p: Partial<AiBlockState>) => useAiBlocks.getState().patch(id, p);

  /** The request a state would send (run builds it from the latest state). */
  const requestFor = (cur: AiBlockState): AiRunRequest => {
    if (skill)
      return skillRequest({
        skill,
        prompt: cur.prompt,
        turns: cur.turns ?? [],
        conversationRule: cur.convRule,
        path,
        useNote: cur.useNote,
        sources: spec?.sources,
        selectionText: cur.useSelection ? selection?.text : undefined,
        choice: cur.choice,
      });
    const sel = cur.useSelection && selection?.text;
    const context = sel ? `Selected text:\n"""\n${selection.text}\n"""\n\n` : "";
    return {
      task: "chat",
      effort: cur.choice.effort,
      provider: cur.choice.provider,
      model: cur.choice.model,
      messages: [
        { role: "system", content: [{ type: "text", text: SYSTEM }] },
        // Earlier exchanges go too, so a follow-up knows what was said.
        ...withHistory(cur.turns ?? [], cur.prompt, context).messages,
      ],
      attach: cur.useNote ? [path] : [],
      // Follow-ups re-send earlier answers: hold them to those answers' rule.
      ...(cur.turns?.length && cur.convRule ? { atLeast: cur.convRule } : {}),
      sources: sel ? [path] : [],
    };
  };
  const request = useMemo(
    (): AiRunRequest | null => (state ? requestFor(state) : null),
    // requestFor reads only these.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, selection, path, skill, spec?.sources],
  );

  // Where the request would go (debounced while typing).
  useEffect(() => {
    if (!request) return;
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

  if (!state || !request) return null;
  const { phase } = state;
  const running = phase.kind === "running";
  /** The privacy rule of what the answer was made from (see keepPrivacy.ts). */
  const answerRule = phase.kind === "done" ? phase.result.rule : "any";
  /**
   * A plain prompt with a conversation: earlier answers are sent again with each
   * follow-up, so what it reads can't change (a local-only answer could go to the cloud).
   */
  const chatting = (state.turns?.length ?? 0) > 0;
  /** Exchanges before the current question (the latest done one shows as the answer). */
  const earlier = !skill ? (running ? (state.turns ?? []) : (state.turns ?? []).slice(0, -2)) : [];

  /** Ask the current question again, with the conversation as it was before it. */
  const retry = () => {
    if (!skill && state.asked)
      patch({ turns: (state.turns ?? []).slice(0, -2), prompt: state.asked });
    void run();
  };

  /** Forget the conversation; what the block reads can be changed again. */
  const restart = () => {
    patch({
      turns: [],
      asked: "",
      answer: "",
      prompt: "",
      convRule: "any",
      phase: { kind: "idle" },
    });
    input.current?.focus();
  };

  async function run(confirmed = false) {
    const cur = useAiBlocks.getState().blocks[id];
    if (!cur || (!cur.prompt.trim() && !skill) || cur.phase.kind === "running") return;
    const req = requestFor(cur);
    if (!confirmed) {
      const p = await backend.aiPlan(req).catch(() => null);
      if (p?.needsConfirm) {
        patch({ phase: { kind: "confirm", plan: p } });
        return;
      }
    }
    if (skill) return runTheSkill(cur);
    const runId = crypto.randomUUID();
    const question = cur.prompt;
    patch({ answer: "", asked: question, phase: { kind: "running", runId, thinking: true } });
    try {
      const result = await backend.aiRun(runId, req, (d) =>
        useAiBlocks.getState().appendAnswer(id, d),
      );
      // The exchange joins the conversation; the box is ready for a follow-up.
      patch({
        answer: result.text,
        phase: { kind: "done", result },
        turns: allTurns(cur.turns ?? [], question, result.text),
        convRule: stricter(cur.convRule ?? "any", result.rule),
        prompt: "",
      });
    } catch (e) {
      if (!useAiBlocks.getState().blocks[id]) return; // closed meanwhile
      patch({
        phase: isBackendError(e) && e.code === "Cancelled" ? { kind: "idle" } : errorPhase(e),
      });
    }
  }

  async function runTheSkill(cur: AiBlockState) {
    const s = withFormat((await freshSkill(baseSkill!.id)) ?? baseSkill!, cur.format);
    const req = skillRequest({
      skill: s,
      prompt: cur.prompt,
      turns: cur.turns ?? [],
      conversationRule: cur.convRule,
      path,
      useNote: cur.useNote,
      sources: spec?.sources,
      selectionText: cur.useSelection ? selection?.text : undefined,
      choice: cur.choice,
    });
    const asked = skillPrompt(s, cur.prompt);
    patch({
      answer: "",
      html: null,
      files: null,
      saveError: undefined,
      phase: { kind: "running", runId: "", thinking: true },
    });
    try {
      const out = await runSkill(
        s,
        req,
        (runId) => patch({ answer: "", phase: { kind: "running", runId, thinking: true } }),
        (d) => useAiBlocks.getState().appendAnswer(id, d),
      );
      if (!useAiBlocks.getState().blocks[id]) return;
      const done = { kind: "done" as const, result: out.result };
      // What a skill makes is saved at once, with the AI icon; a save that fails leaves
      // the result shown with a button to try again.
      const keep = async (save: () => Promise<string[]>) => {
        try {
          return await save();
        } catch (e) {
          const why = isBackendError(e) ? e.message : String(e);
          patch({ saveError: `Couldn't save the result: ${why}` });
          return [];
        }
      };
      if (out.kind === "html") {
        const saved = await keep(async () => [await savePageNextTo(path, s, out.html)]);
        patch({ html: out.html, saved, answer: "", phase: done });
      } else if (out.kind === "files") {
        patch({ saved: [] });
        try {
          await writeFiles(homeFolder(path), out.files.files, [], (saved) => patch({ saved }));
        } catch (e) {
          patch({ saveError: isBackendError(e) || e instanceof Error ? e.message : String(e) });
        }
        patch({ files: out.files, answer: "", phase: done });
      } else if (s.output === "chat") {
        const turns = [
          ...(cur.turns ?? []),
          { role: "user" as const, text: asked },
          { role: "assistant" as const, text: out.result.text },
        ];
        // The conversation is saved after every reply, and kept up to date.
        const convRule = stricter(cur.convRule ?? "any", out.result.rule);
        const saved = await keep(() =>
          saveConversation(path, s, format === "html", turns, convRule, cur.saved),
        );
        patch({
          turns,
          convRule,
          saved: saved.length ? saved : cur.saved,
          transcriptUnsaved: !saved.length,
          answer: "",
          prompt: "",
          phase: done,
        });
      } else patch({ answer: out.result.text, phase: done });
    } catch (e) {
      if (!useAiBlocks.getState().blocks[id]) return; // closed meanwhile
      patch({
        phase: isBackendError(e) && e.code === "Cancelled" ? { kind: "idle" } : errorPhase(e),
      });
    }
  }

  const setChoice = (choice: AiChoice) => {
    patch({ choice });
    saveChoice(useAppStore.getState().vault?.root, choice);
  };

  const close = () => {
    if (phase.kind === "running") void backend.aiCancel(phase.runId);
    closeAiBlock(view, id);
  };

  const insert = (replace: boolean) => {
    const cur = aiBlockSpec(view.state, id);
    if (!cur) return;
    const prefix = state.keepPrompt ? promptCallout(state.asked ?? state.prompt) : "";
    const change =
      replace && cur.selection
        ? {
            from: cur.selection.from,
            to: cur.selection.to,
            insert: state.answer.replace(/\s+$/, ""),
          }
        : insertionFor(view.state, cur.pos, prefix + state.answer);
    const end = change.from + change.insert.length;
    closeAiBlock(view, id, false);
    view.dispatch({ changes: change, selection: { anchor: end }, scrollIntoView: true });
    // The note now holds output from what the block read: keep that privacy.
    void raiseNoteRule(path, answerRule);
    view.focus();
  };

  return (
    <div
      className="ai-block"
      role="group"
      aria-label="AI block"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !running) {
          e.preventDefault();
          close();
        }
      }}
    >
      <div className="ai-block-head">
        <Sparkles size={14} aria-hidden />
        <textarea
          ref={input}
          className="ai-block-input"
          aria-label="AI prompt"
          placeholder={
            !skill
              ? chatting
                ? "Ask a follow-up…"
                : "Ask AI to write, summarise, explain…"
              : skill.output === "chat" && state.turns?.length
                ? "Reply…"
                : "Anything to add? (optional)"
          }
          rows={1}
          value={state.prompt}
          disabled={running}
          onChange={(e) => patch({ prompt: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void run();
            }
          }}
        />
        <button type="button" className="ai-icon" aria-label="Close AI block" onClick={close}>
          <X size={14} />
        </button>
      </div>

      <div className="ai-block-row">
        {skill && (
          <span className="ai-chip ai-skill" title={skill.description}>
            {(() => {
              const Icon = skillIcon(skill.id);
              return <Icon size={12} aria-hidden />;
            })()}
            Skill: {skill.title}
            <button
              type="button"
              className="ai-skill-remove"
              aria-label={`Stop using the ${skill.title} skill`}
              disabled={running}
              onClick={() =>
                patch({
                  skill: null,
                  format: null,
                  turns: [],
                  convRule: "any",
                  saved: [],
                  html: null,
                  files: null,
                  phase: { kind: "idle" },
                  answer: "",
                })
              }
            >
              <X size={11} />
            </button>
          </span>
        )}
        {baseSkill && format && (
          <span className="ai-format" role="group" aria-label="Format">
            {formatsOf(baseSkill).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={format === f}
                disabled={running}
                title={
                  f === "both"
                    ? "A Markdown lesson note and an HTML practice page"
                    : f === "html"
                      ? "A web page that opens in your browser"
                      : "A Markdown note"
                }
                onClick={() =>
                  // A finished page or file list was made in the other format: clear it.
                  baseSkill.output === "chat"
                    ? patch({ format: f })
                    : patch({
                        format: f,
                        html: null,
                        files: null,
                        answer: "",
                        phase: { kind: "idle" },
                      })
                }
              >
                {FORMAT_LABELS[f]}
              </button>
            ))}
          </span>
        )}
        <button
          type="button"
          className="ai-chip ai-scope"
          aria-pressed={state.useNote}
          disabled={running || chatting}
          onClick={() => patch({ useNote: !state.useNote })}
          title={
            state.useNote
              ? "The AI reads this note. Click to leave it out."
              : "Click to let the AI read this note."
          }
        >
          {state.useNote ? "Reads: " : "Not reading: "}
          {spec?.sources?.length
            ? `${spec.sources.length} ${spec.sources.length === 1 ? "note" : "notes"}`
            : skill?.reads === "folder"
              ? `notes in ${homeFolder(path) || "the vault"}`
              : noteName(path)}
        </button>
        {selection?.text && (
          <button
            type="button"
            className="ai-chip ai-scope"
            aria-pressed={state.useSelection}
            disabled={running || chatting}
            onClick={() => patch({ useSelection: !state.useSelection })}
          >
            {state.useSelection ? "Reads: selection" : "Not reading: selection"}
          </button>
        )}
        <span className="ai-block-plan muted" aria-live="polite" aria-label="Destination">
          {plan && (
            <>
              {plan.local && <HardDrive size={11} aria-label="On this device" />}~
              {plan.estimatedInputTokens.toLocaleString()} tokens
              {plan.estimatedCost !== null && ` · ~$${plan.estimatedCost.toFixed(4)}`}
            </>
          )}
          {!plan && planError && <span className="ai-error">{planError}</span>}
        </span>
        <span className="ask-ai-spacer" />
        <ModelPicker
          choice={state.choice}
          onChange={setChoice}
          rule={plan?.rule}
          defaultLabel={
            plan && !state.choice.provider ? `${plan.providerName} · ${plan.model}` : undefined
          }
          disabled={running}
        />
        {running ? (
          <button
            type="button"
            className="ai-chip"
            onClick={() => void backend.aiCancel(phase.runId)}
          >
            <Square size={11} /> Stop
          </button>
        ) : (
          <button
            type="button"
            className="ai-chip primary"
            disabled={!state.prompt.trim() && !skill}
            onClick={() => void run()}
            title="Enter"
          >
            {skill?.output === "chat" && state.turns?.length ? "Reply" : "Run"}{" "}
            <CornerDownLeft size={11} aria-hidden />
          </button>
        )}
      </div>

      {phase.kind === "confirm" && (
        <div className="ai-block-confirm" role="alert">
          <span>
            This request is about {phase.plan.estimatedInputTokens.toLocaleString()} input tokens
            {phase.plan.estimatedCost !== null && ` (~$${phase.plan.estimatedCost.toFixed(4)})`}.
            Send it to {phase.plan.providerName}?
          </span>
          <button type="button" onClick={() => patch({ phase: { kind: "idle" } })}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={() => void run(true)}>
            Send
          </button>
        </div>
      )}
      {phase.kind === "error" && (
        <p className="ai-error ai-block-error" role="alert">
          {phase.blocked && "Not sent: "}
          {phase.message}
        </p>
      )}

      {skill?.output === "chat" && (state.turns?.length || running) ? (
        <ChatTranscript turns={state.turns ?? []} answer={running ? state.answer : ""} />
      ) : skill && (skill.output === "html" || skill.output === "files") ? (
        running && (
          <p className="ai-block-summary muted" aria-label="Answer" aria-busy>
            {state.answer
              ? `Writing… ${state.answer.length.toLocaleString()} characters`
              : "Thinking…"}
          </p>
        )
      ) : (
        <>
          {earlier.length > 0 && (
            <ChatTranscript
              turns={[...earlier, { role: "user", text: state.asked ?? "" }]}
              answer=""
            />
          )}
          {(state.answer || running) && (
            <div className="ai-block-answer" aria-label="Answer" aria-busy={running}>
              {running && phase.thinking && !state.answer && (
                <span className="muted">Thinking…</span>
              )}
              <AnswerText text={state.answer} from={path} />
              {running && <span className="ask-ai-caret" aria-hidden />}
            </div>
          )}
        </>
      )}

      {phase.kind === "done" && state.saveError && (
        <p className="ai-error ai-block-error" role="alert">
          {state.saveError}
        </p>
      )}
      {phase.kind === "done" && skill?.output === "html" && state.html && (
        <PageResult
          skill={skill}
          html={state.html}
          path={path}
          saved={state.saved ?? []}
          onSaved={(saved) => patch({ saved, saveError: undefined })}
          onDone={() => closeAiBlock(view, id, false)}
        />
      )}
      {phase.kind === "done" && skill?.output === "files" && state.files && (
        <FilesResult
          files={state.files}
          onError={(saveError) => patch({ saveError })}
          path={path}
          saved={state.saved ?? []}
          onSaved={(saved) => patch({ saved, saveError: undefined })}
          onDone={() => closeAiBlock(view, id, false)}
        />
      )}
      {skill?.output === "chat" && !running && (state.turns?.length ?? 0) > 0 && (
        <ChatActions
          skill={skill}
          format={format === "html" ? "html" : "markdown"}
          turns={state.turns ?? []}
          path={path}
          rule={state.convRule ?? answerRule}
          saved={state.saved ?? []}
          unsaved={state.transcriptUnsaved ?? false}
          onSaved={(saved) => patch({ saved, transcriptUnsaved: false, saveError: undefined })}
          onWrapUp={() => {
            patch({ prompt: "wrap up" });
            void run();
          }}
          onDone={() => closeAiBlock(view, id, false)}
          onDiscardFailed={(saved) => patch({ saved, transcriptUnsaved: true })}
          onDiscard={close}
        />
      )}
      {phase.kind === "done" && (!skill || skill.output === "markdown") && (
        <div className="ai-block-actions">
          <button type="button" className="primary" onClick={() => insert(false)}>
            Insert
          </button>
          {selection?.text && (
            <button type="button" onClick={() => insert(true)}>
              Replace selection
            </button>
          )}
          {selection?.text && (
            <button
              type="button"
              title="See the answer as changes to the selection, and keep only the ones you want"
              onClick={() => {
                const cur = aiBlockSpec(view.state, id);
                if (!cur?.selection) return;
                const sel = cur.selection;
                closeAiBlock(view, id, false);
                useUi.getState().open({
                  kind: "fix",
                  path,
                  from: sel.from,
                  to: sel.to,
                  original: view.state.sliceDoc(sel.from, sel.to),
                  scope: "selection",
                  proposed: cleanReply(state.answer, view.state.sliceDoc(sel.from, sel.to)),
                });
              }}
            >
              Review as edit
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              void createDraft({
                title: (state.asked ?? state.prompt).split(/\r?\n/)[0] ?? "",
                content: `${state.answer.trim()}\n`,
                folder: homeFolder(path),
                rule: answerRule,
              }).then(
                () => closeAiBlock(view, id, false),
                (e: unknown) => patch({ phase: errorPhase(e) }),
              )
            }
          >
            <FileText size={12} /> Open as draft
          </button>
          <button type="button" onClick={() => void navigator.clipboard?.writeText(state.answer)}>
            <Copy size={12} /> Copy
          </button>
          <button type="button" onClick={retry}>
            <RotateCcw size={12} /> Retry
          </button>
          {(state.turns?.length ?? 0) > 2 && (
            <button
              type="button"
              onClick={() =>
                void createDraft({
                  title: state.turns![0]!.text.split(/\r?\n/)[0] ?? "",
                  content: conversationMarkdown(
                    state.turns![0]!.text.split(/\r?\n/)[0] ?? "",
                    state.turns!,
                  ),
                  folder: homeFolder(path),
                  rule: answerRule,
                }).then(
                  () => closeAiBlock(view, id, false),
                  (e: unknown) => patch({ phase: errorPhase(e) }),
                )
              }
            >
              <MessagesSquare size={12} /> Save conversation
            </button>
          )}
          {chatting && (
            <button type="button" onClick={restart} title="Forget this conversation">
              <Eraser size={12} /> New question
            </button>
          )}
          <button type="button" onClick={close}>
            <Trash2 size={12} /> Discard
          </button>
          <label className="ai-block-keep">
            <input
              type="checkbox"
              checked={state.keepPrompt}
              onChange={(e) => patch({ keepPrompt: e.target.checked })}
            />
            Keep prompt
          </label>
          <span className="ask-ai-spacer" />
          <span className="muted ai-block-meta">
            {phase.result.providerName} · {phase.result.model}
            {phase.result.local && " (on this device)"}
            {phase.result.fallbackFrom && ` · ${phase.result.fallbackFrom} was unavailable`}
          </span>
        </div>
      )}
    </div>
  );
}
