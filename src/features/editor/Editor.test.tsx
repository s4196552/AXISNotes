import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { AUTOSAVE_DELAY_MS, Editor } from "./Editor";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeAll(() => {
  // Testing Library only advances fake timers inside waitFor when it sees `jest`.
  (globalThis as { jest?: unknown }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  };
  // jsdom has no layout; CodeMirror measures text with these.
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  h.b = createMemoryBackend({ "Note.md": "# Title\n\nHello **world**" });
  useAppStore.setState({ error: null });
});
afterEach(() => vi.useRealTimers());

async function open(path = "Note.md") {
  const utils = render(<Editor path={path} />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement)!;
  return { ...utils, view };
}

const type = (view: EditorView, text: string) =>
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }));

describe("Editor", () => {
  it("loads the note and shows its title", async () => {
    const { view } = await open();
    expect(view.state.doc.toString()).toBe("# Title\n\nHello **world**");
    expect(screen.getByRole("heading", { name: "Note" })).toBeInTheDocument();
  });

  it("autosaves after the debounce, not before", async () => {
    const { view } = await open();
    type(view, "!");
    expect(screen.getByRole("status")).toHaveTextContent("Unsaved changes");
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100));
    expect(h.b.files()["Note.md"]).toBe("# Title\n\nHello **world**");
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(h.b.files()["Note.md"]).toBe("# Title\n\nHello **world**!");
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("flushes unsaved edits on unmount", async () => {
    const { view, unmount } = await open();
    type(view, " bye");
    unmount();
    await waitFor(() => expect(h.b.files()["Note.md"]).toMatch(/bye$/));
  });

  it("silently reloads external edits when there are no local edits", async () => {
    const { view } = await open();
    act(() => view.dispatch({ selection: { anchor: 5 } }));
    act(() => h.b.externalWrite("Note.md", "short"));
    await waitFor(() => expect(view.state.doc.toString()).toBe("short"));
    expect(view.state.selection.main.head).toBe(5);
    expect(screen.queryByRole("alert")).toBeNull();

    // The reload is not treated as an edit, and later saves use the new mtime.
    type(view, "!");
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 50));
    expect(h.b.files()["Note.md"]).toBe("short!");
  });

  it("asks before overwriting when the note changed on disk with local edits", async () => {
    const { view } = await open();
    type(view, " mine");
    act(() => h.b.externalWrite("Note.md", "theirs"));
    expect(await screen.findByRole("alert")).toHaveTextContent("This note changed on disk.");

    // Autosave is paused while the banner shows.
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 3));
    expect(h.b.files()["Note.md"]).toBe("theirs");

    fireEvent.click(screen.getByRole("button", { name: "Keep my version" }));
    await waitFor(() => expect(h.b.files()["Note.md"]).toMatch(/mine$/));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("can discard local edits and reload from disk", async () => {
    const { view } = await open();
    type(view, " mine");
    act(() => h.b.externalWrite("Note.md", "theirs"));
    fireEvent.click(await screen.findByRole("button", { name: "Reload from disk" }));
    await waitFor(() => expect(view.state.doc.toString()).toBe("theirs"));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("detects a conflict when saving over a file changed without an event", async () => {
    const { view } = await open();
    await h.b.writeFile("Note.md", "changed elsewhere"); // bumps mtime, no watcher event
    type(view, "!");
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 50));
    expect(await screen.findByRole("alert")).toHaveTextContent("changed on disk");
    expect(h.b.files()["Note.md"]).toBe("changed elsewhere");
  });

  it("pauses when the note is deleted elsewhere and can save it back", async () => {
    const { view } = await open();
    act(() => h.b.externalRemove("Note.md"));
    expect(await screen.findByRole("alert")).toHaveTextContent("moved or deleted");
    type(view, "!");
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2));
    expect(h.b.files()).toEqual({});

    fireEvent.click(screen.getByRole("button", { name: "Save here anyway" }));
    await waitFor(() => expect(h.b.files()["Note.md"]).toMatch(/!$/));
  });

  it("reports a missing note as an error", async () => {
    render(<Editor path="Missing.md" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Save failed"));
    expect(useAppStore.getState().error).toMatch(/not found/);
  });
});
