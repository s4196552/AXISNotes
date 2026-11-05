import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@codemirror/view";
import {
  Copy,
  FileText,
  CornerDownLeft,
  HardDrive,
  RotateCcw,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { type AiPlan, type AiRunRequest, backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { aiBlockSpec, closeAiBlock, insertionFor } from "./aiBlock";
import { createDraft, folderOf } from "../drafts/drafts";
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
import { freshSkill, useSkills } from "../skills/skills";
import { runSkill, skillRequest } from "../skills/skillRun";
import { ChatActions, ChatTranscript, FilesResult, PageResult } from "../skills/SkillResult";
import { skillIcon } from "../skills/skillIcons";

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
  const skill =
    useSkills((s) => (state?.skill ? s.skills.find((k) => k.id === state.skill) : undefined)) ??
    null;

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

  const request = useMemo((): AiRunRequest | null => {
    if (!state) return null;
    if (skill)
      return skillRequest({
        skill,
        prompt: state.prompt,
        turns: state.turns ?? [],
        path,
        useNote: state.useNote,
        selectionText: state.useSelection ? selection?.text : undefined,
        choice: state.choice,
      });
    const sel = state.useSelection && selection?.text;
    const context = sel ? `Selected text:\n"""\n${selection.text}\n"""\n\n` : "";
    return {
      task: "chat",
      effort: state.choice.effort,
      provider: state.choice.provider,
      model: state.choice.model,
      messages: [
        { role: "system", content: [{ type: "text", text: SYSTEM }] },
        { role: "user", content: [{ type: "text", text: context + state.prompt }] },
      ],
      attach: state.useNote ? [path] : [],
      sources: sel ? [path] : [],
    };
  }, [state, selection, path, skill]);

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

  async function run(confirmed = false) {
    const cur = useAiBlocks.getState().blocks[id];
    if (!cur || (!cur.prompt.trim() && !skill) || cur.phase.kind === "running" || !request) return;
    if (!confirmed) {
      const p = await backend.aiPlan(request).catch(() => null);
      if (p?.needsConfirm) {
        patch({ phase: { kind: "confirm", plan: p } });
        return;
      }
    }
    if (skill) return runTheSkill(cur);
    const runId = crypto.randomUUID();
    patch({ answer: "", phase: { kind: "running", runId, thinking: true } });
    try {
      const result = await backend.aiRun(runId, request, (d) =>
        useAiBlocks.getState().appendAnswer(id, d),
      );
      patch({ answer: result.text, phase: { kind: "done", result } });
    } catch (e) {
      if (!useAiBlocks.getState().blocks[id]) return; // closed meanwhile
      patch({
        phase: isBackendError(e) && e.code === "Cancelled" ? { kind: "idle" } : errorPhase(e),
      });
    }
  }

  async function runTheSkill(cur: AiBlockState) {
    const s = (await freshSkill(skill!.id)) ?? skill!;
    const req = skillRequest({
      skill: s,
      prompt: cur.prompt,
      turns: cur.turns ?? [],
      path,
      useNote: cur.useNote,
      selectionText: cur.useSelection ? selection?.text : undefined,
      choice: cur.choice,
    });
    const asked = cur.prompt.trim() || (s.output === "chat" ? "Start the interview." : "");
    patch({
      answer: "",
      html: null,
      files: null,
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
      if (out.kind === "html") patch({ html: out.html, answer: "", phase: done });
      else if (out.kind === "files") patch({ files: out.files, answer: "", phase: done });
      else if (s.output === "chat")
        patch({
          turns: [
            ...(cur.turns ?? []),
            { role: "user", text: asked },
            { role: "assistant", text: out.result.text },
          ],
          answer: "",
          prompt: "",
          phase: done,
        });
      else patch({ answer: out.result.text, phase: done });
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
    const prefix = state.keepPrompt ? promptCallout(state.prompt) : "";
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
              ? "Ask AI to write, summarise, explain…"
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
              onClick={() => patch({ skill: null, turns: [], html: null, files: null })}
            >
              <X size={11} />
            </button>
          </span>
        )}
        <button
          type="button"
          className="ai-chip ai-scope"
          aria-pressed={state.useNote}
          disabled={running}
          onClick={() => patch({ useNote: !state.useNote })}
          title={
            state.useNote
              ? "The AI reads this note. Click to leave it out."
              : "Click to let the AI read this note."
          }
        >
          {state.useNote ? "Reads: " : "Not reading: "}
          {skill?.reads === "folder" ? `notes in ${folderOf(path) || "the vault"}` : noteName(path)}
        </button>
        {selection?.text && (
          <button
            type="button"
            className="ai-chip ai-scope"
            aria-pressed={state.useSelection}
            disabled={running}
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
        (state.answer || running) && (
          <div className="ai-block-answer" aria-label="Answer" aria-busy={running}>
            {running && phase.thinking && !state.answer && <span className="muted">Thinking…</span>}
            {state.answer}
            {running && <span className="ask-ai-caret" aria-hidden />}
          </div>
        )
      )}

      {phase.kind === "done" && skill?.output === "html" && state.html && (
        <PageResult
          skill={skill}
          html={state.html}
          path={path}
          onDone={() => closeAiBlock(view, id, false)}
        />
      )}
      {phase.kind === "done" && skill?.output === "files" && state.files && (
        <FilesResult files={state.files} path={path} onDone={() => closeAiBlock(view, id, false)} />
      )}
      {skill?.output === "chat" && !running && (state.turns?.length ?? 0) > 0 && (
        <ChatActions
          skill={skill}
          turns={state.turns ?? []}
          path={path}
          onWrapUp={() => {
            patch({ prompt: "wrap up" });
            void run();
          }}
          onDone={() => closeAiBlock(view, id, false)}
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
          <button
            type="button"
            onClick={() =>
              void createDraft({
                title: state.prompt.split(/\r?\n/)[0] ?? "",
                content: `${state.answer.trim()}\n`,
                folder: folderOf(path),
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
          <button type="button" onClick={() => void run()}>
            <RotateCcw size={12} /> Retry
          </button>
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
