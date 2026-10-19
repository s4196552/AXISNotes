import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// T-083 on the real app: PNG/JPEG covers served from the vault through the asset protocol,
// repositioning by drag and keys, copying an image in from outside the vault (all but the
// native file dialog itself), and an image as the page icon.

const vault = process.env.AXIS_E2E_VAULT!;
const pictures = process.env.AXIS_E2E_PICTURES!;
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "T-083");
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) => fs.readFileSync(onDisk(rel), "utf8");
const row = (rel: string) => $(`[data-path="${rel}"]`);
const COVER_IMG = ".page-cover img";

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

const objectPosition = () =>
  browser.execute(
    (s: string) => document.querySelector<HTMLElement>(s)!.style.objectPosition,
    COVER_IMG,
  );

/** The hover-only header buttons: point at the header first, as a person would. */
async function headerButton(label: string) {
  await $(".page-header").moveTo();
  const button = $(`button=${label}`);
  await button.waitForExist();
  return button;
}

async function coverButton(label: string) {
  await $(".page-cover").moveTo();
  const button = $(".page-cover-actions").$(`button=${label}`);
  await button.waitForExist();
  return button;
}

describe("Page covers and icons on the real app (T-083)", () => {
  it("shows a JPEG cover from the frontmatter at its saved focus", async () => {
    await row("Trips").click();
    await row("Trips/Coast.md").click();
    await expect($(".editor-title")).toHaveText("Coast");
    const img = await imageLoaded(COVER_IMG);
    expect(img).toMatchObject({ w: 1200, h: 900 });
    expect(img.src).not.toMatch(/^data:/); // served from disk, not inlined
    expect(await objectPosition()).toBe("center 20%");
    // The cover keys stay out of the properties chip.
    await expect($('[aria-label="Value of banner"]')).not.toExist();
    await snapshot("01-jpeg-cover");
  });

  it("repositions the cover by dragging and with the keyboard, saving banner_y", async () => {
    await (await coverButton("Reposition")).click();
    const cover = $(".page-cover");
    await expect(cover).toHaveElementClass("repositioning");
    // Dragging the picture up shows more of its lower part.
    await browser
      .action("pointer")
      .move({ origin: cover })
      .down()
      .move({ origin: cover, y: -60, duration: 200 })
      .up()
      .perform();
    const dragged = await objectPosition();
    const y = Number(/center ([\d.]+)%/.exec(dragged)![1]);
    expect(y).toBeGreaterThan(20);
    await browser.keys(Key.ArrowDown);
    expect(await objectPosition()).toBe(`center ${Math.round(y + 5)}%`);
    await snapshot("02-repositioning");
    // A real mouse click on Save (it sits on the cover, which captures drags).
    await $(".page-cover-actions").$("button=Save position").click();
    await until(
      () => read("Trips/Coast.md").includes(`banner_y: ${(Math.round(y + 5) / 100).toString()}`),
      "banner_y was not saved",
    );
    expect(read("Trips/Coast.md")).toContain('banner: "[[Trips/attachments/coast.jpg]]"');
  });

  it("picks a PNG from the vault as a new cover", async () => {
    await row("Plans.md").click();
    await expect($(".editor-title")).toHaveText("Plans");
    await (await headerButton("Add cover")).click();
    const picker = $('[role="dialog"][aria-label="Choose a cover"]');
    await picker.$("button=Images").click();
    await picker.$('[title="sunset.png"]').click();
    const img = await imageLoaded(COVER_IMG);
    expect(img.w).toBe(1200);
    await until(() => read("Plans.md").includes("banner:"), "cover was not saved");
    expect(read("Plans.md")).toMatch(/^---\nbanner: "\[\[sunset\.png\]\]"\n---\n\n?# Plans/);
    // The YAML stays folded behind its chip.
    await expect($(".cm-lp-props-chip")).toExist();
    await snapshot("03-png-cover");
  });

  it("copies an image in from outside the vault and uses it as the cover", async () => {
    // The native file dialog is the one step not automated: driving it means sending
    // keystrokes to the desktop. Everything after it is real: the Rust copy into
    // attachments/, the file tree, and choosing the copy in the cover picker.
    const source = path.join(pictures, "Holiday photo.png");
    const entry = await invoke<{ path: string }>("import_image", {
      source,
      folder: "attachments",
    });
    expect(entry.path).toBe("attachments/Holiday photo.png");
    expect(fs.readFileSync(onDisk(entry.path))).toEqual(fs.readFileSync(source));
    await row("attachments").waitForExist();

    await (await coverButton("Change cover")).click();
    const picker = $('[role="dialog"][aria-label="Choose a cover"]');
    await picker.$("button=Images").click();
    await expect(picker.$("button*=Upload image")).toBeDisplayed();
    await picker.$('[title="attachments/Holiday photo.png"]').click();
    await until(
      () => read("Plans.md").includes("[[attachments/Holiday photo.png]]"),
      "cover not saved",
    );
    await imageLoaded(COVER_IMG);
    await snapshot("04-copied-in-cover");
  });

  it("copies under a free name and refuses non-images and escapes", async () => {
    // Trips/attachments already holds a coast.jpg.
    const entry = await invoke<{ path: string }>("import_image", {
      source: path.join(pictures, "coast.jpg"),
      folder: "Trips/attachments",
    });
    expect(entry.path).toBe("Trips/attachments/coast 1.jpg");
    expect(fs.existsSync(onDisk("Trips/attachments/coast 1.jpg"))).toBe(true);
    const notImage = await invoke<{ rejected?: { code: string } }>("import_image", {
      source: path.join(pictures, "notes.txt"),
      folder: "attachments",
    });
    expect(notImage.rejected?.code).toBe("InvalidName");
    const escape = await invoke<{ rejected?: { code: string } }>("import_image", {
      source: path.join(pictures, "coast.jpg"),
      folder: "../outside",
    });
    expect(escape.rejected?.code).toBe("OutsideVault");
    expect(fs.existsSync(path.join(path.dirname(vault), "outside"))).toBe(false);
  });

  it("uses a vault image as the page icon, in the header and the file tree", async () => {
    await (await headerButton("Add icon")).click();
    const dialog = $('[role="dialog"][aria-label="Icon for Plans.md"]');
    await dialog.waitForDisplayed();
    await dialog.$("button=Image").click();
    await dialog.$('[title="sunset.png"]').click();
    await imageLoaded(".page-icon img");
    await imageLoaded('[data-path="Plans.md"] img.custom-icon');
    await snapshot("05-image-icon");
  });
});
