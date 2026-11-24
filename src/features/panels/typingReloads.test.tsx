import { act, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { AUTOSAVE_DELAY_MS, Editor } from "../editor/Editor";
import { LocalGraph } from "../graph/GraphView";
import { BacklinksPanel } from "./BacklinksPanel";
import { OutlinePanel } from "./OutlinePanel";
import { SearchPanel } from "./SearchPanel";
import { TagsPanel } from "./TagsPanel";

// T-279: autosave used to reload every panel on each save. Typing plain text must not
// re-query the graph, backlinks, mentions, search or tags; a new link or tag must.

const h = vi.hoisted(() => ({
  b: null as unknown as MemoryBackend,
  calls: {} as Record<string, number>,
}));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy(
    {},
    {
      get: (_t, key) => {
        const value = h.b[key as keyof MemoryBackend];
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          h.calls[key as string] = (h.calls[key as string] ?? 0) + 1;
          return (value as (...a: unknown[]) => unknown).apply(h.b, args);
        };
      },
    },
  );
  return { ...mod, backend };
});
// No WebGL in jsdom; the panel's data loading is what's counted, not its drawing.
vi.mock("../graph/graphLibs", () => ({ loadGraphLibs: () => new Promise(() => {}) }));

beforeAll(() => {
  (globalThis as { jest?: unknown }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  };
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  h.b = createMemoryBackend({
    "Note.md": "# Title\n\nHello world #start\n",
    "Other.md": "See [[Note]]. Hello again.\n",
  });
  h.calls = {};
  useAppStore.setState({
    vault: { root: "/v", name: "Vault" },
    error: null,
    pendingTarget: null,
    notes: [],
    leftPanel: "files",
    searchQuery: "Hello",
    structureVersion: 0,
    contentVersions: {},
  });
  await act(() => useAppStore.getState().refreshTree());
  // After the vault and its files: both restore the vault's own tabs, which clears this.
  useAppStore.setState({ activePath: "Note.md" });
});
afterEach(() => vi.useRealTimers());

const WATCHED = ["graph", "backlinks", "unlinkedMentions", "search", "listTags", "listNotes"];
const watched = () => Object.fromEntries(WATCHED.map((k) => [k, h.calls[k] ?? 0]));

async function mount() {
  const utils = render(
    <>
      <Editor path="Note.md" />
      <BacklinksPanel />
      <OutlinePanel path="Note.md" />
      <TagsPanel />
      <SearchPanel />
      <LocalGraph />
    </>,
  );
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  await waitFor(() => expect(watched()).toMatchObject({ graph: 1, search: 1, listTags: 1 }));
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement)!;
  return { ...utils, view };
}

async function typeAndSave(view: EditorView, text: string) {
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }));
  await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS + 50));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
}

describe("typing in a note (T-279)", () => {
  it("reloads panels only when links, tags or headings change", async () => {
    const { view } = await mount();
    const before = watched();
    const writes = h.calls.writeFile ?? 0;

    // Several autosaves of plain text, a word at a time.
    for (const word of ["Some", " more", " plain", " text."]) await typeAndSave(view, word);
    expect(h.calls.writeFile! - writes).toBeGreaterThanOrEqual(4);
    expect(watched()).toEqual(before);
    // The outline follows its own note's saves (a line above a heading moves it).
    expect(screen.getByRole("list", { name: "Outline" })).toHaveTextContent("Title");

    // A new link is structure: the index-backed panels reload once.
    await typeAndSave(view, " [[Other]]");
    await waitFor(() =>
      expect(watched()).toEqual({
        graph: before.graph! + 1,
        backlinks: before.backlinks! + 1,
        unlinkedMentions: before.unlinkedMentions! + 1,
        search: before.search! + 1,
        listTags: before.listTags! + 1,
        listNotes: before.listNotes! + 1,
      }),
    );

    // And so are a new tag and a new heading.
    const afterLink = watched();
    await typeAndSave(view, " #fresh");
    await waitFor(() => expect(watched().listTags).toBe(afterLink.listTags! + 1));
    await typeAndSave(view, "\n## Section\n");
    await waitFor(() => expect(watched().graph).toBe(afterLink.graph! + 2));
    await waitFor(() =>
      expect(screen.getByRole("list", { name: "Outline" })).toHaveTextContent("Section"),
    );
  });

  it("keeps the notes list when it hasn't changed, so editors don't restyle links", async () => {
    const notes = useAppStore.getState().notes;
    expect(notes.length).toBe(2);
    await act(async () => {
      useAppStore.getState().bumpIndex();
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(h.calls.listNotes).toBeGreaterThanOrEqual(2));
    expect(useAppStore.getState().notes).toBe(notes);

    await act(() => h.b.writeFile("Third.md", "# Third\n"));
    await act(async () => {
      useAppStore.getState().bumpIndex();
      await vi.advanceTimersByTimeAsync(0);
    });
    await waitFor(() => expect(useAppStore.getState().notes).not.toBe(notes));
    expect(useAppStore.getState().notes.map((n) => n.path)).toContain("Third.md");
  });
});
