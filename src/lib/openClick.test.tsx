import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../ipc/memoryBackend";
import { useAppStore } from "../app/store";
import { initialTabs } from "../app/tabs";
import { SearchPanel } from "../features/panels/SearchPanel";
import { InlineText } from "../features/tasks/InlineText";
import { openOnClick } from "./openClick";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend, followLink: vi.fn() }));
vi.mock("../ipc", async (orig) => {
  const mod = await orig<typeof import("../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});
vi.mock("../features/commands/actions", async (orig) => ({
  ...(await orig<typeof import("../features/commands/actions")>()),
  followLink: h.followLink,
}));

beforeEach(async () => {
  h.b = createMemoryBackend({ "School/Bio.md": "# Bio\nThe powerhouse.\n" });
  useAppStore.setState({
    vault: { root: "/v", name: "Vault" },
    activePath: null,
    tabs: initialTabs(),
    searchQuery: "",
    structureVersion: 0,
    contentVersions: {},
    error: null,
  });
  await act(() => useAppStore.getState().refreshTree());
  h.followLink.mockReset();
});

const tabCount = () => useAppStore.getState().tabs.list.length;

describe("opening in a new tab", () => {
  it("opens here on a click, and in a new tab on Ctrl/Cmd+click or a middle-click", () => {
    const open = vi.fn();
    render(<button {...openOnClick(open)}>Bio</button>);
    const b = screen.getByRole("button", { name: "Bio" });
    fireEvent.click(b);
    fireEvent.click(b, { ctrlKey: true });
    fireEvent.click(b, { metaKey: true });
    // A press of the wheel doesn't start auto-scroll; its click opens a new tab.
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 1 });
    b.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    fireEvent(b, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    // The right button's auxclick does nothing.
    fireEvent(b, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 2 }));
    expect(open.mock.calls).toEqual([[false], [true], [true], [true]]);
  });

  it("middle-click on a search result opens it in a new tab", async () => {
    render(<SearchPanel />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search notes" }), {
      target: { value: "powerhouse" },
    });
    const result = (
      await screen.findByText("Bio", { selector: ".panel-item-title *, .panel-item-title" })
    ).closest("button")!;
    const before = tabCount();
    fireEvent(result, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(tabCount()).toBe(before + 1);
    expect(useAppStore.getState().activePath).toBe("School/Bio.md");
  });

  it("middle-click on a [[link]] in rendered text opens it in a new tab", () => {
    render(<InlineText text="See [[Bio]]" from="Tasks.md" />);
    const link = screen.getByRole("button", { name: "Bio" });
    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }));
    expect(h.followLink).toHaveBeenCalledWith("Bio", "Tasks.md", { newTab: true });
  });
});
