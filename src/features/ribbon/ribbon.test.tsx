import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Star } from "lucide-react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { LeftSidebar } from "../panels/Sidebars";
import { Settings } from "../settings/Settings";
import { arrange, moveInOrder, registerRibbonItem, ribbonItems } from "./registry";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  await useAppStore.getState().openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
});

const ribbonLabels = () =>
  within(screen.getByRole("toolbar", { name: "Ribbon buttons" }))
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label"));
const savedRibbon = async () =>
  JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).ribbon;

/**
 * A pointer drag from one button onto the top (or bottom) half of another (jsdom has no
 * layout: the target's box and the element under the pointer are given).
 */
function drag(from: HTMLElement, to: HTMLElement, half: "top" | "bottom" = "top") {
  const box = { left: 0, top: 0, width: 30, height: 30, right: 30, bottom: 30, x: 0, y: 0 };
  vi.spyOn(to, "getBoundingClientRect").mockReturnValue(box as DOMRect);
  document.elementFromPoint = () => to;
  const y = half === "top" ? 5 : 25;
  fireEvent.pointerDown(from, { button: 0, clientX: 15, clientY: 300 });
  fireEvent.pointerMove(window, { clientX: 15, clientY: y });
  fireEvent.pointerUp(window, { clientX: 15, clientY: y });
}

describe("ribbon order", () => {
  it("keeps the saved order, adds new buttons at the end and skips unavailable ones", () => {
    const item = (id: string, available?: () => boolean) => ({
      id,
      label: id,
      Icon: Star,
      source: "test",
      run: () => {},
      available,
    });
    const all = [item("a"), item("b"), item("c", () => false), item("d")];
    expect(arrange(all, ["d", "a"], DEFAULT_CONFIG).map((i) => i.id)).toEqual(["d", "a", "b"]);
    // Moving keeps an unavailable button's saved place after the shown ones.
    expect(moveInOrder(["d", "a", "b"], ["c", "d", "a"], "b", "d")).toEqual(["b", "d", "a", "c"]);
    expect(moveInOrder(["a", "b"], [], "a", null)).toEqual(["b", "a"]);
  });
});

describe("the ribbon beside the left panel", () => {
  it("shows AXISNotes' buttons and runs them; the view buttons above the panel go", () => {
    render(<LeftSidebar />);
    expect(ribbonLabels()).toEqual([
      "Home",
      "New note",
      "Today's daily note",
      "Search",
      "Graph view",
      "Tasks",
      "Time report",
      "Quick switcher",
      "Command palette",
      "AXIS Hub",
    ]);
    expect(screen.queryByRole("toolbar", { name: "Open a view" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Tasks" }));
    expect(useAppStore.getState().mainView).toBe("tasks");
    fireEvent.click(screen.getByRole("button", { name: "AXIS Hub" }));
    expect(useAppStore.getState().leftPanel).toBe("hub");
  });

  it("shows a plugin's button only while the plugin is on, and lets plugins add their own", () => {
    useConfig.setState({ config: { ...DEFAULT_CONFIG, hubEnabled: false } });
    render(<LeftSidebar />);
    expect(ribbonLabels()).not.toContain("AXIS Hub");
    const run = vi.fn();
    let remove = () => {};
    act(() => {
      remove = registerRibbonItem({
        id: "test:star",
        label: "Star",
        Icon: Star,
        source: "Star plugin",
        run,
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Star" }));
    expect(run).toHaveBeenCalledOnce();
    act(() => remove());
    expect(ribbonLabels()).not.toContain("Star");
    expect(ribbonItems().some((i) => i.id === "test:star")).toBe(false);
  });

  it("reorders by drag and drop, and with Alt+arrow keys, saving the order", async () => {
    render(<LeftSidebar />);
    drag(
      screen.getByRole("button", { name: "Tasks" }),
      screen.getByRole("button", { name: "Home" }),
    );
    expect(ribbonLabels().slice(0, 2)).toEqual(["Tasks", "Home"]);
    // Dropping on the lower half of a button puts it after that one.
    drag(
      screen.getByRole("button", { name: "Tasks" }),
      screen.getByRole("button", { name: "Search" }),
      "bottom",
    );
    expect(ribbonLabels().slice(0, 4)).toEqual([
      "Home",
      "New note",
      "Today's daily note",
      "Search",
    ]);
    expect(ribbonLabels()[4]).toBe("Tasks");
    fireEvent.keyDown(screen.getByRole("button", { name: "Tasks" }), {
      key: "ArrowUp",
      altKey: true,
    });
    expect(ribbonLabels()[3]).toBe("Tasks");
    await waitFor(async () =>
      expect((await savedRibbon()).order.slice(0, 4)).toEqual([
        "core:home",
        "core:new-note",
        "core:daily",
        "core:tasks",
      ]),
    );
    // Plain arrows move focus between buttons (one tab stop for the whole ribbon).
    const home = screen.getByRole("button", { name: "Home" });
    expect(home).toHaveAttribute("tabindex", "0");
    home.focus();
    fireEvent.keyDown(home, { key: "ArrowDown" });
    expect(screen.getByRole("button", { name: "New note" })).toHaveFocus();
  });
});

describe("Settings → Appearance → Ribbon", () => {
  it("turns the ribbon off and on, hides buttons and moves them", async () => {
    render(
      <>
        <LeftSidebar />
        <Settings section="ribbon" onClose={vi.fn()} />
      </>,
    );
    const list = screen.getByRole("list", { name: "Buttons" });
    expect(within(list).getByText(/added by AXIS Hub/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("checkbox", { name: "Show Time report" }));
    expect(ribbonLabels()).not.toContain("Time report");
    fireEvent.click(within(list).getByRole("button", { name: "Move Home down" }));
    expect(ribbonLabels().slice(0, 2)).toEqual(["New note", "Home"]);
    await waitFor(async () =>
      expect(await savedRibbon()).toMatchObject({ enabled: true, hidden: ["core:time"] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset buttons" }));
    expect(ribbonLabels()[0]).toBe("Home");
    expect(ribbonLabels()).toContain("Time report");
    fireEvent.click(screen.getByRole("checkbox", { name: "Show the ribbon" }));
    expect(screen.queryByRole("navigation", { name: "Ribbon" })).toBeNull();
    expect(screen.getByRole("toolbar", { name: "Open a view" })).toBeInTheDocument();
  });
});
