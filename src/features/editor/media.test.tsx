import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { undo } from "@codemirror/commands";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { resetUnsavedWork, saveAll } from "../files/unsavedWork";
import { setActiveEditor } from "./activeEditor";
import { Editor } from "./Editor";
import { pastedMedia } from "./media";
import { SLASH_COMMANDS } from "./quickCommands";
import { PATH_MIME } from "../../lib/fileKinds";
import { Settings } from "../settings/Settings";
import { readImageLayout } from "../../lib/imageLayout";
import { embeds } from "./embeds";
import { relocateEmbed } from "./imageEditor";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

async function setup(files: Record<string, string>, folder = "Attachments") {
  resetUnsavedWork();
  h.b = createMemoryBackend(files);
  h.b.fileUrl = (p: string) => `asset://vault/${p}`;
  useConfig.setState({
    config: { ...structuredClone(DEFAULT_CONFIG), attachments: { folder } },
  });
  const vault = await h.b.currentVault();
  useAppStore.setState({ vault, activePath: null, error: null, notice: null });
  await act(() => useAppStore.getState().refreshTree());
}

async function open(path: string) {
  render(<Editor path={path} />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  return EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
}

const text = (view: EditorView) => view.state.doc.toString();
afterEach(() => setActiveEditor(null));

// One note per case: jsdom has no layout, so CodeMirror renders only the first screenful.
describe("embedded images, video and audio", () => {
  beforeEach(() =>
    setup({
      "School/Video.md": "Intro\n\n![[cell.mp4|400]]\n\n![[lecture.mp3]]\n\n![[gone.webm]]\n",
      "School/Images.md":
        "Intro\n\n![Cell|300](../pics/cell%20wall.png)\n\n![Logo](https://example.com/logo.svg)\n\n![](Other.md)\n",
      "School/Players.md":
        "Intro\n\n![](https://youtu.be/dQw4w9WgXcQ?t=1m30s)\n\n![](https://vimeo.com/76979871)\n",
      "School/cell.mp4": "",
      "School/lecture.mp3": "",
      "pics/cell wall.png": "",
    }),
  );

  it("plays vault video and audio, with Obsidian's |width", async () => {
    await open("School/Video.md");
    const video = (await screen.findByTitle("cell.mp4")) as HTMLVideoElement;
    expect(video.tagName).toBe("VIDEO");
    expect(video.getAttribute("src")).toBe("asset://vault/School/cell.mp4");
    expect(video.controls).toBe(true);
    expect(video.style.width).toBe("400px");
    const audio = screen.getByTitle("lecture.mp3") as HTMLAudioElement;
    expect(audio.tagName).toBe("AUDIO");
    expect(screen.getByText("🎞 gone.webm (not found)")).toBeInTheDocument();
  });

  it("shows Markdown images by relative path, with spaces escaped, and from the web", async () => {
    await open("School/Images.md");
    const img = (await screen.findByAltText("Cell")) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("asset://vault/pics/cell wall.png");
    expect(img.width).toBe(300);
    expect(screen.getByAltText("Logo").getAttribute("src")).toBe("https://example.com/logo.svg");
    // A Markdown image of a note isn't media: it stays text.
    expect(document.querySelector(".cm-content")!.textContent).toContain("![](Other.md)");
  });

  it("plays YouTube (no-cookie, from the link's start time) and Vimeo in sandboxed players", async () => {
    await open("School/Players.md");
    const frames = await waitFor(() => {
      const f = [...document.querySelectorAll<HTMLIFrameElement>(".cm-media-embed iframe")];
      expect(f).toHaveLength(2);
      return f;
    });
    expect(frames[0]!.src).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90");
    expect(frames[1]!.src).toBe("https://player.vimeo.com/video/76979871");
    for (const f of frames) {
      expect(f.getAttribute("sandbox")).toBe("allow-scripts allow-same-origin allow-presentation");
      expect(f.referrerPolicy).toBe("strict-origin-when-cross-origin");
    }
  });

  it("'Edit link' on a player shows the embed's text without starting playback", async () => {
    const view = await open("School/Video.md");
    const video = await screen.findByTitle("cell.mp4");
    const edit = video.parentElement!.querySelector(".cm-media-edit")!;
    fireEvent.mouseDown(edit);
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    expect(line.text).toBe("![[cell.mp4|400]]");
    await waitFor(() => expect(screen.queryByTitle("cell.mp4")).toBeNull()); // shown as text
  });
});

/** Right-click an image and pick `item` from its menu. */
function fromMenu(image: HTMLElement, item: string) {
  fireEvent.contextMenu(image.closest(".cm-image-frame")!, { clientX: 20, clientY: 20 });
  fireEvent.click(screen.getByRole("menuitem", { name: item }));
}

/** jsdom has no layout: lay the note out as 20px lines, with the editor 800px wide. */
function fakeLayout(view: EditorView) {
  const rect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  view.dom.getBoundingClientRect = () => ({ ...rect, x: 0, y: 0, toJSON: () => rect });
  vi.spyOn(view, "documentTop", "get").mockReturnValue(0);
  vi.spyOn(view, "lineBlockAtHeight").mockImplementation((h) => {
    const n = Math.max(1, Math.min(view.state.doc.lines, Math.floor(h / 20) + 1));
    const line = view.state.doc.line(n);
    const top = (n - 1) * 20;
    return { from: line.from, to: line.to, top, height: 20, bottom: top + 20 } as never;
  });
}

const selected = () => document.querySelector(".cm-image-selected");

describe("editing embedded images", () => {
  beforeEach(() =>
    setup({
      "Note.md": 'Intro\n\n![Cell|300x200](photo.png "Caption")\n',
      ...Object.fromEntries(
        ["Plain", "Open", "Drag", "Stay", "Resize"].map((n) => [
          `${n}.md`,
          "Intro\n\n![[photo.png|300]]\n\nOutro\n\nEnd\n",
        ]),
      ),
      "photo.png": "original image bytes",
    }),
  );
  afterEach(() => {
    vi.restoreAllMocks();
    document.querySelector(".cm-image-menu")?.remove();
  });

  it("selects an image with one click, without moving the cursor into its text", async () => {
    const view = await open("Plain.md");
    const image = await screen.findByAltText("photo.png");
    const head = view.state.selection.main.head;
    fireEvent.pointerDown(image.closest(".cm-image-frame")!, { button: 0 });
    fireEvent.pointerUp(window, { button: 0 });
    await waitFor(() => expect(selected()).toBe(image.closest(".cm-image-embed")));
    expect(view.state.selection.main.head).toBe(head);
    expect(screen.getByAltText("photo.png")).toBe(image); // still shown, not its text
    expect(view.dom).toHaveClass("cm-image-selecting"); // the text cursor hides
    // Ctrl+C copies its embed; Escape lets go of it.
    const copied: Record<string, string> = {};
    const clipboardData = { setData: (type: string, value: string) => (copied[type] = value) };
    fireEvent.copy(view.contentDOM, { clipboardData });
    expect(copied["text/plain"]).toBe("![[photo.png|300]]");
    fireEvent.keyDown(view.contentDOM, { key: "Escape" });
    await waitFor(() => expect(selected()).toBeNull());
    // Selected again, Delete removes it (and the blank line it leaves).
    fireEvent.pointerDown(image.closest(".cm-image-frame")!, { button: 0 });
    fireEvent.pointerUp(window, { button: 0 });
    fireEvent.keyDown(view.contentDOM, { key: "Delete" });
    expect(text(view)).toBe("Intro\n\nOutro\n\nEnd\n");
    expect(undo(view)).toBe(true);
    expect(text(view)).toBe("Intro\n\n![[photo.png|300]]\n\nOutro\n\nEnd\n");
  });

  it("opens the image with a double click", async () => {
    await open("Open.md");
    const image = await screen.findByAltText("photo.png");
    fireEvent.dblClick(image.closest(".cm-image-frame")!);
    expect(useAppStore.getState().activePath).toBe("photo.png");
  });

  it.each([
    { shortcut: "Ctrl+C", key: "c", event: "copy", ctrlKey: true, metaKey: false },
    { shortcut: "Ctrl+X", key: "x", event: "cut", ctrlKey: true, metaKey: false },
    { shortcut: "Cmd+C", key: "c", event: "copy", ctrlKey: false, metaKey: true },
    { shortcut: "Cmd+X", key: "x", event: "cut", ctrlKey: false, metaKey: true },
  ] as const)("uses $shortcut on the selected image instead of the text cursor", async (keys) => {
    const view = await open("Plain.md");
    const original = text(view);
    const head = view.state.selection.main.head;
    const image = await screen.findByAltText("photo.png");
    fireEvent.pointerDown(image.closest(".cm-image-frame")!, { button: 0 });
    fireEvent.pointerUp(window, { button: 0 });
    const clipboardData = { clearData: vi.fn(), setData: vi.fn() };

    // A real clipboard shortcut sends keydown before the clipboard event.
    fireEvent.keyDown(view.contentDOM, keys);
    fireEvent[keys.event](view.contentDOM, { clipboardData });

    expect(clipboardData.setData).toHaveBeenCalledWith("text/plain", "![[photo.png|300]]");
    expect(view.state.selection.main.head).toBe(head);
    if (keys.event === "cut") {
      expect(text(view)).toBe("Intro\n\nOutro\n\nEnd\n");
      expect(undo(view)).toBe(true);
    }
    expect(text(view)).toBe(original);
  });

  it("moves an image to the line it's dragged to, and copies it with Ctrl", async () => {
    const view = await open("Drag.md");
    fakeLayout(view);
    const frame = () => screen.getByAltText("photo.png").closest(".cm-image-frame")!;
    // Line 5 ("Outro") spans 80–100px: dropping on its lower half puts the image after it.
    fireEvent.pointerDown(await waitFor(frame), { button: 0, clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 70 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 95 });
    const marker = document.querySelector<HTMLElement>(".cm-image-drop-line")!;
    expect(marker.hidden).toBe(false);
    expect(marker.style.top).toBe("99px");
    fireEvent.pointerUp(window, { clientX: 10, clientY: 95 });
    // A blank line keeps it apart from "Outro"; the one it left behind is gone.
    expect(text(view)).toBe("Intro\n\nOutro\n\n![[photo.png|300]]\n\nEnd\n");
    expect(document.querySelector(".cm-image-drop-line")).toBeNull();
    await waitFor(() => expect(selected()).toBe(frame().closest(".cm-image-embed")));
    expect(undo(view)).toBe(true);
    expect(text(view)).toBe("Intro\n\n![[photo.png|300]]\n\nOutro\n\nEnd\n");

    // With Ctrl held, the image stays where it was and a copy goes to the top.
    await waitFor(frame);
    fireEvent.pointerDown(frame(), { button: 0, clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 2, ctrlKey: true });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 2, ctrlKey: true });
    expect(text(view)).toBe("![[photo.png|300]]\n\nIntro\n\n![[photo.png|300]]\n\nOutro\n\nEnd\n");
  });

  it("keeps a moved image its own paragraph, at the top, bottom or between lines", () => {
    const moved = (doc: string, src: number, after: number, copy = false) => {
      const state = EditorState.create({ doc });
      const spec = relocateEmbed(state, src, after, copy);
      return spec ? state.update(spec).state.doc.toString() : null;
    };
    expect(moved("A\n![[p.png]]\nB\nC", 2, 4)).toBe("A\nB\nC\n\n![[p.png]]");
    expect(moved("A\nB\n![[p.png]]", 3, 0)).toBe("![[p.png]]\n\nA\nB");
    expect(moved("A\nB\n![[p.png]]", 3, 1)).toBe("A\n\n![[p.png]]\n\nB");
    expect(moved("A\n\n![[p.png]]\n\nB", 3, 2)).toBeNull(); // where it already is
    expect(moved("A\n\n![[p.png]]\n\nB", 3, 2, true)).toBe("A\n\n![[p.png]]\n\n![[p.png]]\n\nB");
  });

  it("leaves the note alone when an image is dropped where it already is, or with Escape", async () => {
    const view = await open("Stay.md");
    fakeLayout(view);
    const frame = (await screen.findByAltText("photo.png")).closest(".cm-image-frame")!;
    fireEvent.pointerDown(frame, { button: 0, clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 58 });
    expect(document.querySelector<HTMLElement>(".cm-image-drop-line")!.hidden).toBe(true);
    fireEvent.pointerUp(window, { clientX: 10, clientY: 58 });
    fireEvent.pointerDown(frame, { button: 0, clientX: 10, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 10, clientY: 125 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: 10, clientY: 125 });
    expect(text(view)).toBe("Intro\n\n![[photo.png|300]]\n\nOutro\n\nEnd\n");
  });

  it("resizes from a handle on the image and writes Obsidian's |width", async () => {
    const view = await open("Resize.md");
    const image = await screen.findByAltText("photo.png");
    const handle = image.closest(".cm-image-box")!.querySelector('[data-handle="se"]')!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(window, { clientX: 360, clientY: 200 });
    expect(image.closest(".cm-image-frame")).toHaveStyle({ width: "360px" });
    expect(screen.getByText("360 × 270")).toBeInTheDocument(); // the size while dragging
    fireEvent.pointerMove(window, { clientX: 400, clientY: 200 });
    fireEvent.pointerUp(window, { clientX: 400, clientY: 200 });
    expect(view.state.doc.line(3).text).toBe("![[photo.png|400]]");
    await waitFor(() => expect(selected()).not.toBeNull()); // still selected
    // A handle on the left grows the image as it's dragged left; Escape cancels.
    const left = screen
      .getByAltText("photo.png")
      .closest(".cm-image-box")!
      .querySelector('[data-handle="w"]')!;
    fireEvent.pointerDown(left, { button: 0, clientX: 0, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: -50, clientY: 100 });
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(window, { clientX: -50, clientY: 100 });
    expect(view.state.doc.line(3).text).toBe("![[photo.png|400]]");
    fireEvent.pointerDown(left, { button: 0, clientX: 0, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 100, clientY: 100 });
    expect(view.state.doc.line(3).text).toBe("![[photo.png|300]]");
  });

  it("keeps both dimensions in proportion when resizing an image that has a height", async () => {
    const view = await open("Note.md");
    const image = await screen.findByAltText("Cell");
    const handle = image.closest(".cm-image-box")!.querySelector('[data-handle="e"]')!;
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(window, { clientX: 450, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 450, clientY: 100 });
    expect(view.state.doc.line(3).text).toBe('![Cell|450x300](photo.png "Caption")');
  });

  it("has no toolbar: crop and exact size are in the right-click menu", async () => {
    const view = await open("Note.md");
    const image = await screen.findByAltText("Cell");
    expect(document.querySelector(".cm-image-embed > .cm-image-tools")).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit image" })).toBeNull();
    expect(image.closest(".cm-image-frame")).toHaveStyle({ width: "300px", aspectRatio: "1.5" });
    fromMenu(image, "Crop and exact size…");
    fireEvent.input(screen.getByLabelText("Width (px)"), { target: { value: "480" } });
    fireEvent.input(screen.getByLabelText("Height (px)"), { target: { value: "240" } });
    fireEvent.input(screen.getByLabelText("Left crop (%)"), { target: { value: "10" } });
    fireEvent.input(screen.getByLabelText("Right crop (%)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply image changes" }));
    expect(readImageLayout(view.state.doc.line(3).text).layout).toEqual({
      width: 480,
      height: 240,
      crop: [10, 0, 20, 0],
    });
    expect(text(view)).toContain('photo.png "Caption"');
    await act(() => saveAll());
    expect(h.b.files()["Note.md"]).toBe(text(view));
    expect(h.b.files()["photo.png"]).toBe("original image bytes");
    expect(undo(view)).toBe(true);
    expect(text(view)).toBe('Intro\n\n![Cell|300x200](photo.png "Caption")\n');
  });

  it("cancels previews, rejects empty crops and resets transforms explicitly", async () => {
    const view = await open("Note.md");
    const source = text(view);
    fromMenu(await screen.findByAltText("Cell"), "Crop and exact size…");
    fireEvent.input(screen.getByLabelText("Left crop (%)"), { target: { value: "60" } });
    fireEvent.input(screen.getByLabelText("Right crop (%)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply image changes" }));
    expect(text(view)).toBe(source);
    expect(screen.getByText(/leave some image visible/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByAltText("Cell").closest(".cm-image-frame")).toHaveStyle({
      width: "300px",
      aspectRatio: "1.5",
    });
    fromMenu(screen.getByAltText("Cell"), "Reset size and crop");
    expect(text(view)).toBe('Intro\n\n![Cell](photo.png "Caption")\n');
  });

  it("keeps source editing available and disables image changes when read-only", async () => {
    const view = await open("Note.md");
    fromMenu(await screen.findByAltText("Cell"), "Edit link");
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3);
    expect(screen.queryByAltText("Cell")).toBeNull();
    const parent = document.createElement("div");
    document.body.append(parent);
    const readonly = new EditorView({
      parent,
      state: EditorState.create({
        doc: "Intro\n\n![[photo.png]]\n",
        extensions: [embeds("Note.md"), EditorState.readOnly.of(true)],
      }),
    });
    try {
      const frame = parent.querySelector(".cm-image-frame")!;
      expect(parent.querySelector(".cm-image-handle")).toBeNull();
      fireEvent.contextMenu(frame);
      const items = screen.getAllByRole("menuitem").map((b) => b.textContent);
      expect(items).toEqual(["Open image", "Edit link", "Copy embed"]);
    } finally {
      readonly.destroy();
      parent.remove();
    }
  });
});

