import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// T-075: images, video and audio in notes, on the real app and disk. Dropping files from
// Explorer and the file picker are native UI that WebDriver can't drive (checked by hand).

const vault = process.env.AXIS_E2E_VAULT!;
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) => fs.readFileSync(onDisk(rel), "utf8");
const row = (rel: string) => $(`[data-path="${rel}"]`);

const until = (cond: () => boolean | Promise<boolean>, msg: string) =>
  browser.waitUntil(cond, { timeoutMsg: msg });

async function openNote(rel: string, title: string) {
  await row(rel).click();
  await expect($(".editor-title")).toHaveText(title);
}

describe("Images, video and audio in notes", () => {
  it("plays a vault audio file and shows a vault image (asset protocol + CSP)", async () => {
    await openNote("Media.md", "Media");
    const audio = $(".cm-media-embed audio");
    await audio.waitForExist();
    // Loading its length proves the file streams in under the page's media policy.
    await until(
      async () =>
        (await browser.execute(
          () => document.querySelector<HTMLAudioElement>(".cm-media-embed audio")!.duration,
        )) > 0.9,
      "the audio didn't load",
    );
    const img = $(".cm-media-embed img");
    await until(
      async () =>
        (await browser.execute(
          () => document.querySelector<HTMLImageElement>(".cm-media-embed img")!.naturalWidth,
        )) === 1,
      "the image didn't load",
    );
    await expect(img).toHaveAttribute("width", "40");
  });

  it("embeds a YouTube link as its no-cookie player in a sandbox", async () => {
    const frame = $(".cm-media-embed iframe");
    await frame.waitForExist();
    await expect(frame).toHaveAttribute(
      "src",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    );
    await expect(frame).toHaveAttribute(
      "sandbox",
      "allow-scripts allow-same-origin allow-presentation",
    );
  });

  it("saves a pasted screenshot into Attachments and embeds it like Obsidian", async () => {
    await openNote("Paste here.md", "Paste here");
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys(Key.Ctrl);
    // What the clipboard holds after Win+Shift+S: an unnamed PNG.
    await browser.execute(() => {
      const png = Uint8Array.from(
        atob(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        ),
        (c) => c.charCodeAt(0),
      );
      const data = new DataTransfer();
      data.items.add(new File([png], "image.png", { type: "image/png" }));
      document
        .querySelector(".cm-content")!
        .dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
        );
    });
    await until(
      () => /!\[\[Pasted image \d{14}\.png\]\]/.test(read("Paste here.md")),
      "the embed wasn't saved in the note",
    );
    const name = /!\[\[(Pasted image \d{14}\.png)\]\]/.exec(read("Paste here.md"))![1]!;
    expect(
      fs
        .readFileSync(onDisk(`Attachments/${name}`))
        .subarray(1, 4)
        .toString(),
    ).toBe("PNG");
    // Off its line, the embed shows the picture.
    await browser.keys([Key.Ctrl, Key.Home]);
    await browser.keys(Key.Ctrl);
    await until(
      async () =>
        (await browser.execute(
          () => document.querySelector<HTMLImageElement>(".cm-media-embed img")?.naturalWidth ?? 0,
        )) === 1,
      "the pasted image didn't show",
    );
  });

  it("opens an audio file from the file tree in a player", async () => {
    await row("Sounds").click();
    await row("Sounds/tone.wav").click();
    await expect($(".image-view-body audio")).toExist();
  });
});
