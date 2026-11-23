import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { CONFIG_PATH, DEFAULT_CONFIG, useConfig } from "../../app/config";
import {
  FOLDS_KEY,
  moveToSide,
  normalize,
  placeBeside,
  removePanel,
} from "../../app/sidebarLayout";
import { renameEntry } from "../files/renameEntry";
import { allCommands } from "../commands/registry";
import { remapFavorites } from "./favorites";
import { LeftSidebar, RightSidebar } from "./Sidebars";
import { PluginsSettings } from "../settings/PluginsSettings";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const realElementFromPoint = document.elementFromPoint;

beforeEach(async () => {
  localStorage.clear();
  // The local graph needs WebGL; keep it folded so it doesn't load here.
  localStorage.setItem(FOLDS_KEY, JSON.stringify({ graph: false }));
  h.b = createMemoryBackend({
    "Plan.md": "# Plan\n\n## Goals\n",
    "School/Biology.md": "# Biology\n",
    "School/Chemistry.md": "# Chemistry\n",
  });
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG), loaded: true });
  useAppStore.setState({
    vault: { root: "/v", name: "V" },
    activePath: null,
    leftPanel: "files",
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
});

afterEach(() => {
  document.elementFromPoint = realElementFromPoint;
});

/** The config as saved in the vault. */
async function saved() {
  return JSON.parse((await h.b.readFile(CONFIG_PATH)).content) as typeof DEFAULT_CONFIG;
}

const tabNames = () =>
  within(screen.getByRole("tablist", { name: "Sidebar panels" }))
    .getAllByRole("tab")
    .map((t) => t.getAttribute("aria-label"));

const rightSections = () =>
  [...document.querySelectorAll(".sidebar-right [data-panel-id]")].map(
    (el) => (el as HTMLElement).dataset.panelId,
  );

/** Drag `from` onto `to`, landing in its first or second half. */
function drag(from: Element, to: HTMLElement, half: "first" | "second", across = false) {
  const box = across
    ? { left: 0, top: 0, width: 300, height: 30, right: 300, bottom: 30, x: 0, y: 0 }
    : { left: 0, top: 0, width: 30, height: 30, right: 30, bottom: 30, x: 0, y: 0 };
  vi.spyOn(to, "getBoundingClientRect").mockReturnValue(box as DOMRect);
  document.elementFromPoint = () => to;
  const at = half === "first" ? 5 : 25;
  const x = across ? 15 : at;
  const y = across ? at : 15;
  fireEvent.pointerDown(from, { button: 0, clientX: 400, clientY: 400 });
  fireEvent.pointerMove(window, { clientX: x, clientY: y });
  fireEvent.pointerUp(window, { clientX: x, clientY: y });
}

describe("panel placement", () => {
  it("drops unknown and repeated ids and adds missing panels at their default place", () => {
    const p = normalize({
      left: ["files", "nope", "tags", "files"],
      right: ["backlinks", "tags", "calendar"],
      hidden: ["search", 7],
    });
    expect(p.left).toEqual(["favorites", "files", "tags", "hub"]);
    expect(p.right).toEqual(["outline", "graph", "backlinks", "calendar"]);
    expect(p.hidden).toEqual(["search"]);
  });

  it("moves, places and removes panels", () => {
    const p = normalize(DEFAULT_CONFIG.sidebars);
    const moved = placeBeside(p, "tags", "outline", true);
    expect(moved.left).not.toContain("tags");
    expect(moved.right).toEqual(["calendar", "outline", "tags", "graph", "backlinks"]);
    expect(moveToSide(moved, "outline", "left").left.at(-1)).toBe("outline");
    const removed = removePanel(p, "search");
    expect(removed.left).not.toContain("search");
    expect(removed.hidden).toEqual(["search"]);
    expect(moveToSide(removed, "search", "right").hidden).toEqual([]);
  });
});

