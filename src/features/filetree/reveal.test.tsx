import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { useLayout } from "../../app/layout";
import { FileTree } from "./FileTree";
import { ancestorsOf, revealOpenFile } from "./reveal";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const flushFrame = () => act(() => new Promise((r) => requestAnimationFrame(() => r(null))));
const row = (name: string) => screen.getByRole("treeitem", { name });
const queryRow = (name: string) => screen.queryByRole("treeitem", { name });

beforeEach(async () => {
  localStorage.clear();
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  h.b = createMemoryBackend({ "School/Math/Calc.md": "", "School/Bio.md": "", "Ideas.md": "" });
  useAppStore.setState({
    vault: { root: "/vault", name: "Vault" },
    tree: null,
    activePath: null,
    leftPanel: "search",
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
});

describe("showing the open file in the tree", () => {
  it("lists a path's folders", () => {
    expect(ancestorsOf("A/B/c.md")).toEqual(["A", "A/B"]);
    expect(ancestorsOf("c.md")).toEqual([]);
  });

  it("opens the folders of a note opened elsewhere and selects it", async () => {
    render(<FileTree />);
    expect(queryRow("Calc")).toBeNull();
    act(() => useAppStore.getState().openFile("School/Math/Calc.md"));
    await flushFrame();
    expect(row("School")).toHaveAttribute("aria-expanded", "true");
    expect(row("Calc")).toHaveAttribute("aria-selected", "true");
    // The keyboard cursor moved with it: one current row, not two.
    expect(screen.getAllByRole("treeitem", { selected: true })).toHaveLength(1);
  });

  it("leaves the tree alone when the setting is off, and reveals on request", async () => {
    useConfig.setState({
      config: { ...structuredClone(DEFAULT_CONFIG), fileTree: { revealActiveFile: false } },
    });
    useLayout.getState().setPanels({ left: false });
    render(<FileTree />);
    act(() => useAppStore.getState().openFile("School/Bio.md"));
    await flushFrame();
    expect(queryRow("Bio")).toBeNull();

    act(() => revealOpenFile());
    await flushFrame();
    expect(row("Bio")).toHaveAttribute("aria-selected", "true");
    expect(useAppStore.getState().leftPanel).toBe("files");
    expect(useLayout.getState().left).toBe(true);
  });
});
