import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { initialTabs } from "../../app/tabs";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { FileTree } from "./FileTree";
import { RowColorsDialog } from "./RowColors";
import { batch, changeSetting, clearTreeUndo, isRedoKey, isUndoKey, record, renamed } from "./undo";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

async function setup(files: Record<string, string>) {
  h.b = createMemoryBackend(files);
  await h.b.openVault("/vault");
  useAppStore.setState({
    vault: { root: "/vault", name: "Vault" },
    tree: null,
    activePath: null,
    tabs: initialTabs(),
    mainView: "note",
    pendingTarget: null,
    error: null,
    notice: null,
  });
  await act(() => useAppStore.getState().refreshTree());
  render(<FileTree />);
}

const row = (name: string) => screen.getByRole("treeitem", { name });
const queryRow = (name: string) => screen.queryByRole("treeitem", { name });
const tree = () => screen.getByRole("tree");
const undo = () => fireEvent.keyDown(tree(), { key: "z", ctrlKey: true });
const redo = () => fireEvent.keyDown(tree(), { key: "y", ctrlKey: true });
const names = () => screen.getAllByRole("treeitem").map((r) => r.textContent);
/** The vault's notes (undo also saves settings in .axisnotes). */
const notes = () =>
  Object.fromEntries(Object.entries(h.b.files()).filter(([p]) => !p.startsWith(".axisnotes/")));

beforeEach(() => {
  localStorage.clear();
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  clearTreeUndo();
});
afterEach(() => vi.restoreAllMocks());

