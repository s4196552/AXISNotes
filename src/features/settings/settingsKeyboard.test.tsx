import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { Settings } from "./Settings";

// T-273: arrow keys move through Settings.

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
});

const nav = () => within(screen.getByRole("navigation", { name: "Settings sections" }));
const pageButton = (name: string) => nav().getByRole("button", { name });
const heading = () => screen.getByRole("heading", { level: 2 });

describe("arrow keys in Settings (T-273)", () => {
  it("move from the search box through the pages, opening each one", () => {
    render(<Settings section="spelling" onClose={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(pageButton("Spelling")).toHaveFocus();

    fireEvent.keyDown(pageButton("Spelling"), { key: "ArrowDown" });
    expect(pageButton("Home & daily notes")).toHaveFocus();
    expect(pageButton("Home & daily notes")).toHaveAttribute("aria-current", "page");
    expect(heading()).toHaveTextContent("Home & daily notes");

    fireEvent.keyDown(pageButton("Home & daily notes"), { key: "ArrowUp" });
    expect(pageButton("Spelling")).toHaveFocus();
    expect(heading()).toHaveTextContent("Spelling");
  });

  it("go to the first or last page with Home and End, and stop at the ends", () => {
    render(<Settings section="spelling" onClose={vi.fn()} />);
    fireEvent.keyDown(pageButton("Spelling"), { key: "End" });
    expect(pageButton("About")).toHaveFocus();
    expect(heading()).toHaveTextContent("About");
    fireEvent.keyDown(pageButton("About"), { key: "ArrowDown" });
    expect(pageButton("About")).toHaveFocus();

    fireEvent.keyDown(pageButton("About"), { key: "Home" });
    expect(pageButton("Appearance")).toHaveFocus();
    expect(heading()).toHaveTextContent("Appearance");
    // Up from the first page returns to the search box.
    fireEvent.keyDown(pageButton("Appearance"), { key: "ArrowUp" });
    expect(screen.getByRole("searchbox", { name: "Search settings" })).toHaveFocus();
  });

  it("move right into the page's tabs, which then take Left, Right, Home and End", () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    fireEvent.keyDown(pageButton("Appearance"), { key: "ArrowRight" });
    // Right lands on the open tab (Theme & layout, after Styles since T-277).
    const open = screen.getByRole("tab", { name: "Theme & layout" });
    expect(open).toHaveFocus();

    fireEvent.keyDown(open, { key: "End" });
    const last = screen.getByRole("tab", { name: "Icon & image packs" });
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(last, { key: "Home" });
    const first = screen.getByRole("tab", { name: "Styles" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Theme & layout" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("leave a search's results open until a page is chosen", () => {
    render(<Settings section="spelling" onClose={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "Search settings" });
    fireEvent.change(search, { target: { value: "font" } });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(pageButton("Appearance")).toHaveFocus();
    expect(heading()).toHaveTextContent("Search results");
    fireEvent.keyDown(pageButton("Appearance"), { key: "ArrowDown" });
    expect(heading()).toHaveTextContent("Spelling");
    expect(search).toHaveValue("");
  });
});
