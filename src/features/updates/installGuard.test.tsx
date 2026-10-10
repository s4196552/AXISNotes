import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { AvailableUpdate } from "../../ipc";
import { useAppStore } from "../../app/store";
import { Editor } from "../editor/Editor";
import { useFileDocument } from "../files/useFileDocument";
import {
  markSaved,
  registerDocument,
  resetUnsavedWork,
  saveAll,
  trackClosingWrite,
} from "../files/unsavedWork";
import { UpdateBanner } from "./UpdateBanner";
import { useUpdates } from "./updates";

// T-073: installing an update closes the app, so it must never lose an edit.

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const UPDATE: AvailableUpdate = {
  version: "0.4.0",
  notes: "",
  pubDate: null,
  file: "AXISNotes_0.4.0_x64-setup.exe",
};

beforeAll(() => {
  // jsdom has no layout; CodeMirror measures text with these.
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

let install: ReturnType<typeof vi.fn>;
/** What each file held when the installer was started (the app closes right after). */
let onDiskAtInstall: Record<string, string> | null;

beforeEach(() => {
  resetUnsavedWork();
  h.b = createMemoryBackend({
    "School/Biology.md": "# Biology",
    "Budget.axgrid": "{}",
  });
  onDiskAtInstall = null;
  install = vi.fn(async () => {
    onDiskAtInstall = h.b.files();
  });
  h.b.updatesInstall = install as MemoryBackend["updatesInstall"];
  useAppStore.setState({ error: null, pendingTarget: null, notes: [] });
  useUpdates.setState({
    available: UPDATE,
    dismissed: false,
    checking: false,
    checked: true,
    installing: false,
    error: null,
  });
});
afterEach(() => document.body.removeAttribute("inert"));

async function openNote(path = "School/Biology.md") {
  const utils = render(
    <>
      <Editor path={path} />
      <UpdateBanner />
    </>,
  );
  await waitFor(() =>
    expect(utils.container.querySelector(".editor-status")).toHaveTextContent("Saved"),
  );
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement)!;
  return { ...utils, view };
}

const type = (view: EditorView, text: string) =>
  act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: text } }));

const installButton = () => screen.getByRole("button", { name: "Install and restart" });

describe("installing an update", () => {
  it("saves an edit still waiting for autosave before the installer starts", async () => {
    const { view } = await openNote();
    type(view, "\n\nmitosis");
    // Clicked inside the autosave delay: nothing is on disk yet.
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology");
    fireEvent.click(installButton());
    await waitFor(() => expect(install).toHaveBeenCalledWith("0.4.0"));
    expect(onDiskAtInstall?.["School/Biology.md"]).toBe("# Biology\n\nmitosis");
  });

  it("freezes the window while it saves and installs, and unfreezes after an error", async () => {
    h.b.updatesInstall = async () => {
      throw { code: "Io", message: "doesn’t match the checksum" };
    };
    await openNote();
    fireEvent.click(installButton());
    expect(document.body).toHaveAttribute("inert");
    expect(await screen.findByRole("alert")).toHaveTextContent("checksum");
    expect(document.body).not.toHaveAttribute("inert");
  });

  it("doesn't install while a note has an unresolved conflict, and names it", async () => {
    const { view } = await openNote();
    type(view, "\n\nmine");
    act(() => h.b.externalWrite("School/Biology.md", "theirs"));
    await screen.findByText("This note changed on disk.");

    fireEvent.click(installButton());
    const banner = screen.getByRole("region", { name: "Update available" });
    await waitFor(() =>
      expect(banner.querySelector("[role=alert]")).toHaveTextContent(
        "Unsaved changes in “School/Biology” (changed on disk)",
      ),
    );
    expect(install).not.toHaveBeenCalled();
    expect(useUpdates.getState().installing).toBe(false);
    expect(document.body).not.toHaveAttribute("inert");
    // Nothing was overwritten either way: the editor still has the user's version.
    expect(view.state.doc.toString()).toBe("# Biology\n\nmine");
    expect(h.b.files()["School/Biology.md"]).toBe("theirs");

    // Once resolved, installing goes ahead with the kept version on disk.
    fireEvent.click(screen.getByRole("button", { name: "Keep my version" }));
    await waitFor(() => expect(h.b.files()["School/Biology.md"]).toBe("# Biology\n\nmine"));
    fireEvent.click(installButton());
    await waitFor(() => expect(install).toHaveBeenCalled());
  });

  it("doesn't install when a save fails", async () => {
    const { view } = await openNote();
    h.b.writeFile = async () => {
      throw { code: "Io", message: "disk full" };
    };
    type(view, "!");
    fireEvent.click(installButton());
    await waitFor(() =>
      expect(useUpdates.getState().error).toContain("“School/Biology” (couldn’t be saved)"),
    );
    expect(install).not.toHaveBeenCalled();
  });

  it("waits for the final write of a note that was just closed", async () => {
    const { view, unmount } = await openNote();
    const write = h.b.writeFile;
    h.b.writeFile = (...args) => new Promise((r) => setTimeout(r, 50)).then(() => write(...args)); // a slow disk
    type(view, " closing");
    unmount(); // e.g. switched to another note right before installing
    await act(() => useUpdates.getState().install());
    expect(onDiskAtInstall?.["School/Biology.md"]).toBe("# Biology closing");
  });

  it("doesn't report a false conflict when saves queue behind a write in flight", async () => {
    const { view } = await openNote();
    const write = h.b.writeFile;
    h.b.writeFile = (...args) => new Promise((r) => setTimeout(r, 30)).then(() => write(...args)); // a slow disk
    type(view, " one");
    const first = saveAll(); // its write is now in flight
    type(view, " two");
    // e.g. the blur save and install's flush, both waiting for that write
    const [a, b, c] = await act(() => Promise.all([first, saveAll(), saveAll()]));
    expect([...a, ...b, ...c]).toEqual([]);
    expect(screen.queryByText("This note changed on disk.")).toBeNull();
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology one two");
  });

  it("saves a grid or canvas waiting for autosave", async () => {
    let content = "{}";
    const { result } = renderHook(() => useFileDocument("Budget.axgrid", () => content));
    await waitFor(() => expect(result.current.status).toBe("saved"));
    content = '{"cells":{"A1":"1"}}';
    act(() => result.current.markDirty());
    await act(() => useUpdates.getState().install());
    expect(onDiskAtInstall?.["Budget.axgrid"]).toBe('{"cells":{"A1":"1"}}');
  });
});

