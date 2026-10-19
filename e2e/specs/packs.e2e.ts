import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";

// T-091 on the real app: icon and image packs copied from a folder and a .zip into the
// vault's hidden .axisnotes/packs/, served through the asset protocol, and used as a page
// icon and a cover. As in covers.e2e.ts, the native file dialog is the one step not driven:
// the import command is called with the path it would return.

const vault = process.env.AXIS_E2E_VAULT!;
const downloads = process.env.AXIS_E2E_DOWNLOADS!;
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "T-091");
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) => fs.readFileSync(onDisk(rel), "utf8");
const row = (rel: string) => $(`[data-path="${rel}"]`);

interface Pack {
  kind: string;
  name: string;
  dir: string;
  files: string[];
  monochrome: boolean;
}

async function snapshot(name: string) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await browser.saveScreenshot(path.join(QA_DIR, `${name}.png`));
}

function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return browser.executeAsync(
    (c: string, a: Record<string, unknown>, done: (v: unknown) => void) => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<unknown> };
      };
      w.__TAURI_INTERNALS__.invoke(c, a).then(done, (e: unknown) => done({ rejected: e }));
    },
    cmd,
    args,
  ) as Promise<T>;
}

async function until(check: () => boolean | Promise<boolean>, message: string) {
  await browser.waitUntil(check, { timeout: 8000, timeoutMsg: message });
}

/** Wait until an <img> matching `selector` has loaded real pixels; returns its size. */
async function imageLoaded(selector: string) {
  await until(
    () =>
      browser.execute((s: string) => {
        const img = document.querySelector<HTMLImageElement>(s);
        return Boolean(img?.complete && img.naturalWidth > 0);
      }, selector),
    `image ${selector} did not load`,
  );
  return browser.execute((s: string) => {
    const img = document.querySelector<HTMLImageElement>(s)!;
    return { w: img.naturalWidth, h: img.naturalHeight, src: img.src };
  }, selector);
}

async function headerButton(label: string) {
  await $(".page-header").moveTo();
  const button = $(`button=${label}`);
  await button.waitForExist();
  return button;
}

describe("Icon and image packs on the real app (T-091)", () => {
  it("copies a folder of icons into the vault's hidden packs folder", async () => {
    await row("Plans.md").waitForExist(); // the app has loaded the vault
    const pack = await invoke<Pack>("import_pack", {
      kind: "icons",
      source: path.join(downloads, "Line Icons"),
    });
    expect(pack).toEqual({
      kind: "icons",
      name: "Line Icons",
      dir: ".axisnotes/packs/icons/Line Icons",
      files: [
        ".axisnotes/packs/icons/Line Icons/moon.svg",
        ".axisnotes/packs/icons/Line Icons/star.svg",
      ],
      monochrome: true,
    });
    expect(read(".axisnotes/packs/icons/Line Icons/star.svg")).toContain("currentColor");
    // The PNG copy lost to the SVG, and the pack stays out of the file tree.
    expect(fs.existsSync(onDisk(".axisnotes/packs/icons/Line Icons/star.png"))).toBe(false);
    await expect($('[data-path=".axisnotes"]')).not.toExist();
  });

  it("uses a pack icon as the page icon, in the text colour", async () => {
    await row("Plans.md").click();
    await expect($(".editor-title")).toHaveText("Plans");
    await (await headerButton("Add icon")).click();
    const dialog = $('[role="dialog"][aria-label="Icon for Plans.md"]');
    await dialog.waitForDisplayed();
    await dialog.$("button=Packs").click();
    const grid = dialog.$('[role="listbox"][aria-label="Icons in Line Icons"]');
    await grid.waitForDisplayed();
    await snapshot("01-icon-packs-tab");
    await grid.$('[title="star"]').click();

    await until(
      () => read(".axisnotes/config.json").includes("Line Icons/star.svg"),
      "pack icon not saved",
    );
    const icons = JSON.parse(read(".axisnotes/config.json")).folderIcons;
    expect(icons["Plans.md"]).toEqual({
      icon: "image:.axisnotes/packs/icons/Line Icons/star.svg",
      color: "currentColor",
    });
    // Drawn as a mask; the hidden <img> beside it proves the asset protocol served the
    // file from the dot-folder.
    await imageLoaded(".page-icon .tinted-icon img");
    await imageLoaded('[data-path="Plans.md"] .tinted-icon img');
    await snapshot("02-pack-page-icon");
  });

  it("copies a zip of photos as an image pack and uses one as the cover", async () => {
    const pack = await invoke<Pack>("import_pack", {
      kind: "images",
      source: path.join(downloads, "Trip photos.zip"),
    });
    expect(pack.name).toBe("Trip photos");
    expect(pack.files).toEqual([
      ".axisnotes/packs/images/Trip photos/coast.jpg",
      ".axisnotes/packs/images/Trip photos/sunset.png",
    ]);
    expect(fs.readFileSync(onDisk(pack.files[0]!))).toEqual(
      fs.readFileSync(path.resolve("e2e", "fixtures", "coast.jpg")),
    );

    await (await headerButton("Add cover")).click();
    const picker = $('[role="dialog"][aria-label="Choose a cover"]');
    await picker.waitForDisplayed();
    const tiles = picker.$('[role="listbox"][aria-label="Covers in Trip photos"]');
    await tiles.scrollIntoView();
    await imageLoaded('[aria-label="Covers in Trip photos"] img');
    await snapshot("03-image-pack-gallery");
    await tiles.$('[title="coast"]').click();
    await until(
      () => read("Plans.md").includes("[[.axisnotes/packs/images/Trip photos/coast.jpg]]"),
      "pack cover not saved",
    );
    const img = await imageLoaded(".page-cover img");
    expect(img.w).toBe(1200);
    expect(img.src).not.toMatch(/^data:/);
    await snapshot("04-pack-cover");
  });

  it("refuses files that aren't a folder or a zip, and folders without images", async () => {
    const text = await invoke<{ rejected?: { code: string } }>("import_pack", {
      kind: "images",
      source: path.join(downloads, "notes.txt"),
    });
    expect(text.rejected?.code).toBe("InvalidName");
    const empty = path.join(downloads, "Empty");
    fs.mkdirSync(empty, { recursive: true });
    const none = await invoke<{ rejected?: { code: string } }>("import_pack", {
      kind: "icons",
      source: empty,
    });
    expect(none.rejected?.code).toBe("NotFound");
  });

  it("lists packs in Settings and removes one to the trash", async () => {
    await $('button[aria-label="Settings"]').click();
    await $("button=Icon & image packs").click();
    const icons = $('[aria-label="Icon packs"]');
    await expect(icons.$("span=Line Icons")).toBeDisplayed();
    await expect($('[aria-label="Image packs"]').$("span=Trip photos")).toBeDisplayed();
    await snapshot("05-settings-packs");
    await icons.$("button=Remove").click();
    // Moving a folder to the Recycle Bin can take a few seconds.
    await expect(icons.$("button=Removing…")).toExist();
    await until(
      () => !fs.existsSync(onDisk(".axisnotes/packs/icons/Line Icons")),
      "pack not removed",
    );
    await expect(icons.$("p=None yet.")).toBeDisplayed({ wait: 15000 });
  });
});
