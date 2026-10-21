import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../ipc/memoryBackend";
import { useAppStore } from "./store";
import { rememberVault, setReopenLast } from "./recentVaults";
import App from "../App";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../ipc", async (orig) => {
  const mod = await orig<typeof import("../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(() => {
  localStorage.clear();
  // A fresh start: the backend has no vault open yet.
  h.b = createMemoryBackend({ "Welcome.md": "# Welcome\n" });
  h.b.currentVault = async () => null;
  useAppStore.setState({ vault: null, error: null });
  rememberVault({ root: "/v", name: "Notes" });
});

describe("starting AXISNotes", () => {
  it("stays on the welcome screen, with the last vault one click away", async () => {
    render(<App />);
    expect(await screen.findByRole("button", { name: /^Notes/ })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(useAppStore.getState().vault).toBeNull();
  });

  it("reopens the last vault when chosen", async () => {
    setReopenLast(true);
    render(<App />);
    await waitFor(() => expect(useAppStore.getState().vault?.root).toBe("/v"));
  });
});
