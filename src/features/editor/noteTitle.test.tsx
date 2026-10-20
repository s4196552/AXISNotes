import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { Editor } from "./Editor";
import { requestEditorFocus } from "./focusRequest";
import { startBelowTitle, titleHeading, titleHeadingRange } from "./titleHeading";
import { countWords, wordCount } from "./wordCount";

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
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    "School/Biology.md": "# Biology\n\n## Cells\n\nThe cell.",
    "School/Chemistry.md": "Atoms.",
    "Daily/2026-10-20.md": "# Tuesday, October 20, 2026\n\n## Tasks\n",
  });
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  useAppStore.setState({
    error: null,
    activePath: "School/Biology.md",
    pendingTarget: null,
    notes: [],
    leftPanel: "files",
    searchQuery: "",
  });
  await useAppStore.getState().refreshTree();
});
afterEach(() => vi.useRealTimers());

async function open(path: string) {
  const utils = render(<Editor path={path} />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement)!;
  return { ...utils, view };
}

const stateWith = (doc: string, titles: string[], cursor = doc.length) =>
  EditorState.create({ doc, selection: { anchor: cursor }, extensions: titleHeading(titles) });

describe("hiding a heading that repeats the title", () => {
  it("covers the first line and the blank line after it", () => {
    const s = stateWith("# Biology\n\nText", ["Biology"]);
    expect(titleHeadingRange(s)).toEqual({ from: 0, to: 10 });
  });

  it("matches case and spacing loosely, and skips frontmatter", () => {
    const doc = "---\ntags: [a]\n---\n#  biology  \nText";
    const r = titleHeadingRange(stateWith(doc, ["Biology"]))!;
    expect(doc.slice(r.from, r.to)).toBe("#  biology  ");
  });

  it("leaves other headings alone", () => {
    expect(titleHeadingRange(stateWith("# Cells\n\nText", ["Biology"]))).toBeNull();
    expect(titleHeadingRange(stateWith("## Biology\n", ["Biology"]))).toBeNull();
    expect(titleHeadingRange(stateWith("Intro\n# Biology\n", ["Biology"]))).toBeNull();
  });

  it("starts the cursor below the hidden heading", () => {
    const s = stateWith("# Biology\n\nText", ["Biology"], 0);
    expect(startBelowTitle(s, 0)).toBe(11);
    expect(startBelowTitle(stateWith("Text", ["Biology"], 0), 0)).toBe(0);
  });

  it("hides the heading in the editor until the cursor reaches it", async () => {
    const { view, container } = await open("School/Biology.md");
    expect(view.state.selection.main.head).toBe(11);
    expect(container.querySelector(".cm-content")?.textContent).not.toContain("# Biology");
    act(() => view.dispatch({ selection: { anchor: 0 } }));
    expect(container.querySelector(".cm-content")?.textContent).toContain("Biology");
    expect(view.state.doc.toString()).toBe("# Biology\n\n## Cells\n\nThe cell.");
  });
});

describe("the note title", () => {
  it("renames the note when you press Enter", async () => {
    useAppStore.getState().openFile("School/Biology.md");
    await open("School/Biology.md");
    const title = screen.getByRole("textbox", { name: "Note title" });
    fireEvent.change(title, { target: { value: "Cell biology" } });
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(() => expect(h.b.files()["School/Cell biology.md"]).toBeDefined());
    expect(h.b.files()["School/Biology.md"]).toBeUndefined();
    expect(useAppStore.getState().activePath).toBe("School/Cell biology.md");
  });

  it("keeps the name and explains when the new one isn't allowed", async () => {
    await open("School/Biology.md");
    const title = screen.getByRole("textbox", { name: "Note title" });
    fireEvent.change(title, { target: { value: "a/b" } });
    fireEvent.blur(title);
    await waitFor(() => expect(title).toHaveValue("Biology"));
    expect(useAppStore.getState().error).toMatch(/can't start with/);

    fireEvent.change(title, { target: { value: "chemistry" } });
    fireEvent.blur(title);
    await waitFor(() => expect(title).toHaveValue("Biology"));
    expect(useAppStore.getState().error).toMatch(/already exists/);
    expect(h.b.files()["School/Biology.md"]).toBeDefined();
  });

  it("Escape puts the old name back", async () => {
    await open("School/Biology.md");
    const title = screen.getByRole("textbox", { name: "Note title" });
    fireEvent.change(title, { target: { value: "Something" } });
    fireEvent.keyDown(title, { key: "Escape" });
    expect(title).toHaveValue("Biology");
  });

  it("takes focus with its name selected when a new note asks for it", async () => {
    requestEditorFocus("School/Chemistry.md", "title");
    await open("School/Chemistry.md");
    const title = screen.getByRole("textbox", { name: "Note title" }) as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    expect([title.selectionStart, title.selectionEnd]).toEqual([0, "Chemistry".length]);
  });

  it("shows a daily note's date with buttons for the next and previous day", async () => {
    const { container } = await open("Daily/2026-10-20.md");
    expect(screen.getByRole("heading", { name: "Tuesday, October 20, 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Note title" })).toBeNull();
    // The template's own heading repeats the date, so it is hidden.
    expect(container.querySelector(".cm-content")?.textContent).not.toContain("October 20");
    fireEvent.click(screen.getByRole("button", { name: "Next day" }));
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Daily/2026-10-21.md"));
  });
});

describe("word count", () => {
  it("counts words, not Markdown markers or frontmatter", () => {
    expect(countWords("# Hello **world**, it's 2026 - ok")).toBe(5);
    expect(countWords("")).toBe(0);
    expect(wordCount("---\ntitle: a b c\n---\nOne two")).toBe(2);
  });

  it("shows the count with the save state", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const { view } = await open("School/Chemistry.md");
    expect(screen.getByText("1 word")).toBeInTheDocument();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: " More here" } }));
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText("3 words")).toBeInTheDocument();
    act(() => view.dispatch({ selection: { anchor: 0, head: 6 } }));
    await act(() => vi.advanceTimersByTimeAsync(250));
    expect(screen.getByText("1 of 3 words")).toBeInTheDocument();
  });
});
