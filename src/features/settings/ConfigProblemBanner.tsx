import { TriangleAlert } from "lucide-react";
import { CONFIG_PATH, useConfig } from "../../app/config";
import "./configProblem.css";

/**
 * Shown while the vault's settings file can't be read or saved (T-278). A broken file is
 * never overwritten on its own: the user retries after fixing it, or replaces it with the
 * settings shown now (a copy of the old file was kept beside it).
 */
export function ConfigProblemBanner() {
  const problem = useConfig((s) => s.problem);
  if (!problem) return null;
  const retry = () =>
    problem.kind === "broken"
      ? void useConfig.getState().load()
      : void useConfig.getState().update((c) => c);
  const reset = () => {
    if (
      window.confirm(
        `Replace ${CONFIG_PATH} with the default settings shown now? A copy of the current file is kept as config.json.bak.`,
      )
    )
      void useConfig.getState().resetBroken();
  };
  return (
    <div className="config-problem" role="alert">
      <TriangleAlert size={16} aria-hidden="true" className="config-problem-icon" />
      <span className="config-problem-text">{problem.message}</span>
      <span className="config-problem-actions">
        <button type="button" onClick={retry}>
          Try again
        </button>
        {problem.kind === "broken" && (
          <button type="button" onClick={reset}>
            Use defaults
          </button>
        )}
      </span>
    </div>
  );
}
