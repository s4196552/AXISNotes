import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { InvalidAnswer, parseAnswer, type Schema } from "../../lib/aiJson";
import { askValidated, text } from "./runAi";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const schema: Schema = { type: "object", props: { title: { type: "string" } } };
const request: AiRunRequest = { task: "diagrams", json: true, messages: [text("user", "go")] };
const seen: AiRunRequest[] = [];

beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  seen.length = 0;
});
afterEach(() => setAiResponder(null));

describe("askValidated", () => {
  it("returns a valid first answer", async () => {
    setAiResponder(() => '{"title":"ok"}');
    const r = await askValidated(request, (t) => parseAnswer<{ title: string }>(t, schema));
    expect(r.value).toEqual({ title: "ok" });
    expect(r.attempts).toBe(1);
  });

  it("retries once, quoting the problems, and gives up after that", async () => {
    const answers = ['{"title": 3}', 'Here: {"title":"fixed"}'];
    setAiResponder((req) => {
      seen.push(req);
      return answers.shift() ?? "{}";
    });
    const onRetry = vi.fn();
    const r = await askValidated(request, (t) => parseAnswer(t, schema), { onRetry });
    expect(r).toMatchObject({ value: { title: "fixed" }, attempts: 2 });
    expect(onRetry).toHaveBeenCalledWith(["$.title must be a string, not number"]);
    const retry = seen[1]!.messages;
    expect(retry.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(retry[2])).toContain("$.title must be a string");

    setAiResponder(() => "nope");
    await expect(askValidated(request, (t) => parseAnswer(t, schema))).rejects.toBeInstanceOf(
      InvalidAnswer,
    );
  });
});
