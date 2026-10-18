import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { activeTab, initialTabs } from "../../app/tabs";
import { useUi } from "../commands/ui";
import { Modals } from "../commands/Modals";
import { FileTree } from "../filetree";
import { Editor } from "../editor";
import { TabBar } from "./TabBar";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    "Alpha.md": "# Alpha\n\nfirst\nsecond\nthird\n",
    "Beta.md": "# Beta\n",
    "School/Gamma.md": "# Gamma\n",
    "Sheet.axgrid": "{}",
  });
  await h.b.openVault("/v");
  useConfig.setState({ config: DEFAULT_CONFIG, loaded: true });
  useUi.setState({ modal: null });
  useAppStore.setState({ vault: null });
  useAppStore.setState({ vault: { root: "/v", name: "V" }, error: null, notice: null });
  await useAppStore.getState().refreshTree();
});

const store = () => useAppStore.getState();
const titles = () => screen.getAllByRole("tab").map((t) => t.textContent);
const selected = () => screen.getByRole("tab", { selected: true }).textContent;

describe("tab bar", () => {
  it("shows open notes as tabs that switch, close, and open new tabs", () => {
    render(<TabBar />);
    expect(titles()).toEqual(["New tab"]);
    act(() => store().openFile("Alpha.md"));
    act(() => store().openFile("Beta.md", undefined, { newTab: true }));
    act(() => store().openFile("Sheet.axgrid", undefined, { newTab: true }));
    expect(titles()).toEqual(["Alpha", "Beta", "Sheet"]);
    expect(selected()).toBe("Sheet");

    fireEvent.click(screen.getByRole("tab", { name: /Alpha/ }));
    expect(store().activePath).toBe("Alpha.md");
    expect(store().mainView).toBe("note");

    fireEvent.click(screen.getByRole("button", { name: "Close Alpha" }));
    expect(titles()).toEqual(["Beta", "Sheet"]);
    expect(store().activePath).toBe("Beta.md"); // the tab to the right takes over

    // Middle-click closes too.
    fireEvent(
      screen.getByRole("tab", { name: /Sheet/ }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(titles()).toEqual(["Beta"]);

    fireEvent.click(screen.getByRole("button", { name: "New tab" }));
    expect(titles()).toEqual(["Beta", "New tab"]);
    expect(store().activePath).toBeNull();
  });

  it("moves between tabs with the arrow keys", () => {
    render(<TabBar />);
    act(() => store().openFile("Alpha.md"));
    act(() => store().openFile("Beta.md", undefined, { newTab: true }));
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "ArrowRight" });
    expect(store().activePath).toBe("Alpha.md"); // wraps around
    fireEvent.keyDown(screen.getByRole("tab", { selected: true }), { key: "End" });
    expect(store().activePath).toBe("Beta.md");
  });

  it("pins tabs and closes others from the menu", () => {
    render(<TabBar />);
    act(() => store().openFile("Alpha.md"));
    act(() => store().openFile("Beta.md", undefined, { newTab: true }));
    act(() => store().openFile("School/Gamma.md", undefined, { newTab: true }));

    fireEvent.contextMenu(screen.getByRole("tab", { name: /Alpha/ }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Pin" }));
    expect(screen.getByRole("button", { name: "Unpin Alpha" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close Alpha" })).toBeNull();

    // A pinned tab keeps its note: opening another goes to a new tab.
    act(() => store().activateTab(store().tabs.list[0]!.id));
    act(() => store().openFile("Beta.md"));
    expect(titles()).toEqual(["Alpha", "Beta", "Beta", "Gamma"]);

    fireEvent.contextMenu(screen.getAllByRole("tab", { name: /Beta/ })[0]!);
    fireEvent.click(screen.getByRole("menuitem", { name: "Close others" }));
    expect(titles()).toEqual(["Alpha", "Beta"]); // the pinned tab stays
  });

  it("uses the note's custom icon", () => {
    useConfig.setState({
      config: { ...DEFAULT_CONFIG, folderIcons: { "Alpha.md": { icon: "🚀" } } },
    });
    render(<TabBar />);
    act(() => store().openFile("Alpha.md"));
    expect(screen.getByRole("tab", { name: /Alpha/ })).toHaveTextContent("🚀");
  });
});

describe("tab shortcuts", () => {
  const key = (init: KeyboardEventInit) => fireEvent.keyDown(window, init);

  it("opens, closes, cycles, jumps and goes back with the keyboard", () => {
    render(
      <>
        <Modals />
        <TabBar />
      </>,
    );
    act(() => store().openFile("Alpha.md"));
    act(() => store().openFile("Beta.md"));
    key({ key: "t", ctrlKey: true });
    expect(titles()).toEqual(["Beta", "New tab"]);
    act(() => store().openFile("School/Gamma.md"));
    key({ key: "Tab", ctrlKey: true });
    expect(selected()).toBe("Beta");
    key({ key: "Tab", ctrlKey: true, shiftKey: true });
    expect(selected()).toBe("Gamma");
    key({ key: "1", ctrlKey: true });
    expect(selected()).toBe("Beta");
    key({ key: "9", ctrlKey: true });
    expect(selected()).toBe("Gamma");

    // Back and forward within a tab.
    key({ key: "1", ctrlKey: true });
    key({ key: "ArrowLeft", ctrlKey: true, altKey: true });
    expect(store().activePath).toBe("Alpha.md");
    key({ key: "ArrowRight", ctrlKey: true, altKey: true });
    expect(store().activePath).toBe("Beta.md");

    key({ key: "w", ctrlKey: true });
    expect(titles()).toEqual(["Gamma"]);
  });

  it("won't close a pinned tab with Ctrl+W", () => {
    render(<Modals />);
    act(() => store().openFile("Alpha.md"));
    act(() => store().togglePinTab());
    fireEvent.keyDown(window, { key: "w", ctrlKey: true });
    expect(store().tabs.list).toHaveLength(1);
    expect(store().activePath).toBe("Alpha.md");
    expect(store().notice).toMatch(/pinned/);
  });
});

describe("tabs and the vault", () => {
  it("opens in a new tab with Ctrl+click or middle-click in the file tree", () => {
    render(
      <>
        <FileTree />
        <TabBar />
      </>,
    );
    fireEvent.click(screen.getByRole("treeitem", { name: "Alpha" }));
    fireEvent.click(screen.getByRole("treeitem", { name: "Beta" }), { ctrlKey: true });
    expect(titles()).toEqual(["Alpha", "Beta"]);
    fireEvent(
      screen.getByRole("treeitem", { name: "Alpha" }),
      new MouseEvent("auxclick", { bubbles: true, button: 1 }),
    );
    expect(titles()).toEqual(["Alpha", "Beta", "Alpha"]);
    // A plain click replaces the active tab's note.
    fireEvent.click(screen.getByRole("treeitem", { name: "Beta" }));
    expect(titles()).toEqual(["Alpha", "Beta", "Beta"]);
  });

  it("follows renames and closes tabs for trashed files", () => {
    act(() => store().openFile("School/Gamma.md"));
    act(() => store().openFile("Alpha.md", undefined, { newTab: true }));
    act(() => store().onEntryRenamed("School", "Uni"));
    expect(store().tabs.list.map((t) => t.path)).toEqual(["Uni/Gamma.md", "Alpha.md"]);
    act(() => store().onEntryRemoved("Alpha.md"));
    expect(store().tabs.list.map((t) => t.path)).toEqual(["Uni/Gamma.md"]);
    expect(store().activePath).toBe("Uni/Gamma.md");
  });

  it("restores a vault's tabs, dropping files that are gone", async () => {
    act(() => store().openFile("Alpha.md"));
    act(() => store().openFile("Beta.md", undefined, { newTab: true }));
    act(() => store().togglePinTab());
    act(() => store().openFile("School/Gamma.md", undefined, { newTab: true }));
    act(() => store().activateTab(store().tabs.list[1]!.id));

    // Another vault has its own (none yet).
    act(() => useAppStore.setState({ vault: { root: "/other", name: "O" } }));
    expect(store().tabs.list.map((t) => t.path)).toEqual([null]);

    await h.b.trashEntry("School/Gamma.md");
    act(() => useAppStore.setState({ vault: { root: "/v", name: "V" } }));
    expect(store().tabs.list.map((t) => t.path)).toEqual([
      "Alpha.md",
      "Beta.md",
      "School/Gamma.md",
    ]);
    expect(store().activePath).toBe("Beta.md");
    expect(activeTab(store().tabs).pinned).toBe(true);
    await act(() => store().refreshTree());
    expect(store().tabs.list.map((t) => t.path)).toEqual(["Alpha.md", "Beta.md"]);
  });

  it("keeps the graph and other views in tabs", () => {
    render(<TabBar />);
    act(() => store().openFile("Alpha.md"));
    act(() => store().setMainView("graph"));
    expect(titles()).toEqual(["Graph view"]);
    act(() => store().setMainView("note"));
    expect(titles()).toEqual(["Alpha"]);
    expect(store().activePath).toBe("Alpha.md");
  });

  it("starts with one empty tab", () => {
    useAppStore.setState({ tabs: initialTabs() });
    render(<TabBar />);
    expect(titles()).toEqual(["New tab"]);
  });
});

describe("returning to a note", () => {
  it("puts the cursor back where it was", async () => {
    const open = async (path: string) => {
      const utils = render(<Editor key={path} path={path} />);
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
      const view = EditorView.findFromDOM(
        utils.container.querySelector(".cm-editor") as HTMLElement,
      )!;
      return { ...utils, view };
    };
    const first = await open("Alpha.md");
    act(() => first.view.dispatch({ selection: { anchor: 20 } }));
    first.unmount();
    const again = await open("Alpha.md");
    expect(again.view.state.selection.main.head).toBe(20);
    again.unmount();

    // A link to a line wins over the remembered place.
    useAppStore.setState({ pendingTarget: { path: "Alpha.md", line: 3 } });
    const jumped = await open("Alpha.md");
    await waitFor(() =>
      expect(jumped.view.state.doc.lineAt(jumped.view.state.selection.main.head).number).toBe(3),
    );
  });
});
