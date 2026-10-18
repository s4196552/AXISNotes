import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { useState } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { AvailableUpdate } from "../../ipc";
import { useAppStore } from "../../app/store";
import { Editor } from "../editor/Editor";
import { Grid } from "../grid/Grid";
import { useFileDocument } from "../files/useFileDocument";
import {
  recoveryPath,
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
/** The memory backend's vault root (vault "A" in these tests; "B" is any other). */
let ROOT: string;
/** What each file held when the installer was started (the app closes right after). */
let onDiskAtInstall: Record<string, string> | null;

beforeEach(() => {
  resetUnsavedWork();
  h.b = createMemoryBackend({
    "School/Biology.md": "# Biology",
    "Budget.axgrid": "{}",
  });
  ROOT = "/memory/Demo Vault";
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

  it("closing a note while it saves writes the rest, without a false failure", async () => {
    useAppStore.setState({ vault: { root: ROOT } as never });
    const { view, unmount } = await openNote();
    const write = h.b.writeFile;
    h.b.writeFile = (...args) => new Promise((r) => setTimeout(r, 30)).then(() => write(...args)); // a slow disk
    type(view, " one");
    const saving = saveAll(); // its write is now in flight
    type(view, " two");
    unmount();
    await act(() => saving);
    expect(await act(() => saveAll())).toEqual([]);
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology one two");
    expect(Object.keys(h.b.files()).filter((p) => p.includes("unsaved"))).toEqual([]);
  });

  it("never writes a closing note into a vault opened since it was loaded", async () => {
    useAppStore.setState({ vault: { root: ROOT } as never });
    const { view, unmount } = await openNote();
    type(view, " from A");
    // Opening another vault switches the backend first; the editor unmounts after.
    useAppStore.setState({ vault: { root: "B" } as never });
    unmount();
    expect(await act(() => saveAll())).toEqual([{ path: "School/Biology.md", reason: "failed" }]);
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology");
    expect(Object.keys(h.b.files()).filter((p) => p.includes("unsaved"))).toEqual([]);
    // Back in vault A, the changes are kept in a recovery file.
    useAppStore.setState({ vault: { root: ROOT } as never });
    expect(await act(() => saveAll())).toEqual([]);
    expect(Object.values(h.b.files())).toContain("# Biology from A");
  });

  it("pressing the install button doesn't move focus before install starts", async () => {
    await openNote();
    // A prevented mousedown leaves focus (and an embed's edit) alone until the click.
    expect(fireEvent.mouseDown(installButton())).toBe(false);
  });

  it("a closing write delayed by a save under way never lands in a vault opened meanwhile", async () => {
    useAppStore.setState({ vault: { root: ROOT } as never });
    const { view, unmount } = await openNote();
    const write = h.b.writeFile;
    h.b.writeFile = (...args) => new Promise((r) => setTimeout(r, 30)).then(() => write(...args)); // a slow disk
    type(view, " one");
    const saving = saveAll(); // its write is now in flight
    type(view, " two");
    unmount(); // its final write waits for that save
    // Another vault opens before the save finishes: the backend switches first.
    await h.b.openVault("/elsewhere/B");
    useAppStore.setState({ vault: { root: "/elsewhere/B" } as never });
    await act(() => saving);
    expect(await act(() => saveAll())).toEqual([{ path: "School/Biology.md", reason: "failed" }]);
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology one");
    // Back in the first vault, the rest is kept in a recovery file.
    await h.b.openVault(ROOT);
    useAppStore.setState({ vault: { root: ROOT } as never });
    expect(await act(() => saveAll())).toEqual([]);
    expect(Object.values(h.b.files())).toContain("# Biology one two");
  });

  it("saves the grid cell being edited when Install is clicked", async () => {
    const GRID = JSON.stringify({ version: 1, rows: 5, cols: 3, cells: { B1: "x" } });
    await h.b.writeFile("Budget.axgrid", GRID);
    render(
      <>
        <Grid path="Budget.axgrid" />
        <UpdateBanner />
      </>,
    );
    const cell = () => document.querySelector('[data-addr="A1"]') as HTMLElement;
    await waitFor(() => expect(document.querySelector('[data-addr="B1"]')).toHaveTextContent("x"));
    fireEvent.mouseDown(cell());
    fireEvent.keyDown(screen.getByRole("grid"), { key: "4" });
    const input = screen.getByLabelText("Edit A1") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "42" } });
    // Still editing: install's blur commits the cell, and that must be what gets saved.
    fireEvent.click(installButton());
    await waitFor(() => expect(install).toHaveBeenCalled());
    const cells = (JSON.parse(onDiskAtInstall!["Budget.axgrid"]!) as { cells: object }).cells;
    expect(cells).toEqual({ A1: "42", B1: "x" });
  });

  it("saves a change marked before React has rendered it", async () => {
    const { result } = renderHook(() => {
      const [text, setText] = useState("{}");
      return { doc: useFileDocument("Budget.axgrid", () => text), setText };
    });
    await waitFor(() => expect(result.current.doc.status).toBe("saved"));
    const next = '{"cells":{"A1":"7"}}';
    // A change and an immediate save in the same tick, as when install's blur commits it.
    const saved = await act(() => {
      result.current.setText(next);
      result.current.doc.markDirty(() => next);
      return saveAll();
    });
    expect(saved).toEqual([]);
    expect(h.b.files()["Budget.axgrid"]).toBe(next);
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
  const inVault = (root: string | null) =>
    useAppStore.setState({ vault: root === null ? null : ({ root } as never) });
  const recovered = () =>
    Object.entries(h.b.files()).filter(([path]) => path.includes("(unsaved "));
  const fail = async () => {
    throw { code: "Io", message: "disk full" };
  };

  it("names recovery files after the original, with the time", () => {
    const at = new Date(2026, 9, 10, 14, 3, 7);
    expect(recoveryPath("School/Biology.md", at)).toBe(
      "School/Biology (unsaved 2026-10-10 14-03-07).md",
    );
    expect(recoveryPath("Budget.axgrid", at, 2)).toBe(
      "Budget (unsaved 2026-10-10 14-03-07 2).axgrid",
    );
    expect(recoveryPath("v1.0/README", at)).toBe("v1.0/README (unsaved 2026-10-10 14-03-07)");
  });

  it("keeps a closed document's changes in a new file when its final write fails", async () => {
    inVault(ROOT);
    trackClosingWrite("School/Biology.md", "# Biology\n\nlast words", ROOT, fail);
    expect(await saveAll()).toEqual([]);
    const [path, content] = recovered()[0]!;
    expect(path).toMatch(/^School\/Biology \(unsaved .+\)\.md$/);
    expect(content).toBe("# Biology\n\nlast words");
    expect(h.b.files()["School/Biology.md"]).toBe("# Biology"); // never overwritten
    expect(useAppStore.getState().error).toContain("your last changes were saved as");
  });

  it("keeps each failed write on its own, even for the same file", async () => {
    inVault(ROOT);
    trackClosingWrite("Tasks.md", "block A", ROOT, fail);
    trackClosingWrite("Tasks.md", "block B", ROOT, fail);
    expect(await saveAll()).toEqual([]);
    expect(
      recovered()
        .map(([, c]) => c)
        .sort(),
    ).toEqual(["block A", "block B"]);
  });

  it("refuses until the changes can be kept somewhere, trying again each time", async () => {
    inVault(ROOT);
    const create = h.b.createFile;
    h.b.createFile = fail as never;
    trackClosingWrite("School/Biology.md", "last words", ROOT, fail);
    expect(await saveAll()).toEqual([{ path: "School/Biology.md", reason: "failed" }]);
    expect(await saveAll()).toEqual([{ path: "School/Biology.md", reason: "failed" }]);
    h.b.createFile = create;
    expect(await saveAll()).toEqual([]);
    expect(recovered()).toHaveLength(1);
  });

  it("never writes a closed document's changes into another vault", async () => {
    inVault(ROOT);
    const create = h.b.createFile;
    h.b.createFile = fail as never;
    trackClosingWrite("School/Biology.md", "last words", ROOT, fail);
    await Promise.resolve();
    h.b.createFile = create;
    inVault("B");
    expect(await saveAll()).toEqual([{ path: "School/Biology.md", reason: "failed" }]);
    expect(recovered()).toHaveLength(0);
    inVault(ROOT);
    expect(await saveAll()).toEqual([]);
    expect(recovered()).toHaveLength(1);
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
