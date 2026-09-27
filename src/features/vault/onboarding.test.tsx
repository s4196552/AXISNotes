import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { recentVaults, rememberVault, takeGettingStarted } from "../../app/recentVaults";
import { WelcomeScreen } from "./WelcomeScreen";
import { GettingStarted } from "./GettingStarted";
import { STARTER_NOTES } from "./starterNotes";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(() => {
  localStorage.clear();
  h.b = createMemoryBackend({});
  h.b.pickFolder = async () => "/home/me";
  useAppStore.setState({ vault: null, error: null, notes: [] });
});

describe("welcome and onboarding", () => {
  it("creates a vault with example notes and marks it for Getting started", async () => {
    render(<WelcomeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Create new vault/ }));
    fireEvent.change(screen.getByLabelText("Vault name"), { target: { value: "Notes" } });
    expect(screen.getByLabelText("Add a few example notes")).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Choose location…" }));
    await waitFor(() => expect(useAppStore.getState().vault?.name).toBe("Notes"));
    for (const path of Object.keys(STARTER_NOTES))
      expect((await h.b.readFile(path)).content).toBe(STARTER_NOTES[path]);
    const root = useAppStore.getState().vault!.root;
    expect(recentVaults()[0]).toMatchObject({ root, name: "Notes" });
    expect(takeGettingStarted(root)).toBe(true);
    expect(takeGettingStarted(root)).toBe(false); // only once
  });

  it("lists recent vaults and reopens one with a click", async () => {
    rememberVault({ root: "/old/Work", name: "Work" });
    rememberVault({ root: "/old/School", name: "School" });
    render(<WelcomeScreen />);
    const list = screen.getByRole("region", { name: "Recent vaults" });
    expect(list).toHaveTextContent(/School.*Work/);
    fireEvent.click(screen.getByRole("button", { name: "Remove Work from the list" }));
    expect(list).not.toHaveTextContent("Work");
    fireEvent.click(screen.getByRole("button", { name: /^School/ }));
    await waitFor(() => expect(useAppStore.getState().vault?.root).toBe("/old/School"));
  });

  it("the example notes link to each other", () => {
    const start = STARTER_NOTES["Start here.md"]!;
    expect(start).toContain("[[Tasks and dates]]");
    expect(start).toContain("[[Diagrams]]");
    expect(STARTER_NOTES["Examples/Diagrams.md"]).toContain("```mermaid");
  });

  it("Getting started shows what's set up", async () => {
    await h.b.openVault("/v");
    const { settings } = await h.b.aiSettings();
    await h.b.aiSaveSettings({
      ...settings,
      providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
    });
    useAppStore.setState({
      notes: [{ path: "Start here.md", name: "Start here", title: "Start here", aliases: [] }],
    });
    const onClose = vi.fn();
    render(<GettingStarted onClose={onClose} />);
    await screen.findByRole("button", { name: "Change" }); // AI already set up
    expect(screen.getByRole("button", { name: "Pair" })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Open" })));
    expect(useAppStore.getState().activePath).toBe("Start here.md");
    expect(onClose).toHaveBeenCalled();
  });
});
