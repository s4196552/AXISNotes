import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { AiSettingsPanel } from "./AiSettings";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({ "Medical/scan.md": "x", "Notes/a.md": "a" });
  await h.b.openVault("/v");
  useAppStore.setState({ tree: await h.b.listTree(), error: null });
  await useConfig.getState().load();
});

async function addProvider(kind: string) {
  fireEvent.change(await screen.findByLabelText("Provider type"), { target: { value: kind } });
  fireEvent.click(screen.getByRole("button", { name: /Add provider/ }));
}

describe("AI settings", () => {
  it("adds a provider, stores its key write-only and tests the connection", async () => {
    render(<AiSettingsPanel />);
    await addProvider("openai");
    const card = await screen.findByRole("group", { name: "Provider OpenAI" });
    expect(within(card).getByText("No key")).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("button", { name: /Test connection/ }));
    expect(await within(card).findByRole("status")).toHaveTextContent("has no API key");

    const keyInput = within(card).getByLabelText("API key for OpenAI");
    expect(keyInput).toHaveAttribute("type", "password");
    fireEvent.change(keyInput, { target: { value: "sk-secret-123" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save key" }));
    expect(await within(card).findByText("Key saved in keychain")).toBeInTheDocument();
    expect(within(card).getByLabelText("API key for OpenAI")).toHaveValue("");
    // The key is never handed back to the UI.
    expect(JSON.stringify(await h.b.aiSettings())).not.toContain("sk-secret");

    fireEvent.click(within(card).getByRole("button", { name: /Test connection/ }));
    await waitFor(() =>
      expect(within(card).getByRole("status")).toHaveTextContent("Connected · 3 models"),
    );
  });

  it("marks local providers and picks models per task", async () => {
    render(<AiSettingsPanel />);
    await addProvider("ollama");
    const card = await screen.findByRole("group", { name: "Provider Ollama (local)" });
    expect(within(card).getByText("On this device")).toBeInTheDocument();
    expect(within(card).getByText("No key needed")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Provider for Diagrams"), {
      target: { value: "ollama" },
    });
    const model = await screen.findByLabelText("Model for Diagrams");
    fireEvent.change(model, { target: { value: "llama3.3" } });
    fireEvent.blur(model);
    await waitFor(async () =>
      expect((await h.b.aiSettings()).settings.tasks.diagrams).toEqual({
        provider: "ollama",
        model: "llama3.3",
      }),
    );

    // Handwriting warns about models that can't read images.
    fireEvent.change(screen.getByLabelText("Provider for Handwriting"), {
      target: { value: "ollama" },
    });
    const hw = await screen.findByLabelText("Model for Handwriting");
    fireEvent.change(hw, { target: { value: "llama3.3" } });
    fireEvent.blur(hw);
    expect(await screen.findByText("This model can't read images.")).toBeInTheDocument();
  });

  it("orders fallbacks and sets limits", async () => {
    render(<AiSettingsPanel />);
    await addProvider("openai");
    await screen.findByRole("group", { name: "Provider OpenAI" });
    await addProvider("anthropic");
    await screen.findByRole("group", { name: "Provider Anthropic (Claude)" });
    const add = () => screen.getByLabelText("Add fallback provider");
    fireEvent.change(add(), { target: { value: "openai" } });
    await screen.findByRole("button", { name: "Move OpenAI down" });
    fireEvent.change(add(), { target: { value: "anthropic" } });
    fireEvent.click(await screen.findByRole("button", { name: "Move Anthropic (Claude) up" }));
    await waitFor(async () =>
      expect((await h.b.aiSettings()).settings.fallback).toEqual(["anthropic", "openai"]),
    );

    const cap = screen.getByLabelText("Token cap");
    fireEvent.change(cap, { target: { value: "8000" } });
    fireEvent.blur(cap);
    await waitFor(async () => expect((await h.b.aiSettings()).settings.maxInputTokens).toBe(8000));
  });

  it("adds folder privacy rules to the vault config", async () => {
    render(<AiSettingsPanel />);
    fireEvent.change(await screen.findByLabelText("Folder"), { target: { value: "Medical" } });
    fireEvent.click(screen.getByRole("button", { name: /Add rule/ }));
    await waitFor(() =>
      expect(JSON.parse(h.b.files()[".axis/config.json"]!).ai.folders).toEqual({
        Medical: "never",
      }),
    );
    expect(screen.getByLabelText("AI access for Medical")).toHaveValue("never");
  });

  it("shows the request log without prompts", async () => {
    await h.b.aiSaveSettings({
      ...(await h.b.aiSettings()).settings,
      providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
    });
    await h.b.aiRun(
      "r1",
      { messages: [{ role: "user", content: [{ type: "text", text: "secret prompt" }] }] },
      () => {},
    );
    render(<AiSettingsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "Show recent requests" }));
    const table = await screen.findByRole("table", { name: "Recent AI requests" });
    expect(table).toHaveTextContent("ollama · llama3.3 (local)");
    expect(table).not.toHaveTextContent("secret prompt");
  });
});
