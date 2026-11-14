import { Copy, X } from "lucide-react";
import { useAppStore } from "../../app/store";
import { useAiBlocks } from "../ai/aiBlockStore";
import { useSkills } from "./skills";
import { SkillOutput } from "./SkillOutput";
import { openSkillSource, useSkillResults } from "./skillDestination";
import "../ai/ai.css";

export function SkillResultsSidebar() {
  const root = useAppStore((s) => s.vault?.root);
  const blocks = useAiBlocks((s) => s.blocks);
  const selected = useSkillResults((s) => s.selected);
  const skills = useSkills((s) => s.skills);
  const runs = Object.entries(blocks).filter(
    ([, s]) => s.skill && s.vaultRoot === root && s.sourcePath,
  );
  const run = runs.find(([id]) => id === selected) ?? runs.at(-1);
  const state = run?.[1];
  const skill = skills.find((s) => s.id === state?.skill);
  return (
    <section className="skill-results-sidebar" aria-label="AI skill results">
      <div className="ai-block-actions">
        <strong>Skill results</strong>
        <span className="ask-ai-spacer" />
        <button
          aria-label="Close skill results"
          onClick={() => useSkillResults.setState({ open: false })}
        >
          <X size={14} />
        </button>
      </div>
      {run && state?.sourcePath && skill ? (
        <>
          <label>
            Result
            <select
              aria-label="Skill result"
              value={run[0]}
              onChange={(e) => useSkillResults.setState({ selected: e.target.value })}
            >
              {runs.map(([id, s]) => (
                <option key={id} value={id}>
                  {skills.find((k) => k.id === s.skill)?.title ?? "Skill"} · {s.sourcePath}
                </option>
              ))}
            </select>
          </label>
          <button className="skill-source" onClick={() => openSkillSource(state.sourcePath!)}>
            Open source to continue: {state.sourcePath}
          </button>
          <SkillOutput id={run[0]} path={state.sourcePath} skill={skill} />
          {state.phase.kind === "idle" && (
            <p className="muted">
              Run the skill from its source note. Its result will appear here.
            </p>
          )}
          {state.phase.kind === "error" && (
            <p className="ai-error" role="alert">
              {state.phase.message}
            </p>
          )}
          {state.answer || state.turns?.length ? (
            <button
              onClick={() =>
                void navigator.clipboard?.writeText(
                  state.answer || state.turns!.map((t) => `${t.role}: ${t.text}`).join("\n\n"),
                )
              }
            >
              <Copy size={12} /> Copy result
            </button>
          ) : null}
        </>
      ) : (
        <p className="muted">Choose Sidebar in a skill's “Results in” menu.</p>
      )}
    </section>
  );
}
