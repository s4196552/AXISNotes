import type { AiRunRequest, Backend } from "./types";

// Every AI request in the app goes through `backend.aiRun`. This wraps it to announce when
// a run starts, when its first text arrives and how it ends, so the Agent can show what
// the AI is doing without each feature reporting it. Content never goes into these events.

export type AiRunStatus = "ok" | "error" | "blocked" | "cancelled";

export type AiActivityEvent =
  | { kind: "start"; runId: string; task: string; path?: string }
  | { kind: "first-text"; runId: string }
  | { kind: "end"; runId: string; status: AiRunStatus; path?: string; message?: string };

type Listener = (e: AiActivityEvent) => void;
const listeners = new Set<Listener>();

/** Listen to AI run activity; returns a function that stops listening. */
export function onAiActivity(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function announce(e: AiActivityEvent) {
  for (const cb of [...listeners]) {
    try {
      cb(e);
    } catch {
      // A listener's error never affects the request.
    }
  }
}

/** The note a request is about, if any (for "open the note it ran in"). */
const pathOf = (req: AiRunRequest) => req.attach?.[0] ?? req.sources?.[0];

const statusOf = (e: unknown): AiRunStatus => {
  const code = typeof e === "object" && e && "code" in e ? (e as { code: unknown }).code : null;
  return code === "Cancelled" ? "cancelled" : code === "Blocked" ? "blocked" : "error";
};

/** Make `backend.aiRun` announce its activity (in place, so the same object is kept). */
export function withAiActivity<B extends Backend>(backend: B): B {
  const run = backend.aiRun.bind(backend);
  backend.aiRun = async (runId, request, onDelta) => {
    const path = pathOf(request);
    announce({ kind: "start", runId, task: request.task ?? "chat", path });
    let first = true;
    try {
      const result = await run(runId, request, (delta) => {
        if (first) {
          first = false;
          announce({ kind: "first-text", runId });
        }
        onDelta(delta);
      });
      announce({ kind: "end", runId, status: "ok", path });
      return result;
    } catch (e) {
      const message = typeof e === "object" && e && "message" in e ? String(e.message) : String(e);
      announce({ kind: "end", runId, status: statusOf(e), path, message });
      throw e;
    }
  };
  return backend;
}
