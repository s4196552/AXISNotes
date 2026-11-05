import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Backend } from "../../ipc";
import { withAiActivity } from "../../ipc/aiActivity";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import {
  agentStateAt,
  applyActivity,
  DONE_MS,
  initialActivity,
  NEEDS_YOU_MS,
  useAgentActivity,
} from "./agentModel";
import { normalizeAgentSettings, useAgentSettings } from "./agentSettings";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const MIN = 60_000;

describe("agentStateAt", () => {
  it("thinks until the first text, then works, then is done and returns to idle", () => {
    let a = initialActivity(0);
    a = applyActivity(a, { kind: "start", runId: "r", task: "chat", path: "School/Bio.md" }, 10);
    expect(agentStateAt(a, 20, 10 * MIN)).toMatchObject({ state: "thinking", until: null });
    a = applyActivity(a, { kind: "first-text", runId: "r" }, 30);
    expect(agentStateAt(a, 40, 10 * MIN).state).toBe("working");
    a = applyActivity(a, { kind: "end", runId: "r", status: "ok", path: "School/Bio.md" }, 50);
    expect(agentStateAt(a, 60, 10 * MIN)).toEqual({
      state: "done",
      detail: "Done · Bio",
      until: 50 + DONE_MS,
    });
    expect(agentStateAt(a, 50 + DONE_MS, 10 * MIN).state).toBe("idle");
  });

  it("needs you after a blocked or failed run, for longer than Done", () => {
    let a = initialActivity(0);
    a = applyActivity(a, { kind: "start", runId: "r", task: "chat" }, 0);
    a = applyActivity(a, { kind: "end", runId: "r", status: "blocked" }, 0);
    expect(agentStateAt(a, DONE_MS + 1, 10 * MIN)).toMatchObject({
      state: "needsYou",
      detail: "Not sent: a privacy rule blocked it",
    });
    expect(agentStateAt(a, NEEDS_YOU_MS, 10 * MIN).state).toBe("idle");
    const failed = applyActivity(
      a,
      { kind: "end", runId: "r", status: "error", message: "No AI provider is set up." },
      0,
    );
    expect(agentStateAt(failed, 1, 10 * MIN).detail).toBe("No AI provider is set up.");
  });

  it("a cancelled run just ends; working wins over thinking with two runs", () => {
    let a = initialActivity(0);
    a = applyActivity(a, { kind: "start", runId: "a", task: "chat" }, 0);
    a = applyActivity(a, { kind: "start", runId: "b", task: "chat" }, 0);
    a = applyActivity(a, { kind: "first-text", runId: "b" }, 0);
    expect(agentStateAt(a, 1, MIN)).toMatchObject({ state: "working", detail: "Working (2)…" });
    a = applyActivity(a, { kind: "end", runId: "a", status: "cancelled" }, 1);
    a = applyActivity(a, { kind: "end", runId: "b", status: "cancelled" }, 1);
    expect(agentStateAt(a, 2, MIN).state).toBe("idle");
  });

  it("falls asleep after the set time without activity, or when told to", () => {
    const a = initialActivity(0);
    expect(agentStateAt(a, 10 * MIN - 1, 10 * MIN)).toMatchObject({
      state: "idle",
      until: 10 * MIN,
    });
    expect(agentStateAt(a, 10 * MIN, 10 * MIN).state).toBe("sleeping");
    expect(agentStateAt({ ...a, forcedSleep: true }, 1, 10 * MIN).state).toBe("sleeping");
  });
});

describe("withAiActivity", () => {
  it("announces start, first text and the end, without the content", async () => {
    const b = withAiActivity(createMemoryBackend({ "N.md": "x" }) as Backend);
    await b.openVault("/v");
    const { settings } = await b.aiSettings();
    await b.aiSaveSettings({
      ...settings,
      providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
    });
    const seen: string[] = [];
    const { onAiActivity } = await import("../../ipc/aiActivity");
    const stop = onAiActivity((e) => seen.push(JSON.stringify(e)));
    await b.aiRun(
      "r1",
      { messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], attach: ["N.md"] },
      () => {},
    );
    stop();
    expect(seen).toEqual([
      JSON.stringify({ kind: "start", runId: "r1", task: "chat", path: "N.md" }),
      JSON.stringify({ kind: "first-text", runId: "r1" }),
      JSON.stringify({ kind: "end", runId: "r1", status: "ok", path: "N.md" }),
    ]);
  });
});