describe("adding media to a note", () => {
  // Clipboard files as the webview gives them (jsdom's File can't be read back here).
  const file = (name: string, type: string) =>
    ({ name, type, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }) as File;
  const png = () => file("image.png", "image/png");

  it("saves a pasted screenshot as Obsidian's 'Pasted image <time>' and embeds it", async () => {
    await setup({ "School/Bio.md": "Cells:" });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 13, 21, 18, 45));
    try {
      const view = await open("School/Bio.md");
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      fireEvent.paste(view.contentDOM, {
        clipboardData: { files: [png()], getData: () => "", types: ["Files"] },
      });
      await waitFor(() => expect(text(view)).toBe("Cells:\n![[Pasted image 20261013211845.png]]"));
      expect(h.b.files()).toHaveProperty(["Attachments/Pasted image 20261013211845.png"]);
      // A second one the same second gets a free name.
      fireEvent.paste(view.contentDOM, {
        clipboardData: { files: [png()], getData: () => "", types: ["Files"] },
      });
      await waitFor(() => expect(text(view)).toContain("![[Pasted image 20261013211845 1.png]]"));
    } finally {
      vi.useRealTimers();
    }
  });

  it("puts attachments next to the note with './', and uses the path when names clash", async () => {
    await setup({ "School/Bio.md": "", "Other/clip.mp4": "" }, "./");
    const view = await open("School/Bio.md");
    const clip = file("clip.mp4", "video/mp4");
    fireEvent.paste(view.contentDOM, {
      clipboardData: { files: [clip], getData: () => "", types: ["Files"] },
    });
    // Another clip.mp4 exists, so a bare ![[clip.mp4]] could mean either.
    await waitFor(() => expect(text(view)).toBe("![[/School/clip.mp4]]"));
  });

  it("leaves text copied from Excel or Word as text (it carries a picture of itself)", () => {
    const data = (plain: string, files: File[]) =>
      ({
        files,
        getData: (t: string) => (t === "text/plain" ? plain : ""),
      }) as unknown as DataTransfer;
    expect(pastedMedia(data("a\tb", [png()]))).toEqual([]);
    expect(pastedMedia(data("", [png()]))).toHaveLength(1);
    const named = file("holiday.jpg", "image/jpeg");
    expect(pastedMedia(data("holiday.jpg", [named]))).toEqual([named]);
    const pdf = file("doc.pdf", "application/pdf");
    expect(pastedMedia(data("", [pdf]))).toEqual([]);
  });

  it("embeds a file dragged from the file tree; a note becomes a link", async () => {
    await setup({ "Bio.md": "Top", "Media/diagram.png": "", "Cells.md": "# Cells" });
    const view = await open("Bio.md");
    // Where the drop lands (jsdom has no layout): the end of the note.
    vi.spyOn(view, "posAtCoords").mockImplementation(() => view.state.doc.length);
    const drop = (path: string) =>
      fireEvent.drop(view.contentDOM, {
        dataTransfer: { getData: (t: string) => (t === PATH_MIME ? path : ""), types: [PATH_MIME] },
      });
    drop("Media/diagram.png");
    expect(text(view)).toBe("Top\n![[diagram.png]]");
    drop("Cells.md");
    expect(text(view)).toBe("Top\n![[diagram.png]]\n[[Cells]]");
  });

  it("offers 'Image, video or audio…' and 'Embed from the web' in the command menu", async () => {
    await setup({ "Bio.md": "" });
    const view = await open("Bio.md");
    const pick = vi
      .spyOn(h.b, "pickAttachments")
      .mockResolvedValue({ paths: ["Attachments/a.webm"], failed: [] });
    SLASH_COMMANDS.find((c) => c.id === "media")!.run!(view, 0, 0, undefined as never);
    await waitFor(() => expect(text(view)).toBe("![[a.webm]]"));
    expect(pick).toHaveBeenCalledWith("Attachments", "/memory/Demo Vault");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    SLASH_COMMANDS.find((c) => c.id === "web-embed")!.run!(view, 0, 0, undefined as never);
    expect(text(view)).toBe("![]()");
    expect(view.state.selection.main.head).toBe(4); // inside the ( )
  });

  it("embeds the files that made it in even when others in the batch failed", async () => {
    await setup({ "Bio.md": "" });
    const view = await open("Bio.md");
    vi.spyOn(h.b, "pickAttachments").mockResolvedValue({
      paths: ["Attachments/a.png", "Attachments/c.png"],
      failed: [{ name: "b.png", error: "can't be read" }],
    });
    SLASH_COMMANDS.find((c) => c.id === "media")!.run!(view, 0, 0, undefined as never);
    await waitFor(() => expect(text(view)).toBe("![[a.png]]\n![[c.png]]"));
    expect(useAppStore.getState().error).toBe("Couldn't add: b.png (can't be read)");
  });

  it("keeps a pasted screenshot that couldn't be saved, and saves it before closing", async () => {
    await setup({ "Bio.md": "Cells:" });
    const view = await open("Bio.md");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    const save = vi.spyOn(h.b, "saveAttachment");
    save.mockRejectedValue(new Error("disk full"));
    const shot = {
      name: "image.png",
      type: "image/png",
      arrayBuffer: async () => new ArrayBuffer(1),
    } as File;
    const paste = () =>
      fireEvent.paste(view.contentDOM, {
        clipboardData: { files: [shot], getData: () => "", types: ["Files"] },
      });
    paste();
    await waitFor(() => expect(useAppStore.getState().error).toMatch(/disk full/));
    expect(text(view)).toBe("Cells:");
    // Still failing: closing is held back, and the screenshot is named.
    const [unsaved] = await act(() => saveAll());
    expect(unsaved).toMatchObject({ reason: "failed" });
    expect(unsaved!.path).toMatch(/^Attachments\/Pasted image \d{14}\.png$/);
    // The disk has room again: the next try saves it and embeds it, then closing goes ahead.
    save.mockResolvedValue("Attachments/Pasted image 20261013211845.png");
    expect(await act(() => saveAll())).toEqual([]);
    expect(text(view)).toBe("Cells:\n![[Pasted image 20261013211845.png]]");
    expect((await h.b.readFile("Bio.md")).content).toBe(
      "Cells:\n![[Pasted image 20261013211845.png]]",
    );
  });
});

