import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { fuzzyIndices } from "./fuzzy";
import { Modals } from "./Modals";
import { useUi } from "./ui";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  localStorage.clear();
  h.b = createMemoryBackend({
    "Plan.md": "# Plan\n\n## Goals\n\n```\n# not a heading\n```\n\n### Risks\n",
    "Work/Roadmap.md": "Roadmap",
    "Work/Budget.axgrid": JSON.stringify({ version: 1, rows: 5, cols: 5, cells: {} }),
  });
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG), loaded: true });
  useUi.setState({ modal: null });
  useAppStore.setState({
    vault: { root: "/v", name: "V" },
    activePath: null,
    pendingTarget: null,
    error: null,
    notice: null,
  });
  await act(() => useAppStore.getState().refreshTree());
});
afterEach(() => vi.restoreAllMocks());

const key = (k: string, opts: KeyboardEventInit = {}) =>
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...opts }));
  });

function openPalette(query = "") {
  key("p", { ctrlKey: true });
  const input = screen.getByRole("combobox", { name: "Command palette" });
  if (query) fireEvent.change(input, { target: { value: query } });
  return input;
}

const options = () => within(screen.getByRole("listbox")).getAllByRole("option");

describe("fuzzy match positions", () => {
  it("marks a substring, else the subsequence", () => {
    expect(fuzzyIndices("road", "Roadmap")).toEqual([0, 1, 2, 3]);
    expect(fuzzyIndices("rdm", "Roadmap")).toEqual([0, 3, 4]);
    expect(fuzzyIndices("xyz", "Roadmap")).toBeNull();
  });
});

describe("command palette", () => {
  it("shows icons, highlights matches and lists recent commands first", async () => {
    render(<Modals />);
    let input = openPalette("graph");
    const first = options()[0]!;
    expect(first).toHaveTextContent("Open graph view");
    expect(first.querySelector("svg.picker-icon")).not.toBeNull();
    expect(first.querySelector("mark")).toHaveTextContent("graph");
    fireEvent.keyDown(input, { key: "Enter" });

    input = openPalette();
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(options()[0]).toHaveTextContent("Open graph view");
    expect(screen.getByText("All commands")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
  });

  it("offers note commands only while a file is open", async () => {
    render(<Modals />);
    let input = openPalette("duplicate");
    expect(screen.queryByRole("option", { name: /Duplicate note/ })).toBeNull();
    fireEvent.keyDown(input, { key: "Escape" });

    act(() => useAppStore.getState().openFile("Plan.md"));
    input = openPalette("duplicate");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Plan copy.md"));
    expect(h.b.files()["Plan copy.md"]).toBe(h.b.files()["Plan.md"]);
  });

  it("copies a link, pins to Home and deletes after asking", async () => {
    const write = vi.fn(async () => {});
    Object.assign(navigator, { clipboard: { writeText: write } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<Modals />);
    act(() => useAppStore.getState().openFile("Work/Roadmap.md"));

    fireEvent.keyDown(openPalette("copy link to note"), { key: "Enter" });
    await waitFor(() => expect(write).toHaveBeenCalledWith("[[Roadmap]]"));

    fireEvent.keyDown(openPalette("pin to home"), { key: "Enter" });
    await waitFor(() =>
      expect(
        useConfig.getState().config.dashboards[""]?.widgets.find((w) => w.type === "links")?.links,
      ).toEqual(["Work/Roadmap.md"]),
    );

    fireEvent.keyDown(openPalette("delete note"), { key: "Enter" });
    await waitFor(() => expect(h.b.files()["Work/Roadmap.md"]).toBeUndefined());
    expect(window.confirm).toHaveBeenCalled();
  });

  it("moves the open note to a folder chosen from a list", async () => {
    render(<Modals />);
    act(() => useAppStore.getState().openFile("Plan.md"));
    fireEvent.keyDown(openPalette("move note"), { key: "Enter" });
    const input = screen.getByRole("combobox", { name: 'Move "Plan" to' });
    fireEvent.change(input, { target: { value: "work" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Work/Plan.md"));
    expect(h.b.files()["Work/Plan.md"]).toBeDefined();
  });

  it("renames a grid by asking for its new name", async () => {
    render(<Modals />);
    act(() => useAppStore.getState().openFile("Work/Budget.axgrid"));
    fireEvent.keyDown(openPalette("rename note"), { key: "Enter" });
    const name = await screen.findByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Budget");
    fireEvent.change(name, { target: { value: "Costs" } });
    fireEvent.submit(name.closest("form")!);
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Work/Costs.axgrid"));
  });

  it("chooses a theme", async () => {
    render(<Modals />);
    fireEvent.keyDown(openPalette("choose theme"), { key: "Enter" });
    const input = screen.getByRole("combobox", { name: "Choose theme" });
    fireEvent.change(input, { target: { value: "retro" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useConfig.getState().config.theme).toBe("axis:retro"));
  });
});

describe("quick switcher", () => {
  const openSwitcher = () => {
    key("o", { ctrlKey: true });
    return screen.getByRole("combobox", { name: "Quick switcher" });
  };

  it("lists grids and canvases too, and recent files first", async () => {
    render(<Modals />);
    let input = openSwitcher();
    expect(screen.getByRole("option", { name: /Budget/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });

    act(() => useAppStore.getState().openFile("Work/Roadmap.md"));
    act(() => useAppStore.getState().openFile("Plan.md"));
    input = openSwitcher();
    // The open note itself isn't offered as "recent".
    expect(screen.getByText("Recent")).toBeInTheDocument();
    expect(options()[0]).toHaveTextContent("Roadmap");
    fireEvent.keyDown(input, { key: "Escape" });
  });

  it("jumps to a heading with Note#heading", async () => {
    render(<Modals />);
    const input = openSwitcher();
    fireEvent.change(input, { target: { value: "plan#" } });
    await waitFor(() => expect(screen.getByRole("option", { name: /Goals/ })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: /not a heading/ })).toBeNull();
    fireEvent.change(input, { target: { value: "plan#ris" } });
    expect(options()[0]).toHaveTextContent("Risks");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(useAppStore.getState().activePath).toBe("Plan.md");
    expect(useAppStore.getState().pendingTarget).toMatchObject({ heading: "Risks" });
  });
});