describe("customizing the sidebars", () => {
  it("reorders tabs with Alt+arrow keys and by dragging, and saves the order", async () => {
    render(<LeftSidebar />);
    expect(tabNames()).toEqual(["Files", "Search", "Tags", "AXIS Hub"]);
    const files = screen.getByRole("tab", { name: "Files" });
    files.focus();
    fireEvent.keyDown(files, { key: "ArrowRight", altKey: true });
    await waitFor(() => expect(tabNames()).toEqual(["Search", "Files", "Tags", "AXIS Hub"]));
    expect((await saved()).sidebars.left).toEqual(["favorites", "search", "files", "tags", "hub"]);

    drag(
      screen.getByRole("tab", { name: "AXIS Hub" }),
      screen.getByRole("tab", { name: "Search" }),
      "first",
    );
    await waitFor(() => expect(tabNames()).toEqual(["AXIS Hub", "Search", "Files", "Tags"]));
    expect((await saved()).sidebars.left).toEqual(["favorites", "hub", "search", "files", "tags"]);
  });

  it("reorders sections with Alt+↑ / Alt+↓ and keeps focus on the moved heading", async () => {
    act(() => useAppStore.getState().openFile("Plan.md"));
    render(<RightSidebar />);
    expect(rightSections()).toEqual(["calendar", "outline", "graph", "backlinks"]);
    const outline = within(screen.getByRole("region", { name: "Outline section" })).getByRole(
      "button",
      { name: "Outline" },
    );
    outline.focus();
    fireEvent.keyDown(outline, { key: "ArrowUp", altKey: true });
    await waitFor(() =>
      expect(rightSections()).toEqual(["outline", "calendar", "graph", "backlinks"]),
    );
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Outline"));
    expect((await saved()).sidebars.right).toEqual(["outline", "calendar", "graph", "backlinks"]);

    // Shift+F10 opens the panel's menu with its first item focused; Escape returns focus.
    const heading = document.activeElement as HTMLElement;
    fireEvent.keyDown(heading, { key: "F10", shiftKey: true });
    const menu = screen.getByRole("menu", { name: "Outline panel" });
    expect(within(menu).getByRole("menuitem", { name: "Move up" })).toBeDisabled();
    expect(document.activeElement).toBe(within(menu).getByRole("menuitem", { name: "Move down" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(heading);
  });

  it("moves a panel to the other sidebar from its menu or by dropping it there", async () => {
    act(() => useAppStore.getState().openFile("Plan.md"));
    render(
      <>
        <LeftSidebar />
        <RightSidebar />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Tags" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to right sidebar" }));
    await screen.findByRole("region", { name: "Tags section" });
    expect(tabNames()).not.toContain("Tags");
    expect(rightSections().at(-1)).toBe("tags");

    // Dragged onto the left sidebar's empty part, a section goes to its end.
    const left = screen.getByRole("complementary", { name: "Navigation" });
    const calendar = within(screen.getByRole("region", { name: "Calendar section" })).getByRole(
      "button",
      { name: "Calendar" },
    );
    drag(calendar, left, "second");
    await waitFor(() =>
      expect(within(left).getByRole("region", { name: "Calendar section" })).toBeTruthy(),
    );
    const s = (await saved()).sidebars;
    expect(s.left).toEqual(["favorites", "files", "search", "hub", "calendar"]);
    expect(s.right).toEqual(["outline", "graph", "backlinks", "tags"]);
  });

  it("removes a panel and brings it back from Add panel, which also resets the layout", async () => {
    act(() => useAppStore.getState().openFile("Plan.md"));
    render(<RightSidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Calendar panel options" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove panel" }));
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Calendar section" })).toBeNull(),
    );
    expect((await saved()).sidebars.hidden).toEqual(["calendar"]);

    fireEvent.click(screen.getByRole("button", { name: "Add panel to right sidebar" }));
    const menu = screen.getByRole("menu", { name: "Add panel" });
    expect(within(menu).getByRole("menuitem", { name: "Move Files here" })).toBeTruthy();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Calendar" }));
    await screen.findByRole("region", { name: "Calendar section" });
    expect(rightSections().at(-1)).toBe("calendar");
    expect((await saved()).sidebars.hidden).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Add panel to right sidebar" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Reset sidebar layout" }));
    await waitFor(() =>
      expect(rightSections()).toEqual(["calendar", "outline", "graph", "backlinks"]),
    );
  });

  it("finds a moved panel from a command, and brings a removed one back", async () => {
    render(
      <>
        <LeftSidebar />
        <RightSidebar />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("tab", { name: "Search" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove panel" }));
    await waitFor(() => expect(tabNames()).not.toContain("Search"));
    act(() => useAppStore.getState().setLeftPanel("search"));
    await waitFor(() => expect(tabNames()).toContain("Search"));
    expect(screen.getByRole("tab", { name: "Search" })).toHaveAttribute("aria-selected", "true");
  });

  it("folds a section and remembers it on this device", async () => {
    render(<LeftSidebar />);
    const toggle = within(screen.getByRole("region", { name: "Favorites section" })).getByRole(
      "button",
      { name: "Favorites" },
    );
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/choose Add to favorites/)).toBeTruthy();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/choose Add to favorites/)).toBeNull();
    expect(JSON.parse(localStorage.getItem(FOLDS_KEY)!)).toMatchObject({ favorites: false });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
});

