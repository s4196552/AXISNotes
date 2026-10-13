import { describe, expect, it } from "vitest";
import type { VaultEntry } from "../ipc";
import {
  attachmentDir,
  embedFor,
  isImagePath,
  mediaKind,
  parseImageEmbed,
  parseMarkdownEmbed,
  pastedFileName,
  pastedName,
  resolveAttachment,
  resolveRelative,
  videoPlayerUrl,
} from "./attachments";

const f = (path: string): VaultEntry => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1),
  kind: "file",
  modifiedMs: 0,
});
const d = (path: string, children: VaultEntry[]): VaultEntry => ({
  path,
  name: path,
  kind: "dir",
  modifiedMs: 0,
  children,
});

const tree = d("", [
  f("cat.png"),
  d("School", [f("School/Bio.md"), f("School/cat.png"), f("School/diagram.svg")]),
  d("Clippings", [d("Clippings/attachments", [f("Clippings/attachments/Chart 1.png")])]),
]);

describe("attachments", () => {
  it("recognizes images and Obsidian's size syntax", () => {
    expect(isImagePath("a/b.JPG")).toBe(true);
    expect(isImagePath("a/b.md")).toBe(false);
    expect(parseImageEmbed("cat.png|300")).toEqual({ target: "cat.png", width: 300 });
    expect(parseImageEmbed("cat.png|300x200")).toEqual({ target: "cat.png", width: 300 });
    expect(parseImageEmbed("cat.png|a caption")).toEqual({ target: "cat.png", width: null });
  });

  it("resolves full paths, then the note's folder, then anywhere", () => {
    expect(resolveAttachment("School/diagram.svg", "x.md", tree)).toBe("School/diagram.svg");
    expect(resolveAttachment("cat.png", "School/Bio.md", tree)).toBe("School/cat.png");
    expect(resolveAttachment("cat.png", "Other.md", tree)).toBe("cat.png");
    expect(resolveAttachment("Chart 1.png", "Clippings/Chart.md", tree)).toBe(
      "Clippings/attachments/Chart 1.png",
    );
    expect(resolveAttachment("CAT.PNG", "School/Bio.md", tree)).toBe("School/cat.png");
    expect(resolveAttachment("missing.png", "x.md", tree)).toBeNull();
  });
});

describe("media embeds (T-075)", () => {
  it("tells images, video and audio apart, for vault paths and web addresses", () => {
    expect(mediaKind("a/clip.MP4")).toBe("video");
    expect(mediaKind("talk.m4a")).toBe("audio");
    expect(mediaKind("https://x.org/p.png?w=200#top")).toBe("image");
    expect(mediaKind("https://x.org/watch")).toBeNull();
    expect(mediaKind("Note.md")).toBeNull();
  });

  it("turns YouTube and Vimeo links into their embeddable players", () => {
    const yt = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ";
    expect(videoPlayerUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(yt);
    expect(videoPlayerUrl("https://youtu.be/dQw4w9WgXcQ?t=90")).toBe(`${yt}?start=90`);
    expect(videoPlayerUrl("https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s")).toBe(
      `${yt}?start=3723`,
    );
    expect(videoPlayerUrl("https://youtube.com/shorts/dQw4w9WgXcQ")).toBe(yt);
    expect(videoPlayerUrl("https://www.youtube.com/embed/dQw4w9WgXcQ")).toBe(yt);
    expect(videoPlayerUrl("https://vimeo.com/76979871")).toBe(
      "https://player.vimeo.com/video/76979871",
    );
    expect(videoPlayerUrl("https://vimeo.com/76979871/abc123")).toBe(
      "https://player.vimeo.com/video/76979871?h=abc123",
    );
    expect(videoPlayerUrl("https://www.youtube.com/@channel")).toBeNull();
    expect(videoPlayerUrl("https://example.com/watch?v=dQw4w9WgXcQ")).toBeNull();
    expect(videoPlayerUrl("javascript:alert(1)")).toBeNull();
  });

  it("reads Markdown images on a line of their own, with Obsidian's |width", () => {
    expect(parseMarkdownEmbed("![Cell|300](pics/cell%20wall.png)")).toEqual({
      alt: "Cell",
      src: "pics/cell wall.png",
      width: 300,
    });
    expect(parseMarkdownEmbed('  ![](<My clip.mp4> "Title")')).toEqual({
      alt: "",
      src: "My clip.mp4",
      width: null,
    });
    // Web addresses keep their escapes.
    expect(parseMarkdownEmbed("![x](https://a.org/a%20b.png)")?.src).toBe(
      "https://a.org/a%20b.png",
    );
    expect(parseMarkdownEmbed("See ![x](a.png)")).toBeNull();
    expect(parseMarkdownEmbed("[link](a.png)")).toBeNull();
  });

  it("resolves ../ paths from the note's folder", () => {
    expect(resolveRelative("../pics/a.png", "School/Bio/Cells.md")).toBe("School/pics/a.png");
    expect(resolveRelative("./a.png", "School/Bio.md")).toBe("School/a.png");
    expect(resolveRelative("pics/a.png", "School/Bio.md")).toBe("pics/a.png");
  });

  it("picks the attachment folder like Obsidian's setting", () => {
    expect(attachmentDir("", "School/Bio.md")).toBe("");
    expect(attachmentDir("/", "School/Bio.md")).toBe("");
    expect(attachmentDir("./", "School/Bio.md")).toBe("School");
    expect(attachmentDir("./assets/", "School/Bio.md")).toBe("School/assets");
    expect(attachmentDir("./assets", "Bio.md")).toBe("assets");
    expect(attachmentDir(String.raw` Media\Images/ `, "School/Bio.md")).toBe("Media/Images");
  });

  it("names pasted files like Obsidian, keeping real file names", () => {
    const at = new Date(2026, 9, 13, 21, 18, 45);
    expect(pastedName("png", at)).toBe("Pasted image 20261013211845.png");
    expect(pastedFileName({ name: "image.png", type: "image/png" }, at)).toBe(
      "Pasted image 20261013211845.png",
    );
    expect(pastedFileName({ name: "", type: "image/jpeg" }, at)).toBe(
      "Pasted image 20261013211845.jpg",
    );
    expect(pastedFileName({ name: "Holiday.MOV", type: "video/quicktime" }, at)).toBe(
      "Holiday.MOV",
    );
    expect(pastedFileName({ name: "notes.txt", type: "text/plain" }, at)).toBeNull();
  });

  it("embeds by name, by path when the name is taken elsewhere, and in Markdown when a wikilink can't hold it", () => {
    expect(embedFor("Attachments/new.png", tree)).toBe("![[new.png]]");
    expect(embedFor("Attachments/cat.png", tree)).toBe("![[Attachments/cat.png]]");
    expect(embedFor("Attachments/a#1.png", tree)).toBe("![](<Attachments/a#1.png>)");
  });
});
