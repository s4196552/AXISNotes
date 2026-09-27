import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { FileTree } from "./FileTree";

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
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
  render(<FileTree />);
}

const row = (name: string) => screen.getByRole("treeitem", { name });
const queryRow = (name: string) => screen.queryByRole("treeitem", { name });

beforeEach(() => {
  localStorage.clear();
  useConfig.setState({ config: DEFAULT_CONFIG });
});
afterEach(() => vi.restoreAllMocks());

describe("FileTree", () => {
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

  it("moves entries by drag and drop, rejecting a folder into itself", async () => {
    await setup({ "Ideas.md": "i", "School/Math/Calc.md": "c" });
    fireEvent.dragStart(row("Ideas"));
    fireEvent.dragOver(row("School"));
    fireEvent.drop(row("School"));
    await waitFor(() => expect(h.b.files()).toHaveProperty(["School/Ideas.md"], "i"));

    fireEvent.click(row("School"));
    fireEvent.dragStart(row("School"));
    fireEvent.drop(row("Math"));
    // Dropping a folder into its own child is ignored.
    expect(h.b.files()).toEqual({ "School/Ideas.md": "i", "School/Math/Calc.md": "c" });

    // Dropping on empty space moves to the root.
    fireEvent.click(row("Math"));
    fireEvent.dragStart(row("Calc"));
    fireEvent.drop(screen.getByRole("tree"));
    await waitFor(() => expect(h.b.files()).toHaveProperty(["Calc.md"], "c"));
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
    fireEvent.click(screen.getByRole("menuitem", { name: "AI access: never" }));
    await waitFor(() =>
      expect(JSON.parse(h.b.files()[".axis/config.json"]!).ai.folders).toEqual({
        Medical: "never",
      }),
    );
    expect(within(row("Medical, AI: never")).getByTitle("AI: never")).toBeInTheDocument();
    fireEvent.contextMenu(row("Medical, AI: never"));
    expect(screen.getByRole("menuitem", { name: "✓ AI access: never" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "AI access: inherit" }));
    await waitFor(() => expect(row("Medical")).toBeInTheDocument());
  });
});
