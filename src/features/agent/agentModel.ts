import { create } from "zustand";
import { type AgentState, type AiActivityEvent, onAiActivity } from "../../ipc";

// What the Agent shows, worked out from AI run activity (see src/ipc/aiActivity.ts) and
// how long it has been since anything happened. The model is plain data plus a pure
// function, so the timing rules are easy to test.

interface Run {
  task: string;
  path?: string;
  /** The first answer text has arrived. */
  text: boolean;
}

export interface Finished {
  status: "ok" | "error" | "blocked";
  path?: string;
  at: number;
  message?: string;
}

export interface AgentActivity {
  runs: Record<string, Run>;
  /** The most recent run that ended, until it's dismissed. */
  last: Finished | null;
  /** Last time the user did something in the app, or a run started. */
  lastActive: number;
  /** "Sleep now" from the Agent's menu, until the next activity. */
  forcedSleep: boolean;
}

/** How long Done stays up before the Agent goes back to Idle. */
export const DONE_MS = 8_000;
/** How long Needs you stays up. */
export const NEEDS_YOU_MS = 20_000;

export const initialActivity = (now: number): AgentActivity => ({
  runs: {},
  last: null,
  lastActive: now,
  forcedSleep: false,
});

export const useAgentActivity = create<AgentActivity>(() => initialActivity(Date.now()));

/** Fold one AI activity event into the model. */
export function applyActivity(a: AgentActivity, e: AiActivityEvent, now: number): AgentActivity {
  switch (e.kind) {
    case "start":
      return {
        ...a,
        runs: { ...a.runs, [e.runId]: { task: e.task, path: e.path, text: false } },
        last: null,
        lastActive: now,
        forcedSleep: false,
      };
    case "first-text": {
      const run = a.runs[e.runId];
      return run ? { ...a, runs: { ...a.runs, [e.runId]: { ...run, text: true } } } : a;
    }
    case "end": {
      const runs = { ...a.runs };
      delete runs[e.runId];
      const last: Finished | null =
        e.status === "cancelled"
          ? a.last
          : { status: e.status, path: e.path, at: now, message: e.message };
      return { ...a, runs, last, lastActive: now };
    }
  }
}

/** Listen to AI activity for as long as the Agent is on. */
export function trackAiActivity(): () => void {
  useAgentActivity.setState(initialActivity(Date.now()));
  return onAiActivity((e) =>
    useAgentActivity.setState((a) => applyActivity(a, e, Date.now()), true),
  );
}

export function noteUserActivity(now = Date.now()) {
  const a = useAgentActivity.getState();
  // Waking from sleep is immediate; otherwise a few seconds' precision is plenty.
  if (a.forcedSleep || now - a.lastActive > 2_000)
    useAgentActivity.setState({ lastActive: now, forcedSleep: false });
}

export function sleepNow() {
  useAgentActivity.setState({ forcedSleep: true, last: null });
}

/** Clear Done / Needs you (after the user clicked the Agent). */
export function dismiss() {
  useAgentActivity.setState({ last: null, lastActive: Date.now() });
}

const noteName = (path?: string) =>
  path ? path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "") : "";

/** An error message short enough for the Agent's tooltip. */
const shorten = (m?: string) => {
  const t = (m ?? "").replace(/\s+/g, " ").trim();
  return t.length > 90 ? `${t.slice(0, 89)}…` : t;
};

export interface AgentStateAt {
  state: AgentState;
  detail: string;
  /** When the state next changes by itself (null: only on new activity). */
  until: number | null;
}

/** The Agent's state at `now`. */
export function agentStateAt(a: AgentActivity, now: number, sleepMs: number): AgentStateAt {
  const running = Object.values(a.runs);
  if (running.length) {
    const many = running.length > 1 ? ` (${running.length})` : "";
    return running.some((r) => r.text)
      ? { state: "working", detail: `Working${many}…`, until: null }
      : { state: "thinking", detail: `Thinking${many}…`, until: null };
  }
  if (a.last) {
    const hold = a.last.status === "ok" ? DONE_MS : NEEDS_YOU_MS;
    if (now - a.last.at < hold) {
      const name = noteName(a.last.path);
      const detail =
        a.last.status === "ok"
          ? name
            ? `Done · ${name}`
            : "Done"
          : a.last.status === "blocked"
            ? "Not sent: a privacy rule blocked it"
            : shorten(a.last.message) || "Something went wrong";
      return {
        state: a.last.status === "ok" ? "done" : "needsYou",
        detail,
        until: a.last.at + hold,
      };
    }
  }
  if (a.forcedSleep) return { state: "sleeping", detail: "Sleeping", until: null };
  const since = Math.max(a.lastActive, a.last?.at ?? 0);
  if (now - since >= sleepMs) return { state: "sleeping", detail: "Sleeping", until: null };
  return { state: "idle", detail: "Ready", until: since + sleepMs };
}

/** States that show the Agent when it's set to appear only while the AI is busy. */
export const BUSY_STATES: AgentState[] = ["thinking", "working", "done", "needsYou"];

export const STATE_LABELS: Record<AgentState, string> = {
  idle: "Idle",
  sleeping: "Sleeping",
  thinking: "Thinking",
  working: "Working",
  done: "Done",
  needsYou: "Needs you",
};
