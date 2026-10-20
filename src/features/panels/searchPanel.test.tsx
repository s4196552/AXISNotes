import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { HL_END, HL_START } from "../../ipc";
import { useAppStore } from "../../app/store";
import { cleanSnippet, headingAt } from "../../lib/searchText";
import { SearchPanel } from "./SearchPanel";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    "School/Biology.md":
      "# Biology\n\n## Cells\n\nThe *mitochondria* is the powerhouse of the **cell**.\n",
  });
  useAppStore.setState({
    vault: { root: "/v", name: "Vault" },
    activePath: null,
    pendingTarget: null,
    searchQuery: "",
    indexVersion: 0,
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
});

describe("readable search results", () => {
  it("removes Markdown syntax from snippets and keeps the match markers", () => {
    const hl = (s: string) => `${HL_START}${s}${HL_END}`;
    expect(cleanSnippet(`# Biology ## ${hl("Cells")} The *mitochondria* is **big**`)).toBe(
      `Biology ${hl("Cells")} The mitochondria is big`,
    );
    expect(
      cleanSnippet(`- [ ] Read [[Cells|the cell note]] and [docs](https://x.y) \`code\``),
    ).toBe("Read the cell note and docs code");
    expect(cleanSnippet("1. First\n> quoted ^abc123")).toBe("First quoted");
    expect(cleanSnippet("snake_case and #tag stay")).toBe("snake_case and #tag stay");
  });

  it("finds the heading above a position, skipping code blocks", () => {
    const body = "# A\n\ntext\n\n## B\n\n```\n# not\n```\nmore";
    expect(headingAt(body, body.indexOf("more"))).toBe("B");
    expect(headingAt(body, body.indexOf("text"))).toBe("A");
    expect(headingAt("none", 2)).toBeNull();
  });

  it("shows clean snippets with their heading, and opens at that heading", async () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "powerhouse" },
    });
    const heading = await screen.findByText(/›\s*Cells/, { selector: ".search-heading" });
    const result = heading.closest("button")!;
    expect(result).toHaveTextContent("Biology");
    expect(result).toHaveTextContent("The mitochondria is the powerhouse of the cell.");
    expect(result.textContent).not.toContain("*");
    fireEvent.click(result);
    expect(useAppStore.getState().activePath).toBe("School/Biology.md");
    expect(useAppStore.getState().pendingTarget).toMatchObject({ heading: "Cells" });
  });

  it("lists the operators under an empty box, and adds one on click", async () => {
    render(<SearchPanel />);
    const ops = screen.getByRole("list", { name: "Search operators" });
    expect(ops).toHaveTextContent("tag:school");
    fireEvent.click(screen.getByRole("button", { name: "path:Daily" }));
    expect(useAppStore.getState().searchQuery).toBe("path:Daily");
    await waitFor(() =>
      expect(screen.queryByRole("list", { name: "Search operators" })).toBeNull(),
    );
  });
});
