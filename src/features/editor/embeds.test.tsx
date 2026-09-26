import { act, render, screen, waitFor } from "@testing-library/react";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { copyBlockLink } from "../commands/actions";
import { setActiveEditor } from "./activeEditor";
import { Editor } from "./Editor";
import { anchorCompletions, EMBED_SAVE_DELAY_MS, notePath } from "./embeds";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeAll(() => {
  (globalThis as { jest?: unknown }).jest = {
    advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms),
  };
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

const TASKS = "# Tasks\n\n- a\n- buy milk ^b1\n  - 2%\n- c\n";

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  h.b = createMemoryBackend({
    "Note.md": "Intro\n\n![[Tasks#^b1]]\n\n![[Tasks#^zz]]\n",
    "Tasks.md": TASKS,
  });
  useAppStore.setState({ activePath: "Note.md", pendingTarget: null, error: null, notice: null });
  await act(() => useAppStore.getState().refreshTree());
});
afterEach(() => vi.useRealTimers());

async function openNote(path = "Note.md") {
  const utils = render(<Editor path={path} />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  return utils;
}

function embeddedView(label: string) {
  const content = screen.getByLabelText(`Embedded ${label}`);
  return EditorView.findFromDOM(content.closest(".cm-editor") as HTMLElement)!;
}

describe("embeds", () => {
  it("shows the referenced block and writes edits back into the source note", async () => {
    await openNote();
    await waitFor(() => expect(screen.getByLabelText("Embedded Tasks#^b1")).toBeInTheDocument());
    const nested = embeddedView("Tasks#^b1");
    expect(nested.state.doc.toString()).toBe("- buy milk ^b1\n  - 2%");

    act(() => nested.dispatch({ changes: { from: "- buy milk".length, insert: " organic" } }));
    await act(() => vi.advanceTimersByTimeAsync(EMBED_SAVE_DELAY_MS + 50));
    await waitFor(() =>
      expect(h.b.files()["Tasks.md"]).toBe("# Tasks\n\n- a\n- buy milk organic ^b1\n  - 2%\n- c\n"),
    );
    // The note containing the embed is untouched.
    expect(h.b.files()["Note.md"]).toBe("Intro\n\n![[Tasks#^b1]]\n\n![[Tasks#^zz]]\n");
  });

  it("reloads instead of overwriting when the source block changed elsewhere", async () => {
    await openNote();
    await waitFor(() => expect(screen.getByLabelText("Embedded Tasks#^b1")).toBeInTheDocument());
    const nested = embeddedView("Tasks#^b1");
    await h.b.writeFile("Tasks.md", TASKS.replace("buy milk", "buy bread"));
    act(() => nested.dispatch({ changes: { from: 0, insert: "X" } }));
    await act(() => vi.advanceTimersByTimeAsync(EMBED_SAVE_DELAY_MS + 50));
    await waitFor(() => expect(nested.state.doc.toString()).toBe("- buy bread ^b1\n  - 2%"));
    expect(h.b.files()["Tasks.md"]).toContain("buy bread ^b1");
    expect(screen.getByText("changed in the source — reloaded")).toBeInTheDocument();
  });

  it("explains missing blocks and makes self-embeds read-only", async () => {
    h.b = createMemoryBackend({ "Note.md": "para ^own\n\n![[Note#^own]]\n\n![[Nope]]\n" });
    await openNote();
    await waitFor(() => expect(screen.getByLabelText("Embedded Note#^own")).toBeInTheDocument());
    expect(screen.getByLabelText("Embedded Note#^own")).toHaveAttribute("contenteditable", "false");
    expect(screen.getByText("read-only here")).toBeInTheDocument();
    expect(await screen.findByText("“Nope” doesn't exist yet.")).toBeInTheDocument();
  });

  it("reports a missing block id", async () => {
    await openNote();
    expect(await screen.findByText("Block ^zz not found.")).toBeInTheDocument();
  });
});

describe("anchor completion", () => {
  function contextFor(doc: string) {
    const state = EditorState.create({ doc, extensions: [notePath.of("Note.md")] });
    return { state, ctx: new CompletionContext(state, doc.length, false) };
  }

  it("completes headings and blocks, adding a block id to the target note", async () => {
    const headings = await anchorCompletions(contextFor("see [[Tasks#").ctx);
    expect(headings?.options.map((o) => o.label)).toEqual(["Tasks"]);

    const { state, ctx } = contextFor("see [[Tasks#^");
    const r = (await anchorCompletions(ctx))!;
    expect(r.options.map((o) => [o.label, o.detail])).toEqual([
      ["a", "new id"],
      ["buy milk", "^b1"],
      ["2%", "new id"],
      ["c", "new id"],
    ]);
    const view = new EditorView({ state });
    const option = r.options.find((o) => o.label === "c")!;
    await (option.apply as (v: EditorView, c: unknown, f: number, t: number) => Promise<void>)(
      view,
      option,
      r.from,
      state.doc.length,
    );
    const id = /- c \^([a-z0-9]+)/.exec(h.b.files()["Tasks.md"]!)![1]!;
    expect(view.state.doc.toString()).toBe(`see [[Tasks#^${id}]]`);
  });
});

describe("copy block link", () => {
  it("adds an id to the block at the cursor and copies the link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const view = new EditorView({
      state: EditorState.create({ doc: "# H\n\n- one\n- two", selection: { anchor: 12 } }),
    });
    setActiveEditor(view, "Folder/My Note.md");
    const link = await copyBlockLink();
    const id = /\^([a-z0-9]+)$/.exec(view.state.doc.toString())![1];
    expect(view.state.doc.toString()).toBe(`# H\n\n- one\n- two ^${id}`);
    expect(link).toBe(`[[My Note#^${id}]]`);
    expect(writeText).toHaveBeenCalledWith(link);
    expect(useAppStore.getState().notice).toContain("Copied");

    view.dispatch({ selection: { anchor: 1 } });
    expect(await copyBlockLink()).toBeNull(); // headings can't carry ids
    setActiveEditor(null);
  });
});
