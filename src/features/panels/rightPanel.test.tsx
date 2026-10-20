import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { listHeadings } from "../../lib/headings";
import { RightSidebar } from "./Sidebars";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  // The local graph needs WebGL; keep it folded so it doesn't load here.
  localStorage.clear();
  localStorage.setItem("axisnotes:right-panel-sections", JSON.stringify({ graph: false }));
  h.b = createMemoryBackend({
    "Plan.md": "---\ntags: [a]\n---\n# Plan\n\n## Goals\n\n```\n# code\n```\n\n### Risks\n",
    "Other.md": "See [[Plan]] and [[Budget.axgrid]].",
    "Budget.axgrid": JSON.stringify({ version: 1, rows: 2, cols: 2, cells: {} }),
  });
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG), loaded: true });
  useAppStore.setState({
    vault: { root: "/v", name: "V" },
    activePath: null,
    pendingTarget: null,
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
});

const section = (name: string) => screen.queryByRole("region", { name });

describe("headings", () => {
  it("lists levels and lines, skipping frontmatter and code", () => {
    expect(listHeadings("---\nt: 1\n---\n# A\n```\n# no\n```\n## B")).toEqual([
      { level: 1, text: "A", line: 4 },
      { level: 2, text: "B", line: 8 },
    ]);
  });
});

describe("right panel", () => {
  it("shows a note's outline, folded graph and links, and jumps to a heading", async () => {
    act(() => useAppStore.getState().openFile("Plan.md"));
    render(<RightSidebar />);
    expect(section("Calendar section")).not.toBeNull();
    const outline = await screen.findByRole("list", { name: "Outline" });
    expect(
      within(outline)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Plan", "Goals", "Risks"]);
    expect(screen.getByRole("button", { name: "Local graph" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(await screen.findByText("Linked mentions")).toBeInTheDocument();
    fireEvent.click(within(outline).getByRole("button", { name: "Risks" }));
    expect(useAppStore.getState().pendingTarget).toMatchObject({ path: "Plan.md", line: 12 });
  });

  it("folds a section and remembers it", async () => {
    act(() => useAppStore.getState().openFile("Plan.md"));
    const { unmount } = render(<RightSidebar />);
    await screen.findByRole("list", { name: "Outline" });
    fireEvent.click(screen.getByRole("button", { name: "Outline" }));
    expect(screen.queryByRole("list", { name: "Outline" })).toBeNull();
    unmount();
    render(<RightSidebar />);
    expect(screen.getByRole("button", { name: "Outline" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("gives a grid its links only", async () => {
    act(() => useAppStore.getState().openFile("Budget.axgrid"));
    render(<RightSidebar />);
    expect(section("Outline section")).toBeNull();
    expect(screen.queryByRole("button", { name: "Local graph" })).toBeNull();
    expect(await screen.findByText("Linked mentions")).toBeInTheDocument();
  });

  it("drops the calendar on Home and the note panels on views", async () => {
    act(() => useAppStore.getState().openDashboard(""));
    const { unmount } = render(<RightSidebar />);
    expect(section("Calendar section")).toBeNull();
    expect(screen.getByText(/Open a note to see its outline and links/)).toBeInTheDocument();
    unmount();

    act(() => useAppStore.getState().openFile("Plan.md"));
    act(() => useAppStore.getState().setMainView("tasks"));
    render(<RightSidebar />);
    await waitFor(() => expect(section("Calendar section")).not.toBeNull());
    expect(section("Outline section")).toBeNull();
    expect(screen.queryByText("Linked mentions")).toBeNull();
  });
});
