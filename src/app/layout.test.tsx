import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../ipc/memoryBackend";
import { useAppStore } from "./store";
import { clampWidth, PANEL_WIDTH, useLayout } from "./layout";
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
  useLayout.setState({ left: true, right: true, leftWidth: 260, rightWidth: 280 });
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
    expect(JSON.parse(localStorage.getItem("axisnotes.layout")!)).toMatchObject({
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

describe("resizing side panels", () => {
  const columns = (c: HTMLElement) =>
    c.querySelector<HTMLElement>(".shell")!.style.gridTemplateColumns;
  const handle = (side: string) => screen.getByRole("separator", { name: `Resize ${side} panel` });
  const saved = () => JSON.parse(localStorage.getItem("axisnotes.layout") ?? "{}") as object;

  function drag(el: HTMLElement, from: number, to: number) {
    fireEvent.pointerDown(el, { button: 0, clientX: from, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: to, pointerId: 1 });
  }

  it("drags the left panel wider and saves the width once the drag ends", () => {
    const { container } = render(<App />);
    drag(handle("left"), 260, 360);
    expect(columns(container)).toBe("360px minmax(0, 1fr) 280px");
    expect(document.documentElement).toHaveClass("panel-resizing");
    expect(saved()).not.toHaveProperty("leftWidth"); // not on every move
    fireEvent.pointerUp(handle("left"), { pointerId: 1 });
    expect(document.documentElement).not.toHaveClass("panel-resizing");
    expect(saved()).toMatchObject({ leftWidth: 360, rightWidth: 280 });
    expect(handle("left")).toHaveAttribute("aria-valuenow", "360");
  });

  it("drags the right panel wider by moving its edge to the left", () => {
    const { container } = render(<App />);
    drag(handle("right"), 744, 694);
    fireEvent.pointerUp(handle("right"), { pointerId: 1 });
    expect(columns(container)).toBe("260px minmax(0, 1fr) 330px");
  });

  it("stops at the narrowest width, and leaves the note area its room", () => {
    const { container } = render(<App />);
    drag(handle("left"), 260, 0);
    expect(columns(container)).toBe(`${PANEL_WIDTH.min}px minmax(0, 1fr) 280px`);
    fireEvent.pointerMove(handle("left"), { clientX: 2000, pointerId: 1 });
    // jsdom's window is 1024 px wide: 1024 − 280 (right panel) − 320 (note area).
    expect(columns(container)).toBe("424px minmax(0, 1fr) 280px");
    fireEvent.pointerUp(handle("left"), { pointerId: 1 });
  });

  it("resizes from the keyboard, and double-click resets the default", () => {
    const { container } = render(<App />);
    fireEvent.keyDown(handle("left"), { key: "ArrowRight" });
    expect(columns(container)).toBe("276px minmax(0, 1fr) 280px");
    fireEvent.keyDown(handle("left"), { key: "ArrowLeft", shiftKey: true });
    expect(columns(container)).toBe("212px minmax(0, 1fr) 280px");
    fireEvent.keyDown(handle("right"), { key: "ArrowLeft" }); // grows the right panel
    expect(columns(container)).toBe("212px minmax(0, 1fr) 296px");
    fireEvent.keyDown(handle("left"), { key: "Home" });
    expect(columns(container)).toBe(`${PANEL_WIDTH.min}px minmax(0, 1fr) 296px`);
    expect(saved()).toMatchObject({ leftWidth: PANEL_WIDTH.min, rightWidth: 296 });

    fireEvent.doubleClick(handle("left"));
    fireEvent.doubleClick(handle("right"));
    expect(columns(container)).toBe("260px minmax(0, 1fr) 280px");
  });

  it("keeps a panel's width while it's hidden, and finishes a drag cut short by hiding", () => {
    const { container } = render(<App />);
    drag(handle("right"), 744, 644);
    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(document.documentElement).not.toHaveClass("panel-resizing");
    expect(columns(container)).toBe("260px minmax(0, 1fr) 0px");
    fireEvent.click(screen.getByRole("button", { name: "Show right panel" }));
    expect(columns(container)).toBe("260px minmax(0, 1fr) 380px");
    expect(saved()).toMatchObject({ rightWidth: 380 });
  });

  it("slides a hidden panel's column to 0 and keeps the right panel until it has slid away", async () => {
    const { container } = render(<App />);
    fireEvent.click(within(nav()!).getByRole("button", { name: "Hide left panel" }));
    expect(columns(container)).toBe("0px minmax(0, 1fr) 280px");
    expect(container.querySelector(".sidebar-slot.left")).toHaveAttribute("inert");

    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    expect(columns(container)).toBe("0px minmax(0, 1fr) 0px");
    expect(links()).not.toBeInTheDocument(); // gone for screen readers straight away
    expect(container.querySelector(".sidebar-right")).toBeInTheDocument(); // still sliding
    await waitFor(() => expect(container.querySelector(".sidebar-right")).toBeNull());

    // Reopened before the slide ends: it stays mounted throughout.
    fireEvent.click(screen.getByRole("button", { name: "Show right panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Show right panel" }));
    await new Promise((r) => setTimeout(r, 250));
    expect(links()).toBeInTheDocument();
  });

  it("ignores saved widths that aren't usable numbers, and clamps the rest", () => {
    expect(clampWidth("left", "wide")).toBe(PANEL_WIDTH.default.left);
    expect(clampWidth("right", Number.NaN)).toBe(PANEL_WIDTH.default.right);
    expect(clampWidth("left", 10)).toBe(PANEL_WIDTH.min);
    expect(clampWidth("right", 5000)).toBe(PANEL_WIDTH.max);
    expect(clampWidth("left", 300.4)).toBe(300);
  });
});

describe("compact windows (side panels over the note)", () => {
  beforeEach(() => useLayout.setState({ compact: true, overlay: null }));
  afterEach(() => useLayout.setState({ compact: false, overlay: null }));

  it("starts with both panels closed and opens one at a time over the note", () => {
    const { container } = render(<App />);
    const shell = container.querySelector(".shell")!;
    expect(shell).toHaveClass("compact");
    expect((shell as HTMLElement).style.gridTemplateColumns).toBe("0px minmax(0, 1fr) 0px");
    expect(nav()).not.toBeInTheDocument();
    expect(container.querySelector(".overlay-scrim")).toBeNull();

    fireEvent.click(
      within(container.querySelector("main")!).getByRole("button", { name: "Show left panel" }),
    );
    expect(nav()).toBeInTheDocument();
    expect(container.querySelector(".overlay-scrim")).not.toBeNull();

    // The right one replaces it rather than opening beside it.
    fireEvent.click(
      within(container.querySelector("main")!).getByRole("button", { name: "Show right panel" }),
    );
    expect(useLayout.getState().overlay).toBe("right");
    expect(nav()).not.toBeInTheDocument();
    // The docked layout the user chose is kept for a wide window.
    expect(useLayout.getState()).toMatchObject({ left: true, right: true });
  });

  it("closes the panel on the scrim, on Escape and when a note opens from it", async () => {
    const { container } = render(<App />);
    act(() => useLayout.getState().setOverlay("left"));
    fireEvent.mouseDown(container.querySelector(".overlay-scrim")!);
    expect(useLayout.getState().overlay).toBeNull();

    act(() => useLayout.getState().setOverlay("left"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useLayout.getState().overlay).toBeNull();

    act(() => useLayout.getState().setOverlay("left"));
    act(() => useAppStore.getState().openFile("Welcome.md"));
    expect(useLayout.getState().overlay).toBeNull();
  });

  it("opens the left panel for search instead of docking it", () => {
    render(<App />);
    act(() => useAppStore.getState().search("tag:x"));
    expect(useLayout.getState().overlay).toBe("left");
  });
});
