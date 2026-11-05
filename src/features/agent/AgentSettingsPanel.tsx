import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import type { AgentState } from "../../ipc";
import { AgentFigure } from "./AgentFigure";
import { STATE_LABELS } from "./agentModel";
import { AGENT_SIZES, type AgentMode, useAgentSettings } from "./agentSettings";
import {
  clampFps,
  clampFrames,
  clearImages,
  deleteImage,
  FPS_LIMITS,
  FRAME_LIMITS,
  IMAGE_TYPES,
  imageProblem,
  loadAgentImages,
  putImage,
  readImages,
  type StoredImage,
  useAgentImagesVersion,
  useAgentImageUrls,
} from "./agentImages";

// Settings → Agent: when the Agent shows, when it falls asleep, how big it is, and an
// image (or sprite strip) for each state, with a preview of every state.

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
      <AgentImageSlots />
    </div>
  );
}

/** One image slot per state: choose, remove, and frames/speed for a sprite strip. */
function AgentImageSlots() {
  const version = useAgentImagesVersion((v) => v.version);
  const urls = useAgentImageUrls((u) => u.images);
  const [stored, setStored] = useState<Partial<Record<AgentState, StoredImage>>>({});
  const [error, setError] = useState<string | null>(null);
  const picking = useRef<AgentState | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let gone = false;
    void loadAgentImages(version);
    void readImages().then((v) => !gone && setStored(v));
    return () => {
      gone = true;
    };
  }, [version]);

  const save = (state: AgentState, img: StoredImage) =>
    putImage(state, img).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );

  const pick = (file: File | undefined) => {
    const state = picking.current;
    picking.current = null;
    if (!file || !state) return;
    const problem = imageProblem(file);
    if (problem) return setError(problem);
    void save(state, { blob: file, name: file.name, frames: 1, fps: 8 });
  };

  const any = Object.keys(stored).length > 0;

  return (
    <section className="agent-images" aria-label="Agent images">
      <h3>Images</h3>
      <p className="muted">
        Pick an image for each state: PNG, JPG, SVG, or an animated GIF, WebP or APNG, up to 8 MB.
        For a sprite strip (frames side by side), set how many frames it has. States without an
        image use Idle&rsquo;s, then the built-in Agent. Images stay on this device.
      </p>
      <input
        ref={input}
        type="file"
        hidden
        accept={IMAGE_TYPES.join(",")}
        aria-label="Agent image file"
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <div className="agent-settings-states">
        {STATES.map((state) => {
          const img = stored[state];
          const fallback = urls[state] ?? (state !== "idle" ? urls.idle : undefined);
          return (
            <figure key={state} className="agent-slot" aria-label={`${STATE_LABELS[state]} image`}>
              <AgentFigure state={state} size={72} image={fallback} />
              <figcaption>
                <strong>{STATE_LABELS[state]}</strong>
                <span className="muted agent-slot-name" title={img?.name}>
                  {img ? img.name : urls.idle && state !== "idle" ? "Uses Idle's" : "Built-in"}
                </span>
              </figcaption>
              <div className="agent-slot-actions">
                <button
                  type="button"
                  onClick={() => {
                    picking.current = state;
                    input.current?.click();
                  }}
                >
                  <ImagePlus size={13} /> {img ? "Change" : "Choose"}
                </button>
                {img && (
                  <button
                    type="button"
                    aria-label={`Remove the ${STATE_LABELS[state]} image`}
                    onClick={() => void deleteImage(state)}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
              {img && (
                <div className="agent-slot-sprite">
                  <label>
                    Frames
                    <input
                      type="number"
                      min={FRAME_LIMITS.min}
                      max={FRAME_LIMITS.max}
                      value={img.frames}
                      onChange={(e) =>
                        void save(state, { ...img, frames: clampFrames(Number(e.target.value)) })
                      }
                    />
                  </label>
                  {img.frames > 1 && (
                    <label>
                      Speed
                      <input
                        type="number"
                        min={FPS_LIMITS.min}
                        max={FPS_LIMITS.max}
                        value={img.fps}
                        onChange={(e) =>
                          void save(state, { ...img, fps: clampFps(Number(e.target.value)) })
                        }
                      />
                      fps
                    </label>
                  )}
                </div>
              )}
            </figure>
          );
        })}
      </div>
      {any && (
        <button type="button" onClick={() => void clearImages()}>
          Use the built-in Agent for every state
        </button>
      )}
    </section>
  );
}