describe("Agent settings", () => {
  it("keeps values in range", () => {
    expect(normalizeAgentSettings({ mode: "nope" as never, sleepMinutes: 0, size: 999 })).toEqual({
      mode: "always",
      sleepMinutes: 1,
      size: 256,
    });
  });
});

describe("the Agent in a browser", () => {
  beforeEach(async () => {
    h.b = createMemoryBackend({ "School/Bio.md": "x" });
    await h.b.openVault("/v");
    useAgentSettings.setState({ mode: "always", sleepMinutes: 10, size: 112 });
    useAppStore.setState({ notice: null });
  });
  afterEach(() => useAgentSettings.setState({ mode: "always" }));

  it("floats in the page, follows AI activity, and hides from its menu", async () => {
    const { AgentBridge } = await import("./AgentBridge");
    const { onAiActivity } = await import("../../ipc/aiActivity");
    void onAiActivity; // the bridge listens through the same module
    render(<AgentBridge />);
    expect(screen.getByRole("img", { name: /AI Agent: Idle/ })).toBeInTheDocument();

    act(() =>
      useAgentActivity.setState((a) =>
        applyActivity(
          a,
          { kind: "start", runId: "r", task: "chat", path: "School/Bio.md" },
          Date.now(),
        ),
      ),
    );
    expect(screen.getByRole("img", { name: /AI Agent: Thinking/ })).toBeInTheDocument();
    act(() =>
      useAgentActivity.setState((a) =>
        applyActivity(
          a,
          { kind: "end", runId: "r", status: "ok", path: "School/Bio.md" },
          Date.now(),
        ),
      ),
    );
    expect(screen.getByRole("img", { name: "AI Agent: Done. Done · Bio" })).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("img", { name: /AI Agent/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Hide the Agent" }));
    expect(useAgentSettings.getState().mode).toBe("off");
    expect(screen.queryByRole("img", { name: /AI Agent/ })).toBeNull();
    expect(useAppStore.getState().notice).toMatch(/The Agent is hidden/);
  });

  it("shows only while busy when set to", async () => {
    useAgentSettings.setState({ mode: "busy" });
    const { AgentBridge } = await import("./AgentBridge");
    render(<AgentBridge />);
    expect(screen.queryByRole("img", { name: /AI Agent/ })).toBeNull();
    act(() =>
      useAgentActivity.setState((a) =>
        applyActivity(a, { kind: "start", runId: "r", task: "chat" }, Date.now()),
      ),
    );
    expect(screen.getByRole("img", { name: /AI Agent: Thinking/ })).toBeInTheDocument();
  });

  it("goes back to Idle when Done times out, and a click opens the note it ran in", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    try {
      const openFile = vi.fn();
      useAppStore.setState({ openFile } as never);
      const { AgentBridge } = await import("./AgentBridge");
      render(<AgentBridge />);
      act(() =>
        useAgentActivity.setState((a) =>
          applyActivity(
            applyActivity(a, { kind: "start", runId: "r", task: "chat" }, Date.now()),
            { kind: "end", runId: "r", status: "ok", path: "School/Bio.md" },
            Date.now(),
          ),
        ),
      );
      const agent = screen.getByRole("img", { name: /AI Agent: Done/ });
      act(() => void vi.advanceTimersByTime(DONE_MS - 100));
      expect(screen.getByRole("img", { name: /AI Agent: Done/ })).toBeInTheDocument();
      act(() => void vi.advanceTimersByTime(200));
      expect(screen.getByRole("img", { name: /AI Agent: Idle/ })).toBeInTheDocument();

      // A new finished run, then a click on the Agent.
      act(() =>
        useAgentActivity.setState((a) =>
          applyActivity(
            a,
            { kind: "end", runId: "r2", status: "ok", path: "School/Bio.md" },
            Date.now(),
          ),
        ),
      );
      const box = agent.closest(".agent-inline")!;
      fireEvent.pointerDown(box, { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
      fireEvent.pointerUp(box, { button: 0, clientX: 5, clientY: 5, pointerId: 1 });
      await act(async () => {
        await Promise.resolve();
      });
      expect(openFile).toHaveBeenCalledWith("School/Bio.md");
      expect(screen.getByRole("img", { name: /AI Agent: Idle/ })).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
