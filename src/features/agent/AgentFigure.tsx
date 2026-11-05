import type { AgentState } from "../../ipc";
import { STATE_LABELS } from "./agentModel";
import type { AgentImage } from "./agentImages";
import "./agent.css";

// The Agent itself: the user's image for the current state if they picked one, else the
// built-in AXIS Agent, drawn with CSS so each state has its own small animation.

const BUBBLE: Record<AgentState, string> = {
  idle: "",
  sleeping: "z z",
  thinking: "…",
  working: "",
  done: "✓",
  needsYou: "!",
};

export interface AgentFigureProps {
  state: AgentState;
  /** Width and height in pixels. */
  size: number;
  /** The user's image (or sprite strip) for this state. */
  image?: AgentImage;
  detail?: string;
}

export function AgentFigure({ state, size, image, detail }: AgentFigureProps) {
  const label = `AI Agent: ${STATE_LABELS[state]}${detail ? `. ${detail}` : ""}`;
  return (
    <div
      className="agent-figure"
      data-state={state}
      role="img"
      aria-label={label}
      title={detail || STATE_LABELS[state]}
      style={{ width: size, height: size }}
    >
      {image ? (
        image.frames > 1 ? (
          <div
            className="agent-image agent-sprite"
            style={{
              backgroundImage: `url("${image.url}")`,
              backgroundSize: `${image.frames * 100}% 100%`,
              animationDuration: `${image.frames / image.fps}s`,
              animationTimingFunction: `steps(${image.frames}, jump-none)`,
            }}
          />
        ) : (
          <img className="agent-image" src={image.url} alt="" draggable={false} />
        )
      ) : (
        <div className="agent-bot" style={{ transform: `scale(${size / 112})` }} aria-hidden>
          <div className="agent-antenna" />
          <div className="agent-face" />
          <div className="agent-eye agent-eye-l" />
          <div className="agent-eye agent-eye-r" />
          <div className="agent-mouth" />
          {state === "working" && <div className="agent-gear" />}
        </div>
      )}
      {BUBBLE[state] && (
        <span className="agent-bubble" aria-hidden>
          {BUBBLE[state]}
        </span>
      )}
    </div>
  );
}