describe("saveAll", () => {
  const failing = (state: { works: boolean }) =>
    vi.fn(async () => {
      if (!state.works) throw new Error("disk full");
    });
  const inVault = (root: string | null) =>
    useAppStore.setState({ vault: root === null ? null : ({ root } as never) });

  it("keeps a failed final write, tries it again, and reports it once per file", async () => {
    inVault("A");
    const disk = { works: false };
    const write = failing(disk);
    await trackClosingWrite("a.md", "file", write).catch(() => {});
    await trackClosingWrite("b.md", "file", async () => {});
    // Failed before installing started: still reported, and every attempt is refused.
    expect(await saveAll()).toEqual([{ path: "a.md", reason: "failed" }]);
    expect(await saveAll()).toEqual([{ path: "a.md", reason: "failed" }]);
    // Once a retry gets through, it's settled.
    disk.works = true;
    expect(await saveAll()).toEqual([]);
    expect(write).toHaveBeenCalledTimes(4);
  });

  it("tracks each failed write to a file on its own", async () => {
    inVault("A");
    const blockA = { works: false };
    const blockB = { works: false };
    await trackClosingWrite("Tasks.md", "part", failing(blockA)).catch(() => {});
    await trackClosingWrite("Tasks.md", "part", failing(blockB)).catch(() => {});
    blockB.works = true;
    // B getting through doesn't settle A, and a whole-file save doesn't settle a block.
    markSaved("Tasks.md");
    expect(await saveAll()).toEqual([{ path: "Tasks.md", reason: "failed" }]);
    blockA.works = true;
    expect(await saveAll()).toEqual([]);
  });

  it("forgets a failed whole-file write once that file is saved again", async () => {
    inVault("A");
    await trackClosingWrite("a.md", "file", failing({ works: false })).catch(() => {});
    markSaved("a.md"); // e.g. the note was reopened and saved
    expect(await saveAll()).toEqual([]);
  });

  it("never retries a write in another vault", async () => {
    inVault("A");
    const disk = { works: false };
    const write = failing(disk);
    await trackClosingWrite("a.md", "file", write).catch(() => {});
    inVault("B");
    disk.works = true;
    markSaved("a.md"); // B's a.md is a different file
    expect(await saveAll()).toEqual([{ path: "a.md", reason: "failed" }]);
    expect(write).toHaveBeenCalledTimes(1);
    inVault("A");
    expect(await saveAll()).toEqual([]);
  });

  it("counts a flush that throws as unsaved", async () => {
    registerDocument(
      () => "Budget.axgrid",
      async () => {
        throw new Error("couldn't serialize");
      },
    );
    expect(await saveAll()).toEqual([{ path: "Budget.axgrid", reason: "failed" }]);
  });
});
