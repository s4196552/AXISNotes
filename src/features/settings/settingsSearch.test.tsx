import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { Settings } from "./Settings";

// Every backend call is recorded, so the test can tell which panels loaded.
const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend, calls: [] as string[] }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy(
    {},
    {
      get: (_t, key) => {
        const fn = h.b[key as keyof MemoryBackend];
        return typeof fn === "function"
          ? (...args: unknown[]) => {
              h.calls.push(String(key));
              return (fn as (...a: unknown[]) => unknown)(...args);
            }
          : fn;
      },
    },
  );
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  h.calls.length = 0;
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
});

const search = () => screen.getByRole("searchbox", { name: "Search settings" });
const isShown = (el: Element | null) => !!el && !el.closest(".settings-search-hidden");
const fieldOf = (label: string) =>
  [...document.querySelectorAll(".settings-field")].find(
    (f) => f.querySelector(".settings-label")?.textContent === label,
  ) ?? null;

describe("search settings", () => {
  it("finds settings across sections and hides the rest", async () => {
    render(<Settings section="spelling" onClose={vi.fn()} />);
    expect(search()).toHaveFocus();
    fireEvent.change(search(), { target: { value: "font" } });
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Search results");
    await waitFor(() => expect(isShown(fieldOf("Note font"))).toBe(true));
    expect(isShown(fieldOf("Interface font"))).toBe(true);
    expect(isShown(fieldOf("Editor width"))).toBe(false);
    expect(isShown(fieldOf("Templates folder"))).toBe(false);
    // While searching no section is the current one.
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(within(nav).queryByRole("button", { current: "page" })).toBeNull();
  });

  it("matches every word, a group's label, or a whole section by name", async () => {
    render(<Settings onClose={vi.fn()} />);
    fireEvent.change(search(), { target: { value: "templates folder" } });
    await waitFor(() => expect(isShown(fieldOf("Templates folder"))).toBe(true));
    expect(isShown(fieldOf("Note font"))).toBe(false);
    // A built-in command's checkbox, found by its own name.
    fireEvent.change(search(), { target: { value: "toggle heading 3" } });
    await waitFor(() =>
      expect(isShown(screen.getByRole("checkbox", { name: "Toggle heading 3" }))).toBe(true),
    );
    expect(isShown(screen.getByRole("checkbox", { name: "Bulleted list" }))).toBe(false);
    // The section's own name shows all of it.
    fireEvent.change(search(), { target: { value: "spelling" } });
    await waitFor(() => {
      const section = document.querySelector('[data-label="Spelling"]');
      expect(isShown(section)).toBe(true);
      expect(section!.querySelectorAll(".settings-search-hidden")).toHaveLength(0);
    });
  });

  it("offers live sections as a link without loading them", async () => {
    render(<Settings onClose={vi.fn()} />);
    fireEvent.change(search(), { target: { value: "api key" } });
    const open = await screen.findByRole("button", { name: /Open AI/ });
    expect(isShown(open)).toBe(true);
    expect(isShown(screen.getByRole("button", { name: /Open Updates/ }))).toBe(false);
    expect(h.calls.filter((c) => /^(ai|clipper|updates)/.test(c))).toEqual([]);
    fireEvent.click(open);
    expect(search()).toHaveValue("");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("AI");
  });

  it("says when nothing matches", async () => {
    render(<Settings onClose={vi.fn()} />);
    fireEvent.change(search(), { target: { value: "zzqx" } });
    expect(await screen.findByText("No settings match “zzqx”.")).toBeInTheDocument();
  });

  it("clears the search with Escape before Escape closes Settings", () => {
    const onClose = vi.fn();
    render(<Settings onClose={onClose} />);
    fireEvent.change(search(), { target: { value: "font" } });
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(search()).toHaveValue("");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(search(), { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens a section from the list, leaving the search", () => {
    render(<Settings onClose={vi.fn()} />);
    fireEvent.change(search(), { target: { value: "font" } });
    fireEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(search()).toHaveValue("");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Templates");
  });
});
