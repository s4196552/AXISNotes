import { act, fireEvent, render, screen } from "@testing-library/react";
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
  it("hides both side panels from the main area, and brings them back", async () => {
    render(<App />);
    expect(nav()).toBeInTheDocument();
    expect(links()).toBeInTheDocument();

    fireEvent.click(await screen.findByRole("button", { name: "Hide side panels" }));
    expect(nav()).not.toBeInTheDocument(); // hidden from view and from screen readers
    expect(links()).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("axisnotes.layout")!)).toEqual({
      left: false,
      right: false,
    });

    const show = screen.getByRole("button", { name: "Show side panels" });
    expect(show).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(show);
    expect(nav()).toBeInTheDocument();
    expect(links()).toBeInTheDocument();
  });

  it("toggles with Ctrl+\\, and brings the left panel back when a left view is opened", () => {
    render(<App />);
    act(() => commandForEvent(new KeyboardEvent("keydown", { key: "\\", ctrlKey: true }))!.run());
    expect(nav()).not.toBeInTheDocument();
    act(() => useAppStore.getState().setLeftPanel("search"));
    expect(nav()).toBeInTheDocument();
    expect(links()).not.toBeInTheDocument();
    // One side still showing: the button hides the rest.
    fireEvent.click(screen.getByRole("button", { name: "Hide side panels" }));
    expect(nav()).not.toBeInTheDocument();
  });

  it("shows the current shortcut, including after it's remapped", () => {
    render(<App />);
    const button = screen.getByRole("button", { name: "Hide side panels" });
    expect(button).toHaveAttribute("title", String.raw`Hide side panels (Ctrl+\)`);
    act(() =>
      useConfig.setState({
        config: { ...DEFAULT_CONFIG, hotkeys: { "toggle-side-panels": "Ctrl+Shift+H" } },
      }),
    );
    expect(button).toHaveAttribute("title", "Hide side panels (Ctrl+Shift+H)");
    act(() =>
      useConfig.setState({ config: { ...DEFAULT_CONFIG, hotkeys: { "toggle-side-panels": "" } } }),
    );
    expect(button).toHaveAttribute("title", "Hide side panels");
  });

  it("hides one side on its own", () => {
    render(<App />);
    act(() => commandForEvent(new KeyboardEvent("keydown", { key: "\\", ctrlKey: true }))!.run());
    act(() => useLayout.getState().setPanels({ right: true }));
    expect(nav()).not.toBeInTheDocument();
    expect(links()).toBeInTheDocument();
  });
});
