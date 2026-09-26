import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { BacklinksPanel } from "./BacklinksPanel";
import { linkTextFor } from "./mentions";
import { SearchPanel } from "./SearchPanel";
import { LeftSidebar } from "./Sidebars";
import { TagsPanel } from "./TagsPanel";
import { buildTagTree } from "./tagTree";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const VAULT = {
  "Project Alpha.md": "# Project Alpha\n#work/alpha",
  "Notes.md": "Met about [[Project Alpha]] today.\nproject alpha is late. #work/beta #home",
  "Other.md": "Nothing here #work/alpha",
};

beforeEach(async () => {
  h.b = createMemoryBackend(VAULT);
  useAppStore.setState({
    vault: { root: "/v", name: "Vault" },
    activePath: null,
    pendingTarget: null,
    leftPanel: "files",
    searchQuery: "",
    indexVersion: 0,
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
});

describe("tag tree", () => {
  it("nests tags and totals children", () => {
    const tree = buildTagTree([
      { tag: "home", count: 1 },
      { tag: "work", count: 1 },
      { tag: "work/alpha", count: 2 },
      { tag: "work/beta", count: 1 },
    ]);
    expect(tree.map((n) => [n.tag, n.count, n.total])).toEqual([
      ["home", 1, 1],
      ["work", 1, 4],
    ]);
    expect(tree[1]!.children.map((n) => n.tag)).toEqual(["work/alpha", "work/beta"]);
  });

  it("builds link text for mentions", () => {
    expect(linkTextFor("A/Project Alpha.md", "Project Alpha")).toBe("[[Project Alpha]]");
    expect(linkTextFor("Project Alpha.md", "project alpha")).toBe(
      "[[Project Alpha|project alpha]]",
    );
  });
});

describe("SearchPanel", () => {
  it("shows debounced results with highlighted snippets and opens them", async () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "late" },
    });
    const list = await screen.findByRole("list", { name: "Search results" });
    await waitFor(() => expect(within(list).getAllByRole("button")).toHaveLength(1));
    expect(list.querySelector("mark")?.textContent).toBe("late");
    expect(screen.getByText(/^1 result\b/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button"));
    expect(useAppStore.getState().activePath).toBe("Notes.md");
  });

  it("reports no results", async () => {
    useAppStore.setState({ searchQuery: "zzz" });
    render(<SearchPanel />);
    expect(await screen.findByText("No results")).toBeInTheDocument();
  });
});

describe("TagsPanel", () => {
  it("lists nested tags and searches on click", async () => {
    render(<TagsPanel />);
    const work = await screen.findByRole("button", { name: "work" });
    expect(screen.queryByRole("button", { name: "alpha" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Expand work" }));
    fireEvent.click(screen.getByRole("button", { name: "alpha" }));
    expect(useAppStore.getState()).toMatchObject({
      leftPanel: "search",
      searchQuery: "tag:work/alpha",
    });
    fireEvent.click(work);
    expect(useAppStore.getState().searchQuery).toBe("tag:work");
  });
});

describe("BacklinksPanel", () => {
  it("shows linked and unlinked mentions, and links a mention", async () => {
    useAppStore.setState({ activePath: "Project Alpha.md" });
    render(<BacklinksPanel />);
    const linked = await screen.findByRole("list", { name: "Linked mentions" });
    await waitFor(() =>
      expect(within(linked).getByText("Met about [[Project Alpha]] today.")).toBeInTheDocument(),
    );
    const unlinked = screen.getByRole("list", { name: "Unlinked mentions" });
    await waitFor(() => expect(within(unlinked).getAllByRole("listitem")).toHaveLength(1));

    fireEvent.click(within(unlinked).getByRole("button", { name: "Link" }));
    await waitFor(() =>
      expect(h.b.files()["Notes.md"]).toContain("[[Project Alpha|project alpha]] is late."),
    );
    await waitFor(() => expect(within(unlinked).queryAllByRole("listitem")).toHaveLength(0));

    fireEvent.click(within(linked).getByText("Met about [[Project Alpha]] today."));
    expect(useAppStore.getState()).toMatchObject({
      activePath: "Notes.md",
      pendingTarget: { path: "Notes.md", line: 1 },
    });
  });
});

describe("LeftSidebar", () => {
  it("switches between files, search and tags", async () => {
    render(<LeftSidebar />);
    expect(screen.getByRole("tree", { name: "Vault files" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Search" }));
    expect(screen.getByRole("searchbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Tags" }));
    expect(await screen.findByRole("list", { name: "Tags" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tags" })).toHaveAttribute("aria-selected", "true");
  });
});
