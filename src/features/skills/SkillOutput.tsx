import { useRef } from "react";
import { useAiBlocks, type AiBlockState } from "../ai/aiBlockStore";
import { useStudyResults } from "../comprehension/studyResults";
import { AnswerText } from "../ai/AnswerText";
import { PAGE_SANDBOX } from "../drafts/WebFileView";
import { backend } from "../../ipc";
import { ChatTranscript, FilesResult, PageResult } from "./SkillResult";
import { type Skill, withFormat } from "./skills";

/** One result renderer for the source note and the independent sidebar. */
export function SkillOutput({
  id,
  path,
  skill: base,
  onDone = () => {},
}: {
  id: string;
  path: string;
  skill: Skill;
  onDone?(): void;
}) {
  const state = useAiBlocks((s) => s.blocks[id]);
  const frame = useRef<HTMLIFrameElement>(null);
  const shownPage = state?.saved?.[0];
  useStudyResults(frame, shownPage && backend.pageUrl(shownPage) ? shownPage : null);
  if (!state) return null;
  const skill = withFormat(base, state.format);
  const running = state.phase.kind === "running";
  const done = state.phase.kind === "done";
  const patch = (p: Partial<AiBlockState>) => useAiBlocks.getState().patch(id, p);
  const onSaved = (saved: string[]) => patch({ saved, saveError: undefined });
  const page = state.saved?.[0];
  const url = page && backend.pageUrl(page);
  return (
    <>
      {skill.output === "chat" ? (
        <ChatTranscript turns={state.turns ?? []} answer={running ? state.answer : ""} />
      ) : skill.output === "html" || skill.output === "files" ? (
        running && (
          <p className="ai-block-summary muted" aria-label="Answer" aria-busy>
            {state.answer
              ? `Writing… ${state.answer.length.toLocaleString()} characters`
              : "Thinking…"}
          </p>
        )
      ) : state.answer || running ? (
        <div className="ai-block-answer" aria-label="Answer" aria-busy={running}>
          {!state.answer && <span className="muted">Thinking…</span>}
          <AnswerText text={state.answer} from={path} />
        </div>
      ) : null}
      {done && state.saveError && (
        <p className="ai-error" role="alert">
          {state.saveError}
        </p>
      )}
      {done && skill.output === "html" && state.html && (
        <>
          <PageResult
            skill={skill}
            html={state.html}
            path={path}
            saved={state.saved ?? []}
            onSaved={onSaved}
            onDone={onDone}
          />
          {url && (
            <div className="skill-page-preview">
              <iframe
                ref={frame}
                title={page!.slice(page!.lastIndexOf("/") + 1)}
                src={url}
                sandbox={PAGE_SANDBOX}
                referrerPolicy="no-referrer"
              />
            </div>
          )}
        </>
      )}
      {done && skill.output === "files" && state.files && (
        <FilesResult
          files={state.files}
          path={path}
          saved={state.saved ?? []}
          onSaved={onSaved}
          onError={(saveError) => patch({ saveError })}
          onDone={onDone}
        />
      )}
    </>
  );
}
