import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { Editor } from "../editor/Editor";
import { CLOSE_AGAIN_MS, guardWindowClose, resetCloseGuard } from "./closeGuard";
import { useFileDocument } from "./useFileDocument";
import { resetUnsavedWork, saveAll } from "./unsavedWork";

// T-074: closing the window, or switching away from a note with a conflict, never loses
// an edit.

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const ROOT = "/memory/Demo Vault";

beforeAll(() => {
  // jsdom has no layout; CodeMirror measures text with these.
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

let stopGuard: () => void;
beforeEach(() => {
  resetUnsavedWork();
  resetCloseGuard();
  h.b = createMemoryBackend({ "School/Biology.md": "# Biology", "Budget.axgrid": "{}" });
  useAppStore.setState({
    vault: { root: ROOT, name: "Demo Vault" },
    error: null,
    pendingTarget: null,
    notes: [],
  });
  stopGuard = guardWindowClose();
});
afterEach(() => {
  stopGuard();
  document.body.removeAttribute("inert");
  vi.restoreAllMocks();
});

async function openNote(path = "School/Biology.md") {
  const utils = render(<Editor path={path} />);
  await waitFor(() =>
    expect(utils.container.querySelector(".editor-status")).toHaveTextContent("Saved"),
  );
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement)!;
  return { ...utils, view };
}

const type = (view: EditorView, text: string) =>
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }));

/** Click the window's close button and let the guard finish. */
async function clickClose() {
  await act(async () => {
    h.b.requestClose();
    await new Promise((r) => setTimeout(r, 20));
  });
}

const recovered = () => Object.entries(h.b.files()).filter(([path]) => path.includes("(unsaved "));

describe("closing the window", () => {
  it("saves an edit still waiting for autosave, then closes", async () => {
    const { view } = await openNote();
    type(view, "\n\nmitosis");
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology");
    await clickClose();
    await waitFor(() => expect(h.b.windowClosed()).toBe(true));
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology\n\nmitosis");
  });

  it("stays open over an unresolved conflict, naming the note; closing again quits", async () => {
    const { view } = await openNote();
    type(view, "\n\nmine");
    act(() => h.b.externalWrite("School/Biology.md", "theirs"));
    await screen.findByText("This note changed on disk.");

    await clickClose();
    expect(h.b.windowClosed()).toBe(false);
    expect(useAppStore.getState().error).toBe(
      "Not closed, so no edits are lost. Unsaved changes in “School/Biology” (changed on disk). " +
        "Resolve it, or close again to quit without saving it.",
    );
    expect(document.body).not.toHaveAttribute("inert");
    expect(view.state.doc.toString()).toBe("# Biology\n\nmine");

    // The user chose to quit anyway.
    await clickClose();
    expect(h.b.windowClosed()).toBe(true);
  });

  it("still saves everything it can when closing again soon after a refusal", async () => {
    const { view } = await openNote();
    type(view, "\n\nmine");
    act(() => h.b.externalWrite("School/Biology.md", "theirs"));
    await screen.findByText("This note changed on disk.");
    await clickClose();
    // The user resolves it and keeps typing, then closes again right away.
    act(() => screen.getByRole("button", { name: "Keep my version" }).click());
    await waitFor(() => expect(h.b.files()["School/Biology.md"]).toBe("# Biology\n\nmine"));
    type(view, " more");
    await clickClose();
    expect(h.b.windowClosed()).toBe(true);
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology\n\nmine more");
  });

  it("asks again once the moment has passed", async () => {
    const { view } = await openNote();
    type(view, "\n\nmine");
    act(() => h.b.externalWrite("School/Biology.md", "theirs"));
    await screen.findByText("This note changed on disk.");
    const now = Date.now();
    await clickClose();
    vi.spyOn(Date, "now").mockReturnValue(now + CLOSE_AGAIN_MS + 1000);
    await clickClose();
    expect(h.b.windowClosed()).toBe(false);
  });

  it("closes straight away with nothing open", async () => {
    await clickClose();
    expect(h.b.windowClosed()).toBe(true);
  });

  it("shows why if the window can't close, and unfreezes it", async () => {
    h.b.closeWindow = async () => {
      throw { code: "Io", message: "not allowed" };
    };
    await clickClose();
    expect(useAppStore.getState().error).toBe("Couldn’t close the window: not allowed");
    expect(document.body).not.toHaveAttribute("inert");
  });
});

describe("switching away from a note with a conflict", () => {
  it("keeps the editor's version in a recovery file, and leaves the other alone", async () => {
    const { view, unmount } = await openNote();
    type(view, "\n\nmine");
    act(() => h.b.externalWrite("School/Biology.md", "theirs"));
    await screen.findByText("This note changed on disk.");
    unmount();
    expect(await act(() => saveAll())).toEqual([]);
    expect(h.b.files()["School/Biology.md"]).toBe("theirs");
    const [path, content] = recovered()[0]!;
    expect(path).toMatch(/^School\/Biology \(unsaved .+\)\.md$/);
    expect(content).toBe("# Biology\n\nmine");
    expect(useAppStore.getState().error).toContain("couldn’t be saved (it changed on disk)");
  });

  it("keeps the editor's version of a note moved or deleted elsewhere", async () => {
    const { view, unmount } = await openNote();
    type(view, "\n\nmine");
    act(() => h.b.externalRemove("School/Biology.md"));
    await screen.findByText("This note was moved or deleted.");
    unmount();
    expect(await act(() => saveAll())).toEqual([]);
    expect(h.b.files()["School/Biology.md"]).toBeUndefined(); // not brought back
    expect(recovered().map(([, c]) => c)).toEqual(["# Biology\n\nmine"]);
  });

  it("does the same for a grid or canvas", async () => {
    let content = "{}";
    const { result, unmount } = renderHook(() => useFileDocument("Budget.axgrid", () => content));
    await waitFor(() => expect(result.current.status).toBe("saved"));
    content = '{"cells":{"A1":"1"}}';
    act(() => result.current.markDirty());
    act(() => h.b.externalWrite("Budget.axgrid", '{"cells":{"B1":"2"}}'));
    await waitFor(() => expect(result.current.banner).toBe("conflict"));
    unmount();
    expect(await act(() => saveAll())).toEqual([]);
    expect(h.b.files()["Budget.axgrid"]).toBe('{"cells":{"B1":"2"}}');
    expect(recovered().map(([, c]) => c)).toEqual(['{"cells":{"A1":"1"}}']);
  });
});