describe("an import that takes a while (a big video)", () => {
  const png = () =>
    ({ name: "image.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(1) }) as File;
  /** Make the next save finish only when the returned function is called. */
  function slowSave() {
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    vi.spyOn(h.b, "saveAttachment").mockImplementation(async () => {
      await done;
      return "Attachments/slow.png";
    });
    return finish;
  }
  const paste = (view: EditorView) =>
    fireEvent.paste(view.contentDOM, {
      clipboardData: { files: [png()], getData: () => "", types: ["Files"] },
    });

  it("still embeds in its note after you've switched to another one", async () => {
    await setup({ "A.md": "Alpha", "B.md": "Beta" });
    const finish = slowSave();
    const first = render(<Editor path="A.md" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    const view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    paste(view);
    first.unmount(); // open B meanwhile
    await open("B.md");
    finish();
    await waitFor(async () =>
      expect((await h.b.readFile("A.md")).content).toBe("Alpha\n![[slow.png]]"),
    );
    expect((await h.b.readFile("B.md")).content).toBe("Beta");
  });

  it("keeps the embed in a recovery file if its note can't be written, else holds back closing", async () => {
    await setup({ "A.md": "Alpha", "B.md": "Beta" });
    const write = h.b.writeFile.bind(h.b);
    const failA = vi
      .spyOn(h.b, "writeFile")
      .mockImplementation((path, ...rest) =>
        path === "A.md" ? Promise.reject(new Error("disk full")) : write(path, ...rest),
      );
    // 1. The note can't be written, but a recovery file can.
    let finish = slowSave();
    let first = render(<Editor path="A.md" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    let view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    paste(view);
    first.unmount();
    finish();
    expect(await act(() => saveAll())).toEqual([]);
    const kept = Object.entries(h.b.files()).find(([p]) => p.startsWith("A (unsaved "));
    expect(kept?.[1]).toBe("Alpha\n![[slow.png]]");
    expect(useAppStore.getState().error).toMatch(/“A” couldn’t be saved \(disk full\)/);
    // 2. Not even a recovery file: closing is held back and the note is reported.
    vi.spyOn(h.b, "createFile").mockRejectedValue(new Error("disk full"));
    finish = slowSave();
    first = render(<Editor path="A.md" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    view = EditorView.findFromDOM(document.querySelector(".cm-editor") as HTMLElement)!;
    paste(view);
    first.unmount();
    finish();
    expect(await act(() => saveAll())).toEqual([{ path: "A.md", reason: "failed" }]);
    failA.mockRestore();
  });

  it("is waited for before the app closes or updates, so the embed is saved", async () => {
    await setup({ "A.md": "Alpha" });
    const finish = slowSave();
    const view = await open("A.md");
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    paste(view);
    let saved = false;
    const all = saveAll().then(() => (saved = true));
    await new Promise((r) => setTimeout(r, 50));
    expect(saved).toBe(false); // still waiting for the import
    finish();
    await act(() => all);
    expect((await h.b.readFile("A.md")).content).toBe("Alpha\n![[slow.png]]");
  });
});

describe("Settings → Files & links", () => {
  it("sets the attachment folder new media goes to", async () => {
    await setup({ "Bio.md": "" });
    render(<Settings section="files" onClose={vi.fn()} />);
    const field = screen.getByRole("textbox", { name: "Attachment folder" });
    expect(field).toHaveValue("Attachments");
    fireEvent.change(field, { target: { value: " ./assets " } });
    fireEvent.blur(field);
    await waitFor(async () =>
      expect(
        JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).attachments,
      ).toEqual({ folder: "./assets" }),
    );
  });
});
