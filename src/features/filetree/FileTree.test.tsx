import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { initialTabs } from "../../app/tabs";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { useUi } from "../commands/ui";
import { FileTree } from "./FileTree";
import { RowColorsDialog } from "./RowColors";
import { rowColors } from "./rowColorsModel";
import { useTreeClipboard } from "./clipboard";
import { useSidebarChat } from "../ai/sidebarChatState";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  // Delegate to a fresh in-memory backend per test.
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

async function setup(files: Record<string, string>) {
  h.b = createMemoryBackend(files);
  useAppStore.setState({
    vault: { root: "/vault", name: "Vault" },
    tree: null,
    activePath: null,
    tabs: initialTabs(),
    mainView: "note",
    pendingTarget: null,
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
  render(<FileTree />);
}

const row = (name: string) => screen.getByRole("treeitem", { name });
const queryRow = (name: string) => screen.queryByRole("treeitem", { name });

/**
 * Drag `src` with the pointer to `target` (null: the empty area under the rows), landing at
 * `at` (0 top – 1 bottom) of the target row. jsdom has no layout, so the target's box and
 * the element under the pointer are given here.
 */
async function drag(
  src: HTMLElement,
  target: HTMLElement | null,
  at = 0.5,
  { release = true } = {},
) {
  const box = { top: 100, height: 20, bottom: 120, left: 0, right: 200, width: 200, x: 0, y: 100 };
  if (target) vi.spyOn(target, "getBoundingClientRect").mockReturnValue(box as DOMRect);
  document.elementFromPoint = () => target ?? screen.getByRole("tree");
  fireEvent.pointerDown(src, { button: 0, clientX: 10, clientY: 10 });
  fireEvent.pointerMove(window, { clientX: 10, clientY: 60 });
  fireEvent.pointerMove(window, { clientX: 10, clientY: 100 + 20 * at });
  if (!release) return;
  fireEvent.pointerUp(window, { clientX: 10, clientY: 100 + 20 * at });
  fireEvent.click(target ?? screen.getByRole("tree"));
  // A later click is a click again.
  await act(() => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(() => {
  localStorage.clear();
  useConfig.setState({ config: DEFAULT_CONFIG });
});
afterEach(() => vi.restoreAllMocks());

describe("FileTree", () => {
  it("sends a right-clicked note to the right AI chat without opening a modal or generating", async () => {
    await setup({ "Bio.md": "# Biology\nCells make ATP." });
    useUi.setState({ modal: null });
    useSidebarChat.setState({ open: false, context: null });
    fireEvent.contextMenu(row("Bio"), { clientX: 20, clientY: 20 });
    fireEvent.click(screen.getByRole("menuitem", { name: "AI" }));
    expect(screen.queryByRole("menuitem", { name: "Ask AI about this note" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Send to AI Chat" }));
    await waitFor(() => expect(useSidebarChat.getState().open).toBe(true));
    expect(useSidebarChat.getState().context).toMatchObject({
      sources: ["Bio.md"],
      text: "# Biology\nCells make ATP.",
    });
    expect(useAppStore.getState().activePath).toBeNull();
    expect(useUi.getState().modal).toBeNull();
  });
  it("renders nested folders collapsed, notes without .md, other files dimmed", async () => {
    await setup({ "School/Bio.md": "", "School/Math/Calc.md": "", "Ideas.md": "", "doc.pdf": "" });
    expect(row("School")).toHaveAttribute("aria-expanded", "false");
    expect(row("Ideas")).toBeInTheDocument();
    expect(row("doc.pdf")).toHaveClass("dimmed");
    expect(queryRow("Bio")).toBeNull();

    fireEvent.click(row("School"));
    expect(row("School")).toHaveAttribute("aria-expanded", "true");
    expect(row("Bio")).toHaveAttribute("aria-level", "2");
    fireEvent.click(row("Math"));
    expect(row("Calc")).toHaveAttribute("aria-level", "3");

    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(queryRow("Bio")).toBeNull();
  });

  it("turns the folder's arrow and drops in only the rows its opening reveals", async () => {
    await setup({ "School/Bio.md": "", "School/Chem.md": "", "Ideas.md": "" });
    const chevron = () => row("School").querySelector(".filetree-chevron")!;
    expect(chevron()).not.toHaveClass("open");
    expect(row("Ideas")).not.toHaveClass("entering"); // nothing animates on first show

    fireEvent.click(row("School"));
    expect(chevron()).toHaveClass("open");
    expect(row("Bio")).toHaveClass("entering");
    expect(row("Chem")).toHaveClass("entering");
    // One after another: the second row starts a little later.
    expect(row("Bio").style.animationDelay).toBe("0ms");
    expect(row("Chem").style.animationDelay).toBe("14ms");
    expect(row("School")).not.toHaveClass("entering");
    expect(row("Ideas")).not.toHaveClass("entering");

    fireEvent.click(row("School"));
    expect(chevron()).not.toHaveClass("open");
  });

  it("stops treating a folder as just opened once its rows have dropped in", async () => {
    await setup({ "School/Bio.md": "" });
    fireEvent.click(row("School"));
    expect(row("Bio")).toHaveClass("entering");
    await act(() => new Promise((r) => setTimeout(r, 550)));
    // A note added or renamed in the folder later doesn't drop in again.
    expect(row("Bio")).not.toHaveClass("entering");
  });

  it("doesn't animate the folders another vault opens with", async () => {
    localStorage.setItem("axis:filetree:expanded:/other", JSON.stringify(["School"]));
    await setup({ "School/Bio.md": "" });
    expect(queryRow("Bio")).toBeNull();
    act(() => useAppStore.setState({ vault: { root: "/other", name: "Other" } }));
    expect(row("Bio")).not.toHaveClass("entering");
  });

  it("persists expanded folders per vault", async () => {
    await setup({ "School/Bio.md": "" });
    fireEvent.click(row("School"));
    expect(JSON.parse(localStorage.getItem("axis:filetree:expanded:/vault")!)).toEqual(["School"]);
  });

  it("opens notes and images on click but not unsupported files", async () => {
    await setup({ "Ideas.md": "", "pic.png": "", "doc.pdf": "" });
    fireEvent.click(row("doc.pdf"));
    expect(useAppStore.getState().activePath).toBeNull();
    fireEvent.click(row("pic.png"));
    expect(useAppStore.getState().activePath).toBe("pic.png");
    fireEvent.click(row("Ideas"));
    expect(useAppStore.getState().activePath).toBe("Ideas.md");
    expect(row("Ideas")).toHaveClass("active");
  });

  it("creates a uniquely named note in the selected folder, opens it, and renames it", async () => {
    await setup({ "School/Untitled.md": "", "School/Bio.md": "" });
    fireEvent.click(row("School"));
    fireEvent.click(screen.getByRole("button", { name: "New note" }));

    const input = await screen.findByRole("textbox", { name: "New name" });
    expect(input).toHaveValue("Untitled 1");
    expect(h.b.files()).toHaveProperty(["School/Untitled 1.md"]);
    expect(useAppStore.getState().activePath).toBe("School/Untitled 1.md");

    fireEvent.change(input, { target: { value: "Plan" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(row("Plan")).toBeInTheDocument());
    expect(Object.keys(h.b.files()).sort()).toEqual([
      "School/Bio.md",
      "School/Plan.md",
      "School/Untitled.md",
    ]);
    // The open note follows the rename.
    expect(useAppStore.getState().activePath).toBe("School/Plan.md");
  });

  it("creates folders at the root when nothing is selected", async () => {
    await setup({ "Ideas.md": "" });
    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    const input = await screen.findByRole("textbox", { name: "New name" });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(row("Untitled folder")).toBeInTheDocument());
  });

  it("cancels a rename with Escape and renames with F2", async () => {
    await setup({ "Ideas.md": "x" });
    const tree = screen.getByRole("tree");
    fireEvent.click(row("Ideas"));
    fireEvent.keyDown(tree, { key: "F2" });
    let input = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(input, { target: { value: "Other" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(h.b.files()).toEqual({ "Ideas.md": "x" });

    fireEvent.keyDown(tree, { key: "F2" });
    input = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(input, { target: { value: "Thoughts" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(h.b.files()).toEqual({ "Thoughts.md": "x" }));
  });

  it("renames folders and files from the visible toolbar, preserving contents and extensions", async () => {
    await setup({ "School/Bio.md": "biology", "Ideas.md": "ideas" });
    const rename = screen.getByRole("button", { name: "Rename selected item" });
    expect(rename).toBeDisabled();
    fireEvent.click(row("School"));
    fireEvent.click(rename);
    let input = screen.getByRole("textbox", { name: "New name" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Studies" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(h.b.files()).toHaveProperty(["Studies/Bio.md"], "biology"));
    expect(row("Bio")).toBeInTheDocument();
    fireEvent.click(row("Ideas"));
    fireEvent.click(rename);
    input = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(input, { target: { value: "Thoughts" } });
    fireEvent.blur(input);
    await waitFor(() => expect(h.b.files()).toHaveProperty(["Thoughts.md"], "ideas"));
    expect(useAppStore.getState().activePath).toBe("Thoughts.md");
  });

  it("drops at the release location and rejects releases outside the sidebar", async () => {
    await setup({ "Ideas.md": "ideas", "A/One.md": "", "B/Two.md": "" });
    const destination = row("B");
    vi.spyOn(destination, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 20,
    } as DOMRect);
    await drag(row("Ideas"), row("A"), 0.5, { release: false });
    document.elementFromPoint = () => destination;
    fireEvent.pointerUp(window, { clientX: 10, clientY: 110 });
    await waitFor(() => expect(h.b.files()).toHaveProperty(["B/Ideas.md"], "ideas"));
    await act(() => new Promise((r) => setTimeout(r, 0)));

    await drag(row("A"), row("B"), 0.5, { release: false });
    document.elementFromPoint = () => document.body;
    fireEvent.pointerUp(window, { clientX: 500, clientY: 110 });
    expect(h.b.files()).toHaveProperty(["A/One.md"]);
    expect(h.b.files()).not.toHaveProperty(["B/A/One.md"]);
    await act(() => new Promise((r) => setTimeout(r, 0)));
  });

  it("moves a folder and its contents into another folder", async () => {
    await setup({ "A/Nested/Note.md": "keep me", "B/Other.md": "" });
    await drag(row("A"), row("B"));
    await waitFor(() => expect(h.b.files()).toHaveProperty(["B/A/Nested/Note.md"], "keep me"));
    expect(h.b.files()).not.toHaveProperty(["A/Nested/Note.md"]);
  });

  it("does not reorder or select a nonexistent item when a cross-folder move fails", async () => {
    await setup({ "Ideas.md": "ideas", "School/Bio.md": "biology" });
    fireEvent.click(row("School"));
    fireEvent.click(row("Ideas"));
    vi.spyOn(h.b, "renameEntry").mockRejectedValueOnce({ code: "Io", message: "Move refused" });
    await drag(row("Ideas"), row("Bio"), 0.8);
    await waitFor(() => expect(useAppStore.getState().error).toBe("Move refused"));
    expect(useConfig.getState().config.fileOrder).toEqual({});
    expect(row("Ideas")).toHaveAttribute("aria-selected", "true");
    expect(h.b.files()).toEqual({ "Ideas.md": "ideas", "School/Bio.md": "biology" });
  });

  it("moves entries by dragging, rejecting a folder into itself", async () => {
    await setup({ "Ideas.md": "i", "School/Math/Calc.md": "c" });
    await drag(row("Ideas"), row("School"));
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/Ideas.md"], "i"));

    // The destination opens so the moved item remains visible and selected.
    expect(row("School")).toHaveAttribute("aria-expanded", "true");
    expect(row("Ideas")).toHaveAttribute("aria-selected", "true");
    await drag(row("School"), row("Math"));
    // Dropping a folder into its own child is ignored.
    expect(h.b.files()).toEqual({ "School/Ideas.md": "i", "School/Math/Calc.md": "c" });

    // Dropping on empty space moves to the top level.
    fireEvent.click(row("Math"));
    await drag(row("Calc"), null);
    await waitFor(() => expect(h.b.files()).toHaveProperty(["Calc.md"], "c"));
  });

  it("shows where a drag will land, and Escape cancels it", async () => {
    await setup({ "A.md": "", "B.md": "" });
    await drag(row("B"), row("A"), 0.2, { release: false });
    expect(row("A")).toHaveClass("drop-before");
    expect(row("B")).toHaveClass("dragged");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(row("A")).not.toHaveClass("drop-before");
    fireEvent.pointerUp(window);
    expect(useConfig.getState().config.fileOrder).toEqual({});
  });

  it("cancels a drag when the window loses focus", async () => {
    await setup({ "Ideas.md": "keep", "School/Bio.md": "" });
    await drag(row("Ideas"), row("School"), 0.5, { release: false });
    expect(row("Ideas")).toHaveClass("dragged");
    fireEvent.blur(window);
    expect(row("Ideas")).not.toHaveClass("dragged");
    fireEvent.pointerUp(window, { clientX: 10, clientY: 110 });
    expect(h.b.files()).toHaveProperty(["Ideas.md"], "keep");
    expect(h.b.files()).not.toHaveProperty(["School/Ideas.md"]);
  });

  it("moves a nested file to the explicit vault-root target", async () => {
    await setup({ "School/Ideas.md": "keep", "School/Bio.md": "" });
    fireEvent.click(row("School"));
    await drag(row("Ideas"), row("Bio"), 0.5, { release: false });
    const root = screen.getByLabelText("Move to vault root");
    document.elementFromPoint = () => root;
    fireEvent.pointerUp(window, { clientX: 10, clientY: 20 });
    await waitFor(() => expect(h.b.files()).toHaveProperty(["Ideas.md"], "keep"));
    expect(h.b.files()).not.toHaveProperty(["School/Ideas.md"]);
    expect(screen.queryByLabelText("Move to vault root")).not.toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 0)));
  });

  it("ignores other pointers and cancels when the captured pointer is interrupted", async () => {
    await setup({ "Ideas.md": "keep", "School/Bio.md": "" });
    const target = row("School");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 100, height: 20 } as DOMRect);
    document.elementFromPoint = () => target;
    fireEvent.pointerDown(row("Ideas"), { button: 0, pointerId: 7, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 10, clientY: 110 });
    expect(row("Ideas")).toHaveClass("dragged");
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 10, clientY: 110 });
    expect(row("Ideas")).toHaveClass("dragged");
    fireEvent.pointerCancel(window, { pointerId: 8 });
    expect(row("Ideas")).toHaveClass("dragged");
    fireEvent.lostPointerCapture(row("Ideas"), { pointerId: 7, buttons: 1 });
    expect(row("Ideas")).toHaveClass("dragged");
    fireEvent.lostPointerCapture(row("Ideas"), { pointerId: 7 });
    expect(row("Ideas")).not.toHaveClass("dragged");
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 10, clientY: 110 });
    expect(h.b.files()).toHaveProperty(["Ideas.md"], "keep");
    expect(h.b.files()).not.toHaveProperty(["School/Ideas.md"]);
  });

  it("orders items by dragging between them, and keeps the order", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "", "School/X.md": "", "School/Y.md": "" });
    const names = () => screen.getAllByRole("treeitem").map((r) => r.textContent);
    expect(names()).toEqual(["School", "A", "B", "C"]);
    await drag(row("C"), row("A"), 0.2); // the top edge of A: before it
    await waitFor(() => expect(names()).toEqual(["School", "C", "A", "B"]));
    expect(useConfig.getState().config.fileOrder[""]).toEqual(["School", "C.md", "A.md", "B.md"]);
    // The click ending the drag doesn't open what's under the pointer.
    expect(useAppStore.getState().activePath).toBeNull();

    // Between two items in another folder: moved there, in that place.
    fireEvent.click(row("School"));
    await drag(row("B"), row("X"), 0.8); // the bottom edge of X: after it
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/B.md"]));
    await waitFor(() => expect(names()).toEqual(["School", "X", "B", "Y", "C", "A"]));
    expect(useConfig.getState().config.fileOrder).toEqual({
      "": ["School", "C.md", "A.md"],
      School: ["X.md", "B.md", "Y.md"],
    });

    // A rename keeps its place.
    fireEvent.click(row("C"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(input, { target: { value: "Zed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(names()).toEqual(["School", "X", "B", "Y", "Zed", "A"]));
  });

  it("moves items up and down with Alt + arrows, and sorts A–Z again from the menu", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "" });
    const names = () => screen.getAllByRole("treeitem").map((r) => r.textContent);
    fireEvent.click(row("C"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(names()).toEqual(["A", "C", "B"]));

    fireEvent.click(row("A"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "ArrowDown", altKey: true });
    await waitFor(() => expect(names()).toEqual(["C", "A", "B"]));

    // On the empty area (the top level), the menu offers A–Z again.
    fireEvent.contextMenu(screen.getByRole("tree"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Sort A–Z" }));
    await waitFor(() => expect(names()).toEqual(["A", "B", "C"]));
    fireEvent.contextMenu(screen.getByRole("tree"));
    expect(screen.queryByRole("menuitem", { name: "Sort A–Z" })).not.toBeInTheDocument();
  });

  it("offers Move folder and Move file", async () => {
    await setup({ "School/Bio.md": "", "Ideas.md": "" });
    fireEvent.contextMenu(row("School"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move folder" }));
    expect(useUi.getState().modal).toEqual({ kind: "move", path: "School" });
    fireEvent.contextMenu(row("Ideas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move file" }));
    expect(useUi.getState().modal).toEqual({ kind: "move", path: "Ideas.md" });
  });

  it("moves a folder to the trash only after confirmation", async () => {
    await setup({ "School/Bio.md": "", "Ideas.md": "" });
    useAppStore.getState().openFile("School/Bio.md");
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    fireEvent.contextMenu(row("School"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete" }));
    expect(confirm).toHaveBeenCalledOnce();
    expect(h.b.files()).toHaveProperty(["School/Bio.md"]);

    confirm.mockReturnValueOnce(true);
    fireEvent.contextMenu(row("School"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(queryRow("School")).toBeNull());
    expect(h.b.files()).toEqual({ "Ideas.md": "" });
    // The open note inside the trashed folder is closed.
    expect(useAppStore.getState().activePath).toBeNull();
  });

  it("supports keyboard navigation", async () => {
    await setup({ "School/Bio.md": "", "Ideas.md": "" });
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(row("School")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(row("School")).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(tree, { key: "ArrowRight" });
    expect(row("Bio")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tree, { key: "Enter" });
    expect(useAppStore.getState().activePath).toBe("School/Bio.md");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(row("School")).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tree, { key: "ArrowLeft" });
    expect(row("School")).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(tree, { key: "End" });
    expect(row("Ideas")).toHaveAttribute("aria-selected", "true");
  });

  it("reports backend errors to the store", async () => {
    await setup({ "a.md": "", "b.md": "" });
    fireEvent.click(row("a"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(input, { target: { value: "b" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(useAppStore.getState().error).toMatch(/already exists/i));
    expect(h.b.files()).toEqual({ "a.md": "", "b.md": "" });
  });

  it("sets a folder's AI access from the context menu and marks it", async () => {
    await setup({ "Medical/scan.md": "", "Notes/a.md": "" });
    fireEvent.contextMenu(row("Medical"));
    fireEvent.click(screen.getByRole("menuitem", { name: "AI" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "AI Access" }));
    expect(screen.getByRole("menuitemradio", { name: "Inherit" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Never" }));
    await waitFor(() =>
      expect(JSON.parse(h.b.files()[".axisnotes/config.json"]!).ai.folders).toEqual({
        Medical: "never",
      }),
    );
    expect(within(row("Medical, AI: never")).getByTitle("AI: never")).toBeInTheDocument();
    fireEvent.contextMenu(row("Medical, AI: never"));
    fireEvent.click(screen.getByRole("menuitem", { name: "AI" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "AI Access" }));
    expect(screen.getByRole("menuitemradio", { name: "Never" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Inherit" }));
    await waitFor(() => expect(row("Medical")).toBeInTheDocument());
  });

  it("gives a row its own background and text color from Change Colors", async () => {
    await setup({ "Ideas.md": "", "School/Bio.md": "" });
    fireEvent.contextMenu(row("Ideas"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change Colors" }));
    expect(useUi.getState().modal).toEqual({ kind: "colors", path: "Ideas.md" });

    const onClose = vi.fn();
    render(<RowColorsDialog path="Ideas.md" onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Colors for Ideas" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Background #0090ff40" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Text #ffc53d" }));
    await waitFor(() =>
      expect(JSON.parse(h.b.files()[".axisnotes/config.json"]!).entryColors).toEqual({
        "Ideas.md": { background: "#0090ff40", text: "#ffc53d" },
      }),
    );
    expect(row("Ideas")).toHaveClass("has-bg", "has-fg");
    expect(row("Ideas").style.getPropertyValue("--row-bg")).toBe("#0090ff40");
    expect(row("Ideas").style.getPropertyValue("--row-fg")).toBe("#ffc53d");
    expect(row("School")).not.toHaveClass("has-bg");

    // Default text keeps the background; Reset clears both.
    fireEvent.click(within(dialog).getByRole("radio", { name: "Default text" }));
    await waitFor(() => expect(row("Ideas")).not.toHaveClass("has-fg"));
    expect(row("Ideas")).toHaveClass("has-bg");
    fireEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    await waitFor(() => expect(row("Ideas")).not.toHaveClass("has-bg"));
    expect(useConfig.getState().config.entryColors).toEqual({});
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps a folder's colors (and its children's) when it is renamed", async () => {
    useConfig.setState({
      config: {
        ...DEFAULT_CONFIG,
        entryColors: { School: { background: "#30a46c40" }, "School/Bio.md": { text: "#e5484d" } },
      },
    });
    await setup({ "School/Bio.md": "" });
    fireEvent.click(row("School"));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(input, { target: { value: "Uni" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(useConfig.getState().config.entryColors).toEqual({
        Uni: { background: "#30a46c40" },
        "Uni/Bio.md": { text: "#e5484d" },
      }),
    );
    expect(row("Uni")).toHaveClass("has-bg");
  });

  it("ignores saved colors that are not hex, so the config can't inject CSS", () => {
    expect(rowColors({ background: "url(https://x.test/a.png)", text: "#abc" })).toEqual({
      text: "#abc",
    });
    expect(rowColors({ background: "red; color: blue" })).toBeUndefined();
    expect(rowColors({ background: "#11223344" })).toEqual({ background: "#11223344" });
  });
});

describe("FileTree: several items at once", () => {
  const names = () => screen.getAllByRole("treeitem").map((r) => r.textContent);
  const picked = () =>
    screen
      .getAllByRole("treeitem")
      .filter((r) => r.getAttribute("aria-selected") === "true")
      .map((r) => r.textContent);

  it("selects a range with Shift+click, and a plain click goes back to one row", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "", "D.md": "" });
    expect(screen.getByRole("tree")).toHaveAttribute("aria-multiselectable", "true");
    fireEvent.click(row("B"));
    fireEvent.click(row("D"), { shiftKey: true });
    expect(picked()).toEqual(["B", "C", "D"]);
    // Shift+click doesn't open what it selects.
    expect(useAppStore.getState().activePath).toBe("B.md");
    // From the same anchor, the other way.
    fireEvent.click(row("A"), { shiftKey: true });
    expect(picked()).toEqual(["A", "B"]);
    fireEvent.click(row("C"));
    expect(picked()).toEqual(["C"]);
    expect(useAppStore.getState().activePath).toBe("C.md");
  });

  it("extends with Shift+arrows and clears with Escape", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "" });
    const tree = screen.getByRole("tree");
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    fireEvent.keyDown(tree, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(tree, { key: "ArrowDown", shiftKey: true });
    expect(picked()).toEqual(["A", "B", "C"]);
    fireEvent.keyDown(tree, { key: "ArrowUp", shiftKey: true });
    expect(picked()).toEqual(["A", "B"]);
    fireEvent.keyDown(tree, { key: "Escape" });
    expect(picked()).toEqual(["B"]);
    fireEvent.keyDown(tree, { key: "ArrowDown", shiftKey: true });
    fireEvent.keyDown(tree, { key: "ArrowDown" });
    expect(picked()).toEqual(["C"]);
  });

  it("trashes the selected items after one confirmation", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "", "School/Bio.md": "" });
    useAppStore.getState().openFile("School/Bio.md"); // shows School open
    fireEvent.click(row("A"));
    fireEvent.click(row("School"), { shiftKey: true });
    expect(picked()).toEqual(["School", "Bio", "A"]);
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);

    // The menu of a picked row is for all of them; Bio goes with its folder.
    fireEvent.contextMenu(row("A"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete 2 items" }));
    expect(confirm).toHaveBeenCalledWith("Move 2 items to the trash?\n\nSchool\nA");
    expect(Object.keys(h.b.files())).toHaveLength(4);

    confirm.mockReturnValueOnce(true);
    fireEvent.keyDown(screen.getByRole("tree"), { key: "Delete" });
    await waitFor(() => expect(names()).toEqual(["B", "C"]));
    expect(h.b.files()).toEqual({ "B.md": "", "C.md": "" });
    expect(useAppStore.getState().activePath).not.toBe("School/Bio.md");
  });

  it("gives a row outside the selection its own menu", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "" });
    fireEvent.click(row("A"));
    fireEvent.click(row("B"), { shiftKey: true });
    fireEvent.contextMenu(row("C"));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toBeInTheDocument();
    expect(picked()).toEqual(["C"]);
  });

  it("drags all the selected items into a folder", async () => {
    await setup({ "A.md": "a", "B.md": "b", "C.md": "c", "School/X.md": "" });
    fireEvent.click(row("A"));
    fireEvent.click(row("B"), { shiftKey: true });
    await drag(row("B"), row("School"));
    await waitFor(() =>
      expect(h.b.files()).toEqual({
        "School/A.md": "a",
        "School/B.md": "b",
        "C.md": "c",
        "School/X.md": "",
      }),
    );
    await waitFor(() => expect(picked()).toEqual(["A", "B"]));
  });

  it("drags the selected items between two rows, keeping their order", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "", "D.md": "" });
    fireEvent.click(row("A"));
    fireEvent.click(row("B"), { shiftKey: true });
    await drag(row("A"), row("D"), 0.8); // after D
    await waitFor(() => expect(names()).toEqual(["C", "D", "A", "B"]));
    expect(picked()).toEqual(["A", "B"]);

    fireEvent.click(row("D"));
    fireEvent.click(row("A"), { shiftKey: true });
    await drag(row("D"), row("C"), 0.2); // before C
    await waitFor(() => expect(names()).toEqual(["D", "A", "C", "B"]));
  });

  it.each([
    { side: "into", at: 0.5 },
    { side: "before", at: 0.2 },
    { side: "after", at: 0.8 },
  ])(
    "drags the selected folder $side another row when a selected child is pressed",
    async ({ side, at }) => {
      await setup({ "A/One.md": "one", "A/Two.md": "two", "B/Other.md": "other" });
      fireEvent.click(row("A"));
      fireEvent.click(row("Two"), { shiftKey: true });
      expect(picked()).toEqual(["A", "One", "Two"]);

      await drag(row("One"), row("B"), at, { release: false });
      expect(document.querySelector(".filetree-ghost")).toHaveTextContent("A");
      fireEvent.pointerUp(window, { clientX: 10, clientY: 100 + 20 * at });
      await act(() => new Promise((r) => setTimeout(r, 0)));

      const folder = side === "into" ? "B/A" : "A";
      await waitFor(() =>
        expect(
          Object.fromEntries(
            Object.entries(h.b.files()).filter(([path]) => !path.startsWith(".axisnotes/")),
          ),
        ).toEqual({
          [`${folder}/One.md`]: "one",
          [`${folder}/Two.md`]: "two",
          "B/Other.md": "other",
        }),
      );
      await waitFor(() => expect(picked()).toEqual(["A"]));
      if (side !== "into")
        expect(names()).toEqual(
          side === "before" ? ["A", "One", "Two", "B"] : ["B", "A", "One", "Two"],
        );
    },
  );

  it("drags a row outside the selection on its own", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "", "School/X.md": "" });
    fireEvent.click(row("A"));
    fireEvent.click(row("B"), { shiftKey: true });
    await drag(row("C"), row("School"));
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/C.md"]));
    expect(h.b.files()).toHaveProperty(["A.md"]);
    expect(h.b.files()).toHaveProperty(["B.md"]);
  });
});

describe("FileTree: copy, cut and paste (T-194)", () => {
  const tree = () => screen.getByRole("tree");
  const key = (k: string) => fireEvent.keyDown(tree(), { key: k, ctrlKey: true });
  const menuItem = (name: string) => screen.getByRole("menuitem", { name });
  const picked = () =>
    screen
      .getAllByRole("treeitem")
      .filter((r) => r.getAttribute("aria-selected") === "true")
      .map((r) => r.textContent);

  beforeEach(() => useTreeClipboard.setState({ clip: null }));

  it("copies a note with Ctrl+C and pastes it into the selected folder with Ctrl+V", async () => {
    await setup({ "Bio.md": "cells", "School/Maths.md": "" });
    fireEvent.click(row("Bio"));
    key("c");
    expect(useAppStore.getState().notice).toMatch(/Copied "Bio"/);
    fireEvent.click(row("School"));
    key("v");
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/Bio.md"], "cells"));
    expect(h.b.files()).toHaveProperty(["Bio.md"], "cells");
    expect(row("School")).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => expect(picked()).toEqual(["Bio"]));

    // Pasting again beside a note of the same name makes "Bio copy", then "Bio copy 2".
    key("v");
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/Bio copy.md"], "cells"));
    key("v");
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/Bio copy 2.md"]));
    expect(useAppStore.getState().error).toBeNull();
  });

  it("copies a folder with everything in it from the menu, but not into itself", async () => {
    await setup({ "School/Maths.md": "sums", "School/Week 1/Notes.md": "w1" });
    fireEvent.contextMenu(row("School"));
    fireEvent.click(screen.getAllByRole("menuitem", { name: "Copy" }).at(-1)!);
    fireEvent.contextMenu(tree());
    fireEvent.click(menuItem("Paste"));
    await waitFor(() =>
      expect(h.b.files()).toEqual({
        "School/Maths.md": "sums",
        "School/Week 1/Notes.md": "w1",
        "School copy/Maths.md": "sums",
        "School copy/Week 1/Notes.md": "w1",
      }),
    );
    await waitFor(() => expect(picked()).toEqual(["School copy"]));

    fireEvent.contextMenu(row("School"));
    fireEvent.click(menuItem("Paste"));
    await waitFor(() => expect(useAppStore.getState().error).toMatch(/"School" into itself/));
    expect(Object.keys(h.b.files())).toHaveLength(4);
  });

  it("moves cut items on paste, dimming them until then", async () => {
    await setup({ "A.md": "a", "B.md": "b", "School/X.md": "" });
    fireEvent.click(row("A"));
    fireEvent.click(row("B"), { shiftKey: true });
    key("x");
    expect(row("A")).toHaveClass("cut");
    expect(row("B")).toHaveClass("cut");
    expect(h.b.files()).toHaveProperty(["A.md"]);

    fireEvent.contextMenu(row("School"));
    fireEvent.click(menuItem("Paste 2 items"));
    await waitFor(() =>
      expect(h.b.files()).toEqual({ "School/A.md": "a", "School/B.md": "b", "School/X.md": "" }),
    );
    await waitFor(() => expect(picked()).toEqual(["A", "B"]));
    expect(row("A")).not.toHaveClass("cut");
    // A cut is pasted once.
    fireEvent.contextMenu(tree());
    expect(screen.queryByRole("menuitem", { name: /Paste/ })).toBeNull();
  });

  it("keeps a cut item that would clash where it is, to paste elsewhere", async () => {
    await setup({ "A.md": "top", "School/A.md": "inner", "Work/W.md": "" });
    fireEvent.click(row("A"));
    key("x");
    fireEvent.click(row("School"));
    key("v");
    await waitFor(() => expect(useAppStore.getState().error).toMatch(/already exists/));
    expect(h.b.files()).toHaveProperty(["A.md"], "top");
    // School is open now: its own A comes first, then the cut one at the top level.
    expect(screen.getAllByRole("treeitem", { name: "A" }).map((r) => r.className)).toEqual([
      expect.not.stringContaining("cut"),
      expect.stringContaining("cut"),
    ]);
    fireEvent.click(row("Work"));
    key("v");
    await waitFor(() => expect(h.b.files()).toHaveProperty(["Work/A.md"], "top"));
  });

  it("copies several picked items from their menu", async () => {
    await setup({ "A.md": "a", "B.md": "b", "Archive/Old.md": "" });
    fireEvent.click(row("A"));
    fireEvent.click(row("B"), { shiftKey: true });
    fireEvent.contextMenu(row("A"));
    fireEvent.click(menuItem("Copy 2 items"));
    fireEvent.click(row("Archive"));
    key("v");
    await waitFor(() => expect(h.b.files()).toHaveProperty(["Archive/B.md"], "b"));
    expect(h.b.files()).toHaveProperty(["Archive/A.md"], "a");
    expect(h.b.files()).toHaveProperty(["A.md"], "a");
    await waitFor(() => expect(picked()).toEqual(["A", "B"]));
  });

  it("pastes nothing copied in another vault, or items deleted since", async () => {
    await setup({ "A.md": "" });
    useTreeClipboard.setState({ clip: { root: "/other", mode: "copy", paths: ["A.md"] } });
    fireEvent.contextMenu(tree());
    expect(screen.queryByRole("menuitem", { name: /Paste/ })).toBeNull();
    key("v");
    useTreeClipboard.setState({ clip: { root: "/vault", mode: "copy", paths: ["Gone.md"] } });
    key("v");
    await waitFor(() => expect(useAppStore.getState().error).toMatch(/no longer in the vault/));
    expect(h.b.files()).toEqual({ "A.md": "" });
  });
});

describe("FileTree menus (T-287)", () => {
  const tree = () => screen.getByRole("tree");
  const menuItem = (name: string) => screen.getByRole("menuitem", { name });
  const labels = (el: Element) => [...el.querySelectorAll(".menu-label")].map((l) => l.textContent);
  /** The open menu's groups (each divided from the last by a line), by item label. */
  const groups = () =>
    within(screen.getAllByRole("menu")[0]!)
      .getAllByRole("group")
      .map(labels)
      .filter((g) => g.length > 0);

  it("lays out a file's menu in the human's order, with an AI submenu", async () => {
    await setup({ "School/Bio.md": "" });
    h.b.appWindows = { openNote: vi.fn(async () => {}) };
    fireEvent.click(row("School"));
    fireEvent.contextMenu(row("Bio"));
    expect(groups()).toEqual([
      ["Open in new tab", "Open in split screen", "Open in new window"],
      ["New Note", "New Grid", "New Canvas", "New Folder"],
      ["Copy", "Move file", "Favorite"],
      ["AI"],
      ["Change Icon", "Change Colors"],
      ["Delete", "Copy", "Cut", "Rename"],
    ]);
    fireEvent.click(menuItem("AI"));
    const ai = screen.getByRole("menu", { name: "AI" });
    expect(labels(ai).slice(0, 2)).toEqual(["Send to AI Chat", "AI Skills"]);
    expect(labels(ai).at(-1)).toBe("AI Access");
    expect(
      [...ai.querySelectorAll("[role^=menuitem]")].filter((i) => i.closest("[role=menu]") === ai),
    ).toHaveLength(3);
    fireEvent.click(within(ai).getByRole("menuitem", { name: "AI Access" }));
    expect(labels(screen.getByRole("menu", { name: "AI Access" }))).toEqual([
      "Inherit",
      "Never",
      "Local models only",
      "Allowed models",
    ]);
  });

  it("lays out a folder's menu, keeping rename, delete and the clipboard last", async () => {
    await setup({ "School/Bio.md": "" });
    fireEvent.contextMenu(row("School"));
    expect(groups()).toEqual([
      ["New Note", "New Grid", "New Canvas", "New Folder"],
      ["Copy", "Move folder", "Search in folder", "Favorite"],
      ["AI"],
      ["Change Icon", "Change Colors"],
      ["Add dashboard"],
      ["Delete", "Copy", "Cut", "Rename"],
    ]);
  });

  it("drops the word here from the empty space's menu", async () => {
    await setup({ "A.md": "" });
    fireEvent.contextMenu(tree());
    expect(groups()).toEqual([["New Note", "New Grid", "New Canvas", "New Folder"]]);
  });

  it("creates new items next to a file, in its folder", async () => {
    await setup({ "School/Bio.md": "" });
    fireEvent.click(row("School"));
    fireEvent.contextMenu(row("Bio"));
    fireEvent.click(menuItem("New Note"));
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/Untitled.md"]));
  });

  it("opens a file in a new tab, a split pane or a new window", async () => {
    await setup({ "Bio.md": "", "Ideas.md": "" });
    const openNote = vi.fn(async () => {});
    h.b.appWindows = { openNote };
    useAppStore.getState().openFile("Ideas.md");

    fireEvent.contextMenu(row("Bio"));
    fireEvent.click(menuItem("Open in new tab"));
    expect(useAppStore.getState().tabs.list.map((t) => t.path)).toEqual(["Ideas.md", "Bio.md"]);

    const before = useAppStore.getState().panes;
    fireEvent.contextMenu(row("Ideas"));
    fireEvent.click(menuItem("Open in split screen"));
    const s = useAppStore.getState();
    expect(Object.keys(s.panes.tabs)).toHaveLength(Object.keys(before.tabs).length + 1);
    // The new pane shows the file; the first pane keeps its tabs.
    expect(s.panes.focused).not.toBe(before.focused);
    expect(s.activePath).toBe("Ideas.md");
    expect(s.panes.tabs[before.focused]!.list.map((t) => t.path)).toEqual(["Ideas.md", "Bio.md"]);

    fireEvent.contextMenu(row("Bio"));
    fireEvent.click(menuItem("Open in new window"));
    expect(openNote).toHaveBeenCalledWith("Bio.md");
  });

  it("leaves Open in new window out where no other window can open", async () => {
    await setup({ "Bio.md": "" });
    fireEvent.contextMenu(row("Bio"));
    expect(menuItem("Open in split screen")).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Open in new window" })).toBeNull();
  });

  it("makes a copy beside the item, and undoes it", async () => {
    await setup({ "School/Bio.md": "cells" });
    fireEvent.click(row("School"));
    fireEvent.contextMenu(row("Bio"));
    // The first Copy duplicates beside the item; the last group's Copy is the clipboard.
    fireEvent.click(screen.getAllByRole("menuitem", { name: "Copy" })[0]!);
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/Bio copy.md"], "cells"));
    await waitFor(() => expect(row("Bio copy")).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(tree(), { key: "z", ctrlKey: true });
    await waitFor(() => expect(h.b.files()).toEqual({ "School/Bio.md": "cells" }));
  });

  it("searches in a folder", async () => {
    await setup({ "Week 1/Notes.md": "", "School/Bio.md": "" });
    fireEvent.contextMenu(row("Week 1"));
    fireEvent.click(menuItem("Search in folder"));
    expect(useAppStore.getState().leftPanel).toBe("search");
    expect(useAppStore.getState().searchQuery).toBe(`path:"Week 1/" `);
  });

  it("favorites a file, then offers to unfavorite it", async () => {
    await setup({ "Bio.md": "" });
    fireEvent.contextMenu(row("Bio"));
    fireEvent.click(menuItem("Favorite"));
    await waitFor(() => expect(useConfig.getState().config.favorites).toEqual(["Bio.md"]));
    fireEvent.contextMenu(row("Bio"));
    expect(menuItem("Unfavorite")).toBeInTheDocument();
  });

  it("works from the keyboard: the menu key, arrows into and out of submenus, Escape", async () => {
    await setup({ "Bio.md": "" });
    fireEvent.click(row("Bio"));
    fireEvent.keyDown(tree(), { key: "ContextMenu" });
    const menu = screen.getByRole("menu", { name: "Bio" });
    expect(menu).toHaveFocus();
    const press = (key: string) => fireEvent.keyDown(document.activeElement!, { key });
    press("ArrowDown");
    expect(menuItem("Open in new tab")).toHaveFocus();
    press("End");
    expect(menuItem("Rename")).toHaveFocus();
    // Up from Rename to AI: Cut, Copy, Delete, Change Colors, Change Icon, AI.
    for (let i = 0; i < 6; i++) press("ArrowUp");
    expect(menuItem("AI")).toHaveFocus();
    press("ArrowRight");
    expect(menuItem("Send to AI Chat")).toHaveFocus();
    press("End");
    expect(menuItem("AI Access")).toHaveFocus();
    press("Enter");
    expect(screen.getByRole("menuitemradio", { name: "Inherit" })).toHaveFocus();
    press("ArrowLeft");
    expect(menuItem("AI Access")).toHaveFocus();
    expect(screen.queryByRole("menu", { name: "AI Access" })).toBeNull();
    press("Escape");
    expect(menuItem("AI")).toHaveFocus();
    expect(screen.queryByRole("menu", { name: "AI" })).toBeNull();
    press("Escape");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(tree()).toHaveFocus();
  });

  it("opens a submenu on hover and closes it when another item is pointed at", async () => {
    await setup({ "Bio.md": "" });
    fireEvent.contextMenu(row("Bio"));
    fireEvent.mouseEnter(menuItem("AI").parentElement!);
    expect(screen.getByRole("menu", { name: "AI" })).toBeInTheDocument();
    expect(menuItem("AI")).toHaveAttribute("aria-expanded", "true");
    fireEvent.mouseEnter(menuItem("Change Icon"));
    expect(screen.queryByRole("menu", { name: "AI" })).toBeNull();
  });
});
