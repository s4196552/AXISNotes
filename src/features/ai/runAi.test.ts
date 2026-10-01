import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { InvalidAnswer, parseAnswer, type Schema } from "../../lib/aiJson";
import { useConfig, mergeConfig } from "../../app/config";
import { runAi, askValidated, text } from "./runAi";
import { useAppStore } from "../../app/store";

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
  useAppStore.setState({ vault: { root: "/v", name: "v" } });
  useConfig.setState({ config: mergeConfig({}) });
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

it("does not dispatch AI when assistance is disabled", async () => {
  useConfig.setState({ config: mergeConfig({ features: { aiAssist: false } }) });
  const spy = vi.spyOn(h.b, "aiRun");
  await expect(runAi(request)).rejects.toMatchObject({ code: "Blocked" });
  expect(spy).not.toHaveBeenCalled();
});
it("cancels in-flight AI and discards late output after disable", async () => {
  let resolve!: (v: { text: string }) => void;
  vi.spyOn(h.b, "aiRun").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r as typeof resolve;
      }),
  );
  const cancel = vi.spyOn(h.b, "aiCancel").mockResolvedValue();
  const pending = runAi(request);
  const cancelled = expect(pending).rejects.toMatchObject({ code: "Cancelled" });
  useConfig.setState({ config: mergeConfig({ features: { aiAssist: false } }) });
  expect(cancel).toHaveBeenCalledOnce();
  resolve({ text: "late output" });
  await cancelled;
});

it("cancels previous-vault AI even when the new vault also enables AI", async () => {
  let resolve!: (value: { text: string }) => void;
  let emit!: (value: string) => void;
  vi.spyOn(h.b, "aiRun").mockImplementation((_id, _request, onDelta) => {
    emit = onDelta!;
    return new Promise((r) => {
      resolve = r as typeof resolve;
    });
  });
  const cancel = vi.spyOn(h.b, "aiCancel").mockResolvedValue();
  const onDelta = vi.fn();
  const pending = runAi(request, onDelta);
  const cancelled = expect(pending).rejects.toMatchObject({ code: "Cancelled" });
  useAppStore.setState({ vault: { root: "/other", name: "other" } });
  emit("late previous-vault delta");
  resolve({ text: "late previous-vault result" });
  await cancelled;
  expect(cancel).toHaveBeenCalledOnce();
  expect(onDelta).not.toHaveBeenCalled();
});

it.each([false, true])(
  "discards validation after vault switch without retrying (invalid=%s)",
  async (invalid) => {
    setAiResponder(() => '{"title":"ok"}');
    const ai = vi.spyOn(h.b, "aiRun");
    let finish!: () => void;
    const parse = vi.fn(
      () =>
        new Promise<string>((resolve, reject) => {
          finish = () => (invalid ? reject(new InvalidAnswer(["bad"])) : resolve("old vault"));
        }),
    );
    const onRetry = vi.fn();
    const pending = askValidated(request, parse, { onRetry });
    const cancelled = expect(pending).rejects.toMatchObject({ code: "Cancelled" });
    await vi.waitFor(() => expect(parse).toHaveBeenCalledOnce());
    useAppStore.setState({ vault: { root: "/other", name: "other" } });
    finish();
    await cancelled;
    expect(ai).toHaveBeenCalledOnce();
    expect(onRetry).not.toHaveBeenCalled();
  },
);
