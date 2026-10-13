import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
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
    const pick = vi.spyOn(h.b, "pickAttachments").mockResolvedValue(["Attachments/a.webm"]);
    SLASH_COMMANDS.find((c) => c.id === "media")!.run(view, 0, 0, undefined as never);
    await waitFor(() => expect(text(view)).toBe("![[a.webm]]"));
    expect(pick).toHaveBeenCalledWith("Attachments", "/memory/Demo Vault");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "" } });
    SLASH_COMMANDS.find((c) => c.id === "web-embed")!.run(view, 0, 0, undefined as never);
    expect(text(view)).toBe("![]()");
    expect(view.state.selection.main.head).toBe(4); // inside the ( )
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
