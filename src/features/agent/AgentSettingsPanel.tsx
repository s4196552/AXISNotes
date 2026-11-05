import type { AgentState } from "../../ipc";
import { AgentFigure } from "./AgentFigure";
import { STATE_LABELS } from "./agentModel";
import { AGENT_SIZES, type AgentMode, useAgentSettings } from "./agentSettings";

// Settings → Agent: when the Agent shows, when it falls asleep and how big it is, with a
// preview of every state.

const MODES: [AgentMode, string][] = [
  ["always", "Always, while AXISNotes is open"],
  ["busy", "Only while the AI is working (and just after)"],
  ["off", "Never"],
];

const STATES: AgentState[] = ["idle", "sleeping", "thinking", "working", "done", "needsYou"];

export function AgentSettingsPanel() {
  const s = useAgentSettings();
  return (
    <div className="agent-settings">
      <p className="muted">
        The Agent shows what the AI is doing: thinking, working, done, or when it needs you. On the
        desktop it floats above every program; drag it anywhere, click it to come back to AXISNotes,
        right-click it for more.
      </p>
      <div className="settings-field">
        <div>
          <div className="settings-label">Show the Agent</div>
        </div>
        <div className="settings-control">
          <select
            aria-label="Show the Agent"
            value={s.mode}
            onChange={(e) => s.update({ mode: e.target.value as AgentMode })}
          >
            {MODES.map(([m, label]) => (
              <option key={m} value={m}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="settings-field">
        <div>
          <div className="settings-label">Fall asleep after</div>
          <div className="settings-hint muted">
            Minutes with no AI requests and no use of the app.
          </div>
        </div>
        <div className="settings-control">
          <input
            type="number"
            aria-label="Fall asleep after (minutes)"
            min={1}
            max={240}
            value={s.sleepMinutes}
            onChange={(e) => s.update({ sleepMinutes: Number(e.target.value) })}
          />{" "}
          minutes
        </div>
      </div>
      <div className="settings-field">
        <div>
          <div className="settings-label">Size</div>
        </div>
        <div className="settings-control">
          <input
            type="range"
            aria-label="Agent size"
            min={AGENT_SIZES.min}
            max={AGENT_SIZES.max}
            step={8}
            value={s.size}
            onChange={(e) => s.update({ size: Number(e.target.value) })}
          />{" "}
          {s.size} px
        </div>
      </div>
      <div className="agent-settings-states" aria-label="States">
        {STATES.map((state) => (
          <figure key={state}>
            <AgentFigure state={state} size={64} />
            <figcaption>{STATE_LABELS[state]}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