describe("favorites", () => {
  const favNames = () =>
    within(screen.getByRole("list", { name: "Favorites" }))
      .getAllByRole("listitem")
      .map((li) => li.querySelector(".fav-name")?.textContent);

  it("adds from the file tree's menu, opens, reorders, follows renames and persists", async () => {
    render(<LeftSidebar />);
    const tree = screen.getByRole("tree", { name: "Vault files" });
    fireEvent.contextMenu(within(tree).getByText("Plan"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to favorites" }));
    fireEvent.contextMenu(within(tree).getByText("School"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Add to favorites" }));
    await waitFor(() => expect(favNames()).toEqual(["Plan", "School"]));
    expect((await saved()).favorites).toEqual(["Plan.md", "School"]);

    // The menu now offers to take it out again.
    fireEvent.contextMenu(within(tree).getByText("Plan"));
    expect(screen.getByRole("menuitem", { name: "Remove from favorites" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });

    // Clicking opens a note; a folder opens in the file tree.
    const list = screen.getByRole("list", { name: "Favorites" });
    fireEvent.click(within(list).getByRole("button", { name: "Plan" }));
    expect(useAppStore.getState().activePath).toBe("Plan.md");
    fireEvent.click(within(list).getByRole("button", { name: "School" }));
    await waitFor(() => expect(within(tree).getByText("Biology")).toBeTruthy());

    // Drag and Alt+↑ reorder.
    const rows = within(list).getAllByRole("listitem");
    drag(within(rows[0]!).getByRole("button", { name: "Plan" }), rows[1]!, "second", true);
    await waitFor(() => expect(favNames()).toEqual(["School", "Plan"]));
    const plan = within(list).getByRole("button", { name: "Plan" });
    fireEvent.keyDown(plan, { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(favNames()).toEqual(["Plan", "School"]));

    // Renaming the folder carries its favorite along.
    await act(() => renameEntry("School", "Classes"));
    await waitFor(() => expect(favNames()).toEqual(["Plan", "Classes"]));
    expect((await saved()).favorites).toEqual(["Plan.md", "Classes"]);

    // Reloading the vault config brings them back.
    useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
    await act(() => useConfig.getState().load());
    expect(useConfig.getState().config.favorites).toEqual(["Plan.md", "Classes"]);

    fireEvent.click(screen.getByRole("button", { name: "Remove Plan from favorites" }));
    await waitFor(() => expect(favNames()).toEqual(["Classes"]));
    expect((await saved()).favorites).toEqual(["Classes"]);
  });

  it("adds and removes the open file from the command palette", async () => {
    act(() => useAppStore.getState().openFile("Plan.md"));
    const cmd = (id: string) => allCommands().find((c) => c.id === id)!;
    expect(cmd("favorite-add").available?.()).toBe(true);
    expect(cmd("favorite-remove").available?.()).toBe(false);
    await act(async () => cmd("favorite-add").run());
    await waitFor(() => expect(useConfig.getState().config.favorites).toEqual(["Plan.md"]));
    expect(cmd("favorite-add").available?.()).toBe(false);
    await act(async () => cmd("favorite-remove").run());
    await waitFor(() => expect(useConfig.getState().config.favorites).toEqual([]));
  });

  it("keeps a missing favorite listed, and remaps paths inside a renamed folder", async () => {
    expect(remapFavorites(["A/b.md", "Ab.md", "A"], "A", "C")).toEqual(["C/b.md", "Ab.md", "C"]);
    expect(remapFavorites(["A/b.md"], "A", null)).toBeNull();
    expect(remapFavorites(["X.md"], "A", "C")).toBeNull();
    await act(() =>
      useConfig.getState().update((c) => ({ ...c, favorites: ["Gone.md", "Plan.md"] })),
    );
    render(<LeftSidebar />);
    const gone = screen.getAllByRole("button", { name: /Gone/ })[0]!;
    expect(gone).toHaveClass("missing");
    fireEvent.click(gone);
    expect(useAppStore.getState().activePath).toBeNull();
  });
});

describe("review fixes (T-276)", () => {
  it("doesn't bring back a removed Files panel when AXIS Hub is switched off", async () => {
    await act(() =>
      useConfig.getState().update((c) => ({
        ...c,
        sidebars: {
          ...c.sidebars,
          left: ["favorites", "search", "tags", "hub"],
          hidden: ["files"],
        },
      })),
    );
    useAppStore.setState({ leftPanel: "hub" });
    render(<PluginsSettings />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Enable AXIS Hub" }));
    await waitFor(() => expect(useConfig.getState().config.hubEnabled).toBe(false));
    expect(useAppStore.getState().leftPanel).toBe("files");
    expect((await saved()).sidebars.hidden).toEqual(["files"]);
  });

  it("drops favorites that aren't vault paths when the config loads", async () => {
    await h.b.writeFile(
      CONFIG_PATH,
      JSON.stringify({ favorites: ["Plan.md", null, 3, { p: 1 }, "", "School"] }),
    );
    await act(() => useConfig.getState().load());
    expect(useConfig.getState().config.favorites).toEqual(["Plan.md", "School"]);
    render(<LeftSidebar />);
    expect(screen.getByRole("list", { name: "Favorites" })).toBeTruthy();
    await act(() => renameEntry("School", "Classes"));
    expect(useConfig.getState().config.favorites).toEqual(["Plan.md", "Classes"]);
  });

  it("moves focus to the next panel after Remove panel", async () => {
    act(() => useAppStore.getState().openFile("Plan.md"));
    render(<RightSidebar />);
    const calendar = within(screen.getByRole("region", { name: "Calendar section" })).getByRole(
      "button",
      { name: "Calendar" },
    );
    calendar.focus();
    fireEvent.keyDown(calendar, { key: "F10", shiftKey: true });
    fireEvent.click(screen.getByRole("menuitem", { name: "Remove panel" }));
    await waitFor(() => expect(document.activeElement?.textContent).toBe("Outline"));
  });

  it("keeps focus for a heading that mounts late, like the lazy Local graph", async () => {
    const { keepFocus, handleRef } = await import("./panelCustomize");
    const Late = ({ show }: { show: boolean }) =>
      show ? (
        <button data-panel-handle="graph" ref={handleRef("graph")}>
          Local graph
        </button>
      ) : null;
    const { rerender } = render(<Late show={false} />);
    (document.activeElement as HTMLElement | null)?.blur();
    keepFocus("graph");
    // Several frames pass before the heading appears.
    await new Promise((r) => setTimeout(r, 120));
    rerender(<Late show />);
    expect(document.activeElement?.textContent).toBe("Local graph");
  });

  it("lets other menus close when a panel's ⋯ button is pressed, and toggles its own", () => {
    act(() => useAppStore.getState().openFile("Plan.md"));
    render(<RightSidebar />);
    const seen = vi.fn();
    window.addEventListener("mousedown", seen);
    const options = screen.getByRole("button", { name: "Calendar panel options" });
    fireEvent.mouseDown(options);
    expect(seen).toHaveBeenCalledTimes(1);
    fireEvent.click(options);
    expect(screen.getByRole("menu", { name: "Calendar panel" })).toBeTruthy();
    expect(options).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseDown(options);
    fireEvent.click(options);
    expect(screen.queryByRole("menu")).toBeNull();
    window.removeEventListener("mousedown", seen);
  });

  it("says so when no panel on the right has anything for the open view", async () => {
    await act(() =>
      useConfig.getState().update((c) => ({
        ...c,
        sidebars: {
          left: [...c.sidebars.left, "calendar", "backlinks"],
          right: ["outline", "graph"],
          hidden: [],
        },
      })),
    );
    await h.b.writeFile(
      "Budget.axgrid",
      JSON.stringify({ version: 1, rows: 1, cols: 1, cells: {} }),
    );
    await act(() => useAppStore.getState().refreshTree());
    act(() => useAppStore.getState().openFile("Budget.axgrid"));
    render(<RightSidebar />);
    expect(screen.getByText(/Nothing to show here for this view/)).toBeTruthy();
  });
});
