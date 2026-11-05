import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { useAgentSettings } from "./agentSettings";
import { agentWindowSize, closeChat, useAgentChat } from "./agentChat";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({ "School/Bio.md": "Mitochondria make ATP." });
  const vault = await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  useAppStore.setState({ vault, activePath: "School/Bio.md", notice: null });
  useAgentSettings.setState({ mode: "always", sleepMinutes: 10, size: 112 });
  closeChat();
});

describe("Quick Chat under the Agent", () => {
  it("sizes the Agent's window for the icon, and grows for the panel", () => {
    expect(agentWindowSize(112, false)).toEqual({ width: 140, height: 180 });
    expect(agentWindowSize(112, true)).toEqual({ width: 340, height: 480 });
  });

  it("asks about the open note and opens the answer as a draft", async () => {
    const { AgentBridge } = await import("./AgentBridge");
    render(<AgentBridge />);
    fireEvent.click(screen.getByRole("button", { name: "Ask the Agent" }));
    const panel = screen.getByRole("dialog", { name: "Quick Chat" });
    expect(within(panel).getByRole("button", { name: /Reads: Bio/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(within(panel).getByLabelText("Ask the Agent"), {
      target: { value: "What makes ATP?" },
    });
    fireEvent.keyDown(within(panel).getByLabelText("Ask the Agent"), { key: "Enter" });
    await waitFor(() =>
      expect(within(panel).getByLabelText("Answer")).toHaveTextContent(
        "Echo from Ollama: What makes ATP?",
      ),
    );
    await waitFor(() => expect(useAgentChat.getState().running).toBe(false));
    expect((await h.b.aiLog())[0]).toMatchObject({ status: "ok", sources: 1 });

    fireEvent.click(within(panel).getByRole("button", { name: /Open as draft/ }));
    await waitFor(() =>
      expect(h.b.files()[".axisnotes/drafts/What makes ATP.md"]).toBe(
        "Echo from Ollama: What makes ATP?\n",
      ),
    );
    expect(useAppStore.getState().activePath).toBe(".axisnotes/drafts/What makes ATP.md");

    fireEvent.click(screen.getByRole("button", { name: "Close Quick Chat" }));
    expect(screen.queryByRole("dialog", { name: "Quick Chat" })).toBeNull();
  });

  it("can leave the note out", async () => {
    const { AgentBridge } = await import("./AgentBridge");
    render(<AgentBridge />);
    fireEvent.click(screen.getByRole("button", { name: "Ask the Agent" }));
    const panel = screen.getByRole("dialog", { name: "Quick Chat" });
    fireEvent.click(within(panel).getByRole("button", { name: /Reads: Bio/ }));
    expect(within(panel).getByRole("button", { name: /Not reading: Bio/ })).toBeInTheDocument();
    fireEvent.change(within(panel).getByLabelText("Ask the Agent"), { target: { value: "Hi" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(useAgentChat.getState().running).toBe(false));
    await waitFor(async () => expect((await h.b.aiLog())[0]).toMatchObject({ sources: 0 }));
  });
});
