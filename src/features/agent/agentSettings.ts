import { create } from "zustand";

// The Agent's settings and window position. They belong to this device, not the vault,
// so they live in the webview's storage (shared by the main window and the Agent's
// window, which load the same app).

export type AgentMode = "always" | "busy" | "off";

export interface AgentSettings {
  /** Always shown, shown only while the AI is busy (and just after), or never. */
  mode: AgentMode;
  /** Minutes without activity before the Agent falls asleep. */
  sleepMinutes: number;
  /** Width and height of the figure, in pixels. */
  size: number;
}

export const AGENT_SIZES = { min: 64, max: 256 } as const;

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  mode: "always",
  sleepMinutes: 10,
  size: 112,
};

const SETTINGS_KEY = "axis.agent.settings";
const POSITION_KEY = "axis.agent.position";

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the setting lasts until the app closes.
  }
}

export function normalizeAgentSettings(v: Partial<AgentSettings> | null): AgentSettings {
  const d = DEFAULT_AGENT_SETTINGS;
  return {
    mode: v?.mode === "always" || v?.mode === "busy" || v?.mode === "off" ? v.mode : d.mode,
    sleepMinutes:
      typeof v?.sleepMinutes === "number" && Number.isFinite(v.sleepMinutes)
        ? clamp(Math.round(v.sleepMinutes), 1, 240)
        : d.sleepMinutes,
    size:
      typeof v?.size === "number" && Number.isFinite(v.size)
        ? clamp(Math.round(v.size), AGENT_SIZES.min, AGENT_SIZES.max)
        : d.size,
  };
}

interface AgentSettingsStore extends AgentSettings {
  update(patch: Partial<AgentSettings>): void;
}

export const useAgentSettings = create<AgentSettingsStore>((set, get) => ({
  ...normalizeAgentSettings(read<Partial<AgentSettings>>(SETTINGS_KEY)),
  update(patch) {
    const { mode, sleepMinutes, size } = get();
    const next = normalizeAgentSettings({ mode, sleepMinutes, size, ...patch });
    write(SETTINGS_KEY, next);
    set(next);
  },
}));

/** Where the Agent's window was last left (logical screen pixels). */
export function loadAgentPosition(): { x: number; y: number } | null {
  const p = read<{ x: unknown; y: unknown }>(POSITION_KEY);
  return p && typeof p.x === "number" && typeof p.y === "number" ? { x: p.x, y: p.y } : null;
}

export function saveAgentPosition(at: { x: number; y: number }) {
  write(POSITION_KEY, at);
}
