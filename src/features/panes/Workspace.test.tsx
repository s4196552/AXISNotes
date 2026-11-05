import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { paneIds } from "../../app/panes";
import { getActiveEditor } from "../editor/activeEditor";
import { Workspace } from "./Workspace";

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
  h.b = createMemoryBackend({ "Alpha.md": "# Alpha\n\nfirst\n", "Beta.md": "# Beta\n" });
  await h.b.openVault("/v");
  useConfig.setState({ config: DEFAULT_CONFIG, loaded: true });
  useAppStore.setState({ vault: null });
  useAppStore.setState({ vault: { root: "/v", name: "V" }, error: null, notice: null });
  await useAppStore.getState().refreshTree();
});

const store = () => useAppStore.getState();
const panes = () => screen.getAllByRole("region", { name: "Pane" });
const titlesIn = (pane: HTMLElement) =>
  within(pane)
    .getAllByRole("tab")
    .map((t) => t.textContent);

/**
 * A pointer drag from `from` to a point on `to`, whose box (jsdom has no layout) is 100 ×
 * 100 at the origin.
 */
async function drag(from: Element, to: Element, x: number, y: number) {
  const box = { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0 };
  vi.spyOn(to, "getBoundingClientRect").mockReturnValue(box as DOMRect);
  document.elementFromPoint = () => to;
  fireEvent.pointerDown(from, { button: 0, clientX: 300, clientY: 300 });
  fireEvent.pointerMove(window, { clientX: x, clientY: y });
  fireEvent.pointerUp(window, { clientX: x, clientY: y });
  await act(() => new Promise((r) => setTimeout(r, 0)));
}

describe("split panes", () => {
  it("splits by dragging a tab to a pane's edge, and joins by dragging it to a tab row", async () => {
    const { container } = render(<Workspace />);
    act(() => store().openFile("Alpha.md"));
    act(() => store().openFile("Beta.md", undefined, { newTab: true }));
    expect(screen.queryAllByRole("region", { name: "Pane" })).toEqual([]); // one pane

    // Alpha's tab onto the right edge of the note: a pane on the right, showing Alpha.
    const panel = container.querySelector(".tab-panel")!;
    await drag(screen.getByRole("tab", { name: /Alpha/ }), panel, 90, 50);
    const [left, right] = panes();
    expect(titlesIn(left!)).toEqual(["Beta"]);
    expect(titlesIn(right!)).toEqual(["Alpha"]);
    expect(store().activePath).toBe("Alpha.md"); // the new pane has the focus
    expect(right).toHaveClass("focused");
    expect(container.querySelector(".pane-drop-zone")).toBeNull();

    // Pressing in the left pane focuses it, so the file tree and tab actions go there.
    fireEvent.pointerDown(left!.querySelector(".tab-panel")!);
    expect(store().activePath).toBe("Beta.md");
    act(() => store().newTab());
    expect(titlesIn(panes()[0]!)).toEqual(["Beta", "New tab"]);
    act(() => store().closeTab());

    // Beta's tab onto the right pane's tab row: it moves there and its old pane closes.
    const target = within(panes()[1]!).getByRole("tab", { name: /Alpha/ });
    await drag(within(panes()[0]!).getByRole("tab", { name: /Beta/ }), target, 90, 10);
    expect(screen.queryAllByRole("region", { name: "Pane" })).toEqual([]);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Alpha", "Beta"]);
    // The pane it came from closed with the drop; no drop marker stays behind.
    expect(container.querySelector(".pane-drop-zone, .drop-before, .drop-after")).toBeNull();
    expect(store().activePath).toBe("Beta.md");
  });

  it("closes a pane when its last tab closes, and splits from the tab menu", async () => {
    render(<Workspace />);
    act(() => store().openFile("Alpha.md"));
    fireEvent.contextMenu(screen.getByRole("tab", { name: /Alpha/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Split down" }));
    expect(panes()).toHaveLength(2);
    expect(store().panes.root).toMatchObject({ kind: "split", dir: "column" });
    act(() => store().closeTab());
    expect(screen.queryAllByRole("region", { name: "Pane" })).toEqual([]);
    expect(paneIds(store().panes.root)).toHaveLength(1);
    expect(store().activePath).toBe("Alpha.md");
  });

  it("keeps the same note in step across panes, and edits the focused one's", async () => {
    const { container } = render(<Workspace />);
    act(() => store().openFile("Alpha.md"));
    act(() => store().splitPane("right"));
    await waitFor(() => expect(container.querySelectorAll(".cm-editor")).toHaveLength(2));
    const [a, b] = Array.from(container.querySelectorAll<HTMLElement>(".cm-editor")).map((el) =>
      EditorView.findFromDOM(el)!,
    );
    await waitFor(() => expect(getActiveEditor()?.view).toBe(b));

    b!.dispatch({ changes: { from: b!.state.doc.length, insert: "typed on the right\n" } });
    await waitFor(() => expect(a!.state.doc.toString()).toContain("typed on the right"), {
      timeout: 4000,
    });
    expect((await h.b.readFile("Alpha.md")).content).toContain("typed on the right");

    fireEvent.pointerDown(panes()[0]!.querySelector(".tab-panel")!);
    await waitFor(() => expect(getActiveEditor()?.view).toBe(a));
  });

  it("saves the layout per vault and brings it back", () => {
    act(() => store().openFile("Alpha.md"));
    act(() => store().openFile("Beta.md", undefined, { newTab: true }));
    act(() => store().splitPane("right"));
    act(() => useAppStore.setState({ vault: { root: "/other", name: "O" } }));
    expect(paneIds(store().panes.root)).toHaveLength(1);
    act(() => useAppStore.setState({ vault: { root: "/v", name: "V" } }));
    const ids = paneIds(store().panes.root);
    expect(ids).toHaveLength(2);
    expect(store().panes.focused).toBe(ids[1]);
    expect(store().activePath).toBe("Beta.md");
  });
});