function rename(from: string, to: string) {
  fireEvent.click(row(from));
  fireEvent.keyDown(tree(), { key: "F2" });
  const input = screen.getByRole("textbox", { name: "New name" });
  fireEvent.change(input, { target: { value: to } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("Undo in the file tree", () => {
  it("undoes and redoes a rename with Ctrl+Z and Ctrl+Y, keeping its icon", async () => {
    await setup({ "Ideas.md": "x" });
    useConfig.setState((s) => ({
      config: { ...s.config, folderIcons: { "Ideas.md": { icon: "star" } } },
    }));
    rename("Ideas", "Thoughts");
    await waitFor(() => expect(notes()).toEqual({ "Thoughts.md": "x" }));
    undo();
    await waitFor(() => expect(notes()).toEqual({ "Ideas.md": "x" }));
    expect(useConfig.getState().config.folderIcons).toEqual({ "Ideas.md": { icon: "star" } });
    expect(useAppStore.getState().notice).toBe("Undid: Rename “Ideas”.");
    redo();
    await waitFor(() => expect(notes()).toEqual({ "Thoughts.md": "x" }));
    // Ctrl+Shift+Z redoes too; nothing left to redo now.
    fireEvent.keyDown(tree(), { key: "Z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(useAppStore.getState().notice).toBe("Nothing to redo."));
  });

  it("puts a deleted folder back from the trash, with its colours and place", async () => {
    await setup({ "B/x.md": "keep", "A.md": "", "C.md": "" });
    useConfig.setState((s) => ({
      config: {
        ...s.config,
        entryColors: { B: { background: "#ff0000" } },
        fileOrder: { "": ["C.md", "B", "A.md"] },
      },
    }));
    await act(() => useAppStore.getState().refreshTree());
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.contextMenu(row("B"));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(queryRow("B")).toBeNull());
    expect(useConfig.getState().config.entryColors).toEqual({});
    undo();
    await waitFor(() => expect(h.b.files()).toHaveProperty(["B/x.md"], "keep"));
    expect(useConfig.getState().config.entryColors).toEqual({ B: { background: "#ff0000" } });
    await waitFor(() => expect(names()).toEqual(["C", "B", "A"]));
    // Redo deletes it again; undo brings it back again.
    redo();
    await waitFor(() => expect(queryRow("B")).toBeNull());
    undo();
    await waitFor(() => expect(h.b.files()).toHaveProperty(["B/x.md"], "keep"));
  });

  it("takes back a new note only while it's unchanged", async () => {
    await setup({ "Ideas.md": "" });
    fireEvent.click(screen.getByRole("button", { name: "New note" }));
    const input = await screen.findByRole("textbox", { name: "New name" });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(h.b.files()).toHaveProperty(["Untitled.md"]));
    await h.b.writeFile("Untitled.md", "typed since");
    undo();
    await waitFor(() => expect(useAppStore.getState().error).toMatch(/has changed since/));
    expect(h.b.files()).toHaveProperty(["Untitled.md"], "typed since");

    fireEvent.click(screen.getByRole("button", { name: "New folder" }));
    fireEvent.keyDown(await screen.findByRole("textbox", { name: "New name" }), {
      key: "Escape",
    });
    await waitFor(() => expect(row("Untitled folder")).toBeInTheDocument());
    undo();
    await waitFor(() => expect(queryRow("Untitled folder")).toBeNull());
  });

  it("removes pasted copies in one step", async () => {
    await setup({ "Bio.md": "cells", "Chem.md": "acids", "School/x.md": "" });
    fireEvent.click(row("Bio"));
    fireEvent.click(row("Chem"), { shiftKey: true });
    fireEvent.keyDown(tree(), { key: "c", ctrlKey: true });
    fireEvent.click(row("School"));
    fireEvent.keyDown(tree(), { key: "v", ctrlKey: true });
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/Chem.md"]));
    undo();
    await waitFor(() =>
      expect(Object.keys(notes()).sort()).toEqual(["Bio.md", "Chem.md", "School/x.md"]),
    );
    expect(useAppStore.getState().notice).toBe("Undid: Paste 2 items.");
  });

  it("puts the order back after moving items up", async () => {
    await setup({ "A.md": "", "B.md": "", "C.md": "" });
    fireEvent.click(row("C"));
    fireEvent.keyDown(tree(), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(names()).toEqual(["A", "C", "B"]));
    undo();
    await waitFor(() => expect(names()).toEqual(["A", "B", "C"]));
  });

  it("undoes AI access and row colours (one step per colours dialog)", async () => {
    await setup({ "School/x.md": "" });
    fireEvent.contextMenu(row("School"));
    fireEvent.click(screen.getByRole("menuitem", { name: "AI access: never" }));
    await waitFor(() =>
      expect(useConfig.getState().config.ai.folders).toEqual({ School: "never" }),
    );
    undo();
    await waitFor(() => expect(useConfig.getState().config.ai.folders).toEqual({}));

    const { unmount } = render(<RowColorsDialog path="School" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Colours for School" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Background #0090ff40" }));
    fireEvent.click(within(dialog).getByRole("radio", { name: "Text #ffc53d" }));
    unmount();
    expect(useConfig.getState().config.entryColors.School).toBeDefined();
    undo();
    await waitFor(() => expect(useConfig.getState().config.entryColors).toEqual({}));
  });

  it("works when focus isn't in a text box or the editor, and not when it is", async () => {
    await setup({ "Ideas.md": "x" });
    rename("Ideas", "Thoughts");
    await waitFor(() => expect(notes()).toEqual({ "Thoughts.md": "x" }));
    const box = document.createElement("textarea");
    document.body.append(box);
    fireEvent.keyDown(box, { key: "z", ctrlKey: true });
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(notes()).toEqual({ "Thoughts.md": "x" });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    await waitFor(() => expect(notes()).toEqual({ "Ideas.md": "x" }));
    box.remove();
  });
});

describe("undo steps", () => {
  it("groups a batch into one step, reversed newest first", async () => {
    await setup({ "a.md": "", "b.md": "" });
    await batch("Move 2 items", async () => {
      await h.b.renameEntry("a.md", "A1.md");
      record(renamed("a.md", "A1.md"));
      await h.b.renameEntry("A1.md", "A2.md");
      record(renamed("A1.md", "A2.md"));
    });
    undo();
    await waitFor(() => expect(Object.keys(notes()).sort()).toEqual(["a.md", "b.md"]));
    expect(useAppStore.getState().notice).toBe("Undid: Move 2 items.");
  });

  it("records a setting change only when it changed", async () => {
    await setup({ "a.md": "" });
    await changeSetting("Icon", "folderIcons", "a.md", () => {});
    undo();
    await waitFor(() =>
      expect(useAppStore.getState().notice).toBe("Nothing to undo in the file tree."),
    );
  });

  it("knows its keys", () => {
    const k = (key: string, mods: Partial<KeyboardEvent> = {}) => ({
      key,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    });
    expect(isUndoKey(k("z", { ctrlKey: true }))).toBe(true);
    expect(isUndoKey(k("z", { metaKey: true }))).toBe(true);
    expect(isUndoKey(k("Z", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isRedoKey(k("Z", { ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isRedoKey(k("y", { ctrlKey: true }))).toBe(true);
    expect(isUndoKey(k("z", { ctrlKey: true, altKey: true }))).toBe(false);
  });
});
