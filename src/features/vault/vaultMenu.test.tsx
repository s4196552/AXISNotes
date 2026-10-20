import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { rememberVault } from "../../app/recentVaults";
import { registerDocument, resetUnsavedWork } from "../files/unsavedWork";
import { Modals } from "../commands/Modals";
import { useUi } from "../commands/ui";
import { VaultMenu } from "./VaultMenu";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  localStorage.clear();
  resetUnsavedWork();
  h.b = createMemoryBackend({ "Note.md": "" });
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG), loaded: true });
  useUi.setState({ modal: null });
  rememberVault({ root: "/vaults/School", name: "School" });
  rememberVault({ root: "/vaults/Work", name: "Work" });
  await act(() => useAppStore.getState().openVault("/vaults/Work"));
});
afterEach(() => resetUnsavedWork());

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /Work/ }));

describe("vault menu", () => {
  it("lists the other recent vaults and switches to one", async () => {
    render(<VaultMenu />);
    openMenu();
    const menu = screen.getByRole("menu", { name: "Vaults" });
    expect(menu).toHaveTextContent("School");
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).not.toContain(
      expect.stringMatching(/^Work/),
    );
    expect(document.activeElement).toBe(screen.getAllByRole("menuitem")[0]);
    fireEvent.click(screen.getByRole("menuitem", { name: /School/ }));
    await waitFor(() => expect(useAppStore.getState().vault?.root).toBe("/vaults/School"));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("doesn't switch while a note can't be saved", async () => {
    registerDocument(
      () => "Note.md",
      async () => ({ path: "Note.md", reason: "failed" }),
    );
    render(<VaultMenu />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /School/ }));
    await waitFor(() => expect(useAppStore.getState().error).toMatch(/Didn't switch vaults/));
    expect(useAppStore.getState().vault?.root).toBe("/vaults/Work");
  });

  it("moves with the arrow keys and closes on Escape", () => {
    render(<VaultMenu />);
    openMenu();
    const items = screen.getAllByRole("menuitem");
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens another vault from the command palette", async () => {
    render(<Modals />);
    act(() => useUi.getState().open({ kind: "vaults" }));
    const input = screen.getByRole("combobox", { name: "Open another vault" });
    fireEvent.change(input, { target: { value: "school" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useAppStore.getState().vault?.root).toBe("/vaults/School"));
  });
});
