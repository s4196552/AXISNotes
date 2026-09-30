import {
  type AiMessage,
  type AiRunRequest,
  type AiRunResult,
  backend,
  isBackendError,
} from "../../ipc";
import { useConfig } from "../../app/config";
import { isFeatureEnabled } from "../modules/features";
import { InvalidAnswer } from "../../lib/aiJson";

// Shared plumbing for AI features: a cancellable run, and "ask for a structured answer,
// validate it, and retry once with the problems if it is invalid".

/** A handle to stop whichever request is currently running. */
export class AiRun {
  runId: string | null = null;
  cancelled = false;
  cancel() {
    this.cancelled = true;
    if (this.runId) void backend.aiCancel(this.runId).catch(() => {});
  }
}

export function isCancelled(e: unknown): boolean {
  return isBackendError(e) && e.code === "Cancelled";
}

export function errorMessage(e: unknown): string {
  if (isBackendError(e)) return e.code === "Blocked" ? `Not sent: ${e.message}` : e.message;
  if (e instanceof InvalidAnswer) return `The model's answer wasn't usable: ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

export async function runAi(
  request: AiRunRequest,
  onDelta: (text: string) => void = () => {},
  run: AiRun = new AiRun(),
): Promise<AiRunResult> {
  if (!isFeatureEnabled("aiAssist"))
    throw { code: "Blocked", message: "AI assistance is disabled for this vault." };
  if (run.cancelled) throw { code: "Cancelled", message: "cancelled" };
  const runId = crypto.randomUUID();
  run.runId = runId;
  const unsubscribe = useConfig.subscribe(() => {
    if (!isFeatureEnabled("aiAssist")) run.cancel();
  });
  try {
    const result = await backend.aiRun(runId, request, (delta) => {
      if (!run.cancelled) onDelta(delta);
    });
    if (run.cancelled) throw { code: "Cancelled", message: "cancelled" };
    return result;
  } finally {
    unsubscribe();
    if (run.runId === runId) run.runId = null;
  }
}

export const text = (role: AiMessage["role"], t: string): AiMessage => ({
  role,
  content: [{ type: "text", text: t }],
});

export interface Validated<T> {
  value: T;
  result: AiRunResult;
  /** 1, or 2 if the first answer was invalid. */
  attempts: number;
}

/**
 * Run `request` and turn the answer into a value with `parse` (which throws
 * `InvalidAnswer`). If the first answer is invalid, ask once more, quoting the problems.
 */
export async function askValidated<T>(
  request: AiRunRequest,
  parse: (answer: string) => T | Promise<T>,
  opts: { run?: AiRun; onDelta?(text: string): void; onRetry?(problems: string[]): void } = {},
): Promise<Validated<T>> {
  const first = await runAi(request, opts.onDelta, opts.run);
  try {
    return { value: await parse(first.text), result: first, attempts: 1 };
  } catch (e) {
    if (!(e instanceof InvalidAnswer)) throw e;
    opts.onRetry?.(e.problems);
    const retry: AiRunRequest = {
      ...request,
      messages: [
        ...request.messages,
        text("assistant", first.text),
        text(
          "user",
          `That answer can't be used:\n- ${e.problems.slice(0, 8).join("\n- ")}\n` +
            "Reply again with only the corrected answer in the required format.",
        ),
      ],
    };
    const second = await runAi(retry, opts.onDelta, opts.run);
    return { value: await parse(second.text), result: second, attempts: 2 };
  }
}
