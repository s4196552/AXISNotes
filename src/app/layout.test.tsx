import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../ipc/memoryBackend";
import { useAppStore } from "./store";
import { useLayout } from "./layout";
import { commandForEvent } from "../features/commands/registry";
import { DEFAULT_CONFIG, useConfig } from "./config";
import App from "../App";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../ipc", async (orig) => {
  const mod = await orig<typeof import("../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  localStorage.clear();
  h.b = createMemoryBackend({ "Welcome.md": "# Welcome\n" });
  const vault = await h.b.openVault("/v");
  useLayout.setState({ left: true, right: true });
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  useAppStore.setState({ vault, activePath: null, mainView: "note", leftPanel: "files" });
});

const nav = () => screen.queryByRole("complementary", { name: "Navigation" });
const links = () => screen.queryByRole("complementary", { name: "Links" });

describe("side panels", () => {
  it("hides the right panel on its own, and brings it back", async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Hide right panel" }));
    expect(links()).not.toBeInTheDocument(); // hidden from view and from screen readers
    expect(nav()).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("axisnotes.layout")!)).toEqual({
      left: true,
      right: false,
    });

    const show = screen.getByRole("button", { name: "Show right panel" });
    expect(show).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(show);
    expect(links()).toBeInTheDocument();
  });

  it("hides the left panel from its own header, and shows it again from the main area", () => {
    render(<App />);
    const hide = within(nav()!).getByRole("button", { name: "Hide left panel" });
    expect(hide).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(hide);
    expect(nav()).not.toBeInTheDocument();
    expect(links()).toBeInTheDocument();

    const show = screen.getByRole("button", { name: "Show left panel" });
    expect(show).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(show);
    expect(nav()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show left panel" })).not.toBeInTheDocument();
  });

  it("toggles both with Ctrl+\\, and brings the left panel back when a left view is opened", () => {
    render(<App />);
    act(() => commandForEvent(new KeyboardEvent("keydown", { key: "\\", ctrlKey: true }))!.run());
    expect(nav()).not.toBeInTheDocument();
    expect(links()).not.toBeInTheDocument();
    act(() => useAppStore.getState().setLeftPanel("search"));
    expect(nav()).toBeInTheDocument();
    expect(links()).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show right panel" }));
    expect(links()).toBeInTheDocument();
  });

  it("shows each side's shortcut once one is set, including after it's remapped", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: "Hide right panel" });
    expect(button).toHaveAttribute("title", "Hide right panel");
    act(() =>
      useConfig.setState({
        config: { ...DEFAULT_CONFIG, hotkeys: { "toggle-right-panel": "Ctrl+Shift+H" } },
      }),
    );
    expect(button).toHaveAttribute("title", "Hide right panel (Ctrl+Shift+H)");
    act(() =>
      useConfig.setState({
        config: { ...DEFAULT_CONFIG, hotkeys: { "toggle-left-panel": "Ctrl+Shift+L" } },
      }),
    );
    expect(screen.getByRole("button", { name: "Hide left panel" })).toHaveAttribute(
      "title",
      "Hide left panel (Ctrl+Shift+L)",
    );
  });
});
