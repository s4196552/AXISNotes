import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const vault = process.env.AXIS_E2E_VAULT!;
const file = (rel: string) => path.join(vault, ...rel.split("/"));
const row = (rel: string) => $(`.filetree-row[data-path="${rel}"]`);

async function rename(name: string) {
  await $('button[aria-label="Rename selected item"]').click();
  await $(".filetree-rename").waitForDisplayed();
  // clear()/setValue() can blur this field, and blur intentionally commits.
  await browser.keys([Key.Ctrl, "a"]);
  await browser.keys(name);
  await browser.keys(Key.Enter);
}

async function drag(
  from: string,
  to: string | null,
  side = 0.5,
  cancel = false,
  handle = ".filetree-name",
) {
  await row(from).scrollIntoView();
  const points = await browser.execute(
    (src, dst, fraction, handleSelector) => {
      const source = document.querySelector<HTMLElement>(`.filetree-row[data-path="${src}"]`)!;
      const body = document.querySelector<HTMLElement>(".filetree-body")!;
      const a = (source.querySelector(handleSelector) ?? source).getBoundingClientRect();
      const b =
        dst === null
          ? body.getBoundingClientRect()
          : document
              .querySelector<HTMLElement>(`.filetree-row[data-path="${dst}"]`)!
              .getBoundingClientRect();
      return {
        start: { x: Math.round(a.left + a.width * 0.6), y: Math.round(a.top + a.height / 2) },
        end: {
          x: Math.round(b.left + b.width * 0.6),
          y: Math.round(dst === null ? b.bottom - 12 : b.top + b.height * fraction),
        },
      };
    },
    from,
    to,
    side,
    handle,
  );
  await browser
    .action("pointer", { id: "sidebar-drag", parameters: { pointerType: "mouse" } })
    .move({ ...points.start, duration: 0 })
    .down({ button: 0 })
    .move({ x: points.start.x + 8, y: points.start.y, duration: 100 })
    .move({ ...points.end, duration: 200 })
    .perform(true);
  if (cancel) await browser.keys(Key.Escape);
  await browser
    .action("pointer", { id: "sidebar-drag", parameters: { pointerType: "mouse" } })
    .up({ button: 0 })
    .perform();
}

describe("Sidebar file and folder editing (T-127)", () => {
  it("renames a folder and a note using the visible button, preserving their contents", async () => {
    await $(".filetree").waitForDisplayed({ timeout: 15000 });
    fs.mkdirSync(file("Projects/Nested"), { recursive: true });
    fs.mkdirSync(file("Archive"), { recursive: true });
    fs.writeFileSync(file("Projects/Nested/Readme.md"), "Keep folder contents\n");
    fs.writeFileSync(file("Draft.md"), "Keep note contents\n");
    fs.writeFileSync(file("Collision.md"), "Root copy\n");
    fs.writeFileSync(file("Archive/Collision.md"), "Archive copy\n");
    await row("Projects").waitForDisplayed();
    await row("Projects").click();
    await rename("Research");
    await row("Research").waitForDisplayed();
    expect(fs.readFileSync(file("Research/Nested/Readme.md"), "utf8")).toBe(
      "Keep folder contents\n",
    );
    expect(fs.existsSync(file("Projects"))).toBe(false);
    await row("Draft.md").click();
    await expect($('input[aria-label="Note title"]')).toHaveValue("Draft");
    await $(".cm-content").waitForDisplayed();
    await rename("Plan");
    await row("Plan.md").waitForDisplayed();
    expect(fs.readFileSync(file("Plan.md"), "utf8")).toBe("Keep note contents\n");
    await expect($('input[aria-label="Note title"]')).toHaveValue("Plan");
  });

  it("drags files and folders into a folder, then moves a file back to the top level", async () => {
    await drag("Plan.md", "Archive");
    await browser.waitUntil(() => fs.existsSync(file("Archive/Plan.md")));
    await drag("Research", "Archive");
    await browser.waitUntil(() => fs.existsSync(file("Archive/Research/Nested/Readme.md")));
    if ((await row("Archive").getAttribute("aria-expanded")) !== "true")
      await row("Archive").click();
    await row("Archive/Plan.md").waitForDisplayed();
    await drag("Archive/Plan.md", null);
    await browser.waitUntil(() => fs.existsSync(file("Plan.md")));
    expect(fs.readFileSync(file("Plan.md"), "utf8")).toBe("Keep note contents\n");
    expect(fs.existsSync(file("Archive/Plan.md"))).toBe(false);
  });

  it("reorders at a row edge, cancels with Escape, and refuses to overwrite a duplicate", async () => {
    await drag("Plan.md", "Collision.md", 0.15);
    await browser.waitUntil(() => {
      const config = JSON.parse(fs.readFileSync(file(".axisnotes/config.json"), "utf8"));
      const names: string[] = config.fileOrder?.[""] ?? [];
      return (
        names.indexOf("Plan.md") >= 0 && names.indexOf("Plan.md") < names.indexOf("Collision.md")
      );
    });
    await drag("Plan.md", "Archive", 0.5, true);
    expect(fs.existsSync(file("Plan.md"))).toBe(true);
    expect(fs.existsSync(file("Archive/Plan.md"))).toBe(false);
    await drag("Collision.md", "Archive");
    await $('[role="alert"]').waitForDisplayed();
    expect(fs.readFileSync(file("Collision.md"), "utf8")).toBe("Root copy\n");
    expect(fs.readFileSync(file("Archive/Collision.md"), "utf8")).toBe("Archive copy\n");
    const dir = path.resolve(".agents/qa/T-127");
    fs.mkdirSync(dir, { recursive: true });
    await browser.saveScreenshot(path.join(dir, "sidebar-rename-and-drag.png"));
  });

  it("drags names and icons at regional zoom and uses the explicit vault-root target", async () => {
    fs.mkdirSync(file("00 Destination"), { recursive: true });
    fs.mkdirSync(file("00 Source/Nested"), { recursive: true });
    fs.writeFileSync(file("00 Source/Nested/Keep.md"), "Folder contents\n");
    fs.writeFileSync(file("Move me.md"), "Move this note\n");
    await row("Move me.md").waitForDisplayed();
    try {
      await browser.execute(() => {
        for (let i = 0; i < 2; i++)
          document.querySelector(".filetree-body")!.dispatchEvent(
            new WheelEvent("wheel", {
              ctrlKey: true,
              deltaY: -100,
              bubbles: true,
              cancelable: true,
            }),
          );
      });
      await browser.waitUntil(async () =>
        browser.execute(
          () => getComputedStyle(document.querySelector(".filetree-body")!).zoom === "1.25",
        ),
      );
      await drag("Move me.md", "00 Destination");
      await browser.waitUntil(() => fs.existsSync(file("00 Destination/Move me.md")));
      await drag("00 Source", "00 Destination", 0.5, false, ".filetree-icon");
      await browser.waitUntil(() => fs.existsSync(file("00 Destination/00 Source/Nested/Keep.md")));
      if ((await row("00 Destination").getAttribute("aria-expanded")) !== "true")
        await row("00 Destination").click();
      const source = row("00 Destination/Move me.md");
      await source.scrollIntoView();
      const r = await browser.execute(() => {
        const rect = document
          .querySelector('.filetree-row[data-path="00 Destination/Move me.md"]')!
          .getBoundingClientRect();
        return { x: rect.left, y: rect.top };
      });
      await browser
        .action("pointer", { id: "sidebar-drag", parameters: { pointerType: "mouse" } })
        .move({ x: Math.round(r.x + 80), y: Math.round(r.y + 12), duration: 0 })
        .down({ button: 0 })
        .move({ x: Math.round(r.x + 90), y: Math.round(r.y + 12), duration: 100 })
        .perform(true);
      await $(".filetree-root-drop").waitForDisplayed();
      await expect($(".filetree-ghost")).toHaveText("Move me");
      const target = await browser.execute(() => {
        const rect = document.querySelector(".filetree-root-drop")!.getBoundingClientRect();
        return { x: rect.left, y: rect.top };
      });
      await browser
        .action("pointer", { id: "sidebar-drag", parameters: { pointerType: "mouse" } })
        .move({ x: Math.round(target.x + 80), y: Math.round(target.y + 14), duration: 200 })
        .perform(true);
      await expect($(".filetree-root-drop")).toHaveElementClass("drop-target");
      const dir = path.resolve(".agents/qa/T-130");
      fs.mkdirSync(dir, { recursive: true });
      await browser.saveScreenshot(path.join(dir, "sidebar-root-drop-zoom.png"));
      await browser
        .action("pointer", { id: "sidebar-drag", parameters: { pointerType: "mouse" } })
        .up({ button: 0 })
        .perform();
      await browser.waitUntil(() => fs.existsSync(file("Move me.md")));
      expect(fs.readFileSync(file("Move me.md"), "utf8")).toBe("Move this note\n");
      expect(fs.readFileSync(file("00 Destination/00 Source/Nested/Keep.md"), "utf8")).toBe(
        "Folder contents\n",
      );
    } finally {
      await browser.keys(Key.Escape);
      await browser
        .action("pointer", { id: "sidebar-drag", parameters: { pointerType: "mouse" } })
        .up({ button: 0 })
        .perform();
      await browser.keys([Key.Ctrl, "0"]);
    }
  });

  it("keeps scrolling a long tree while the dragged pointer rests near the edge", async () => {
    for (let i = 0; i < 75; i++) {
      fs.mkdirSync(file("Scrolling"), { recursive: true });
      fs.writeFileSync(file(`Scrolling/Note ${String(i).padStart(2, "0")}.md`), `Note ${i}\n`);
    }
    await row("Scrolling").waitForDisplayed();
    await row("Scrolling").click();
    await row("Scrolling/Note 00.md").scrollIntoView();
    const points = await browser.execute(() => {
      const source = document
        .querySelector<HTMLElement>(
          '.filetree-row[data-path="Scrolling/Note 00.md"] .filetree-name',
        )!
        .getBoundingClientRect();
      const body = document.querySelector<HTMLElement>(".filetree-body")!.getBoundingClientRect();
      return {
        start: { x: Math.round(source.left + 12), y: Math.round(source.top + source.height / 2) },
        end: { x: Math.round(body.left + 80), y: Math.round(body.bottom - 8) },
      };
    });
    try {
      await browser
        .action("pointer", { id: "sidebar-drag", parameters: { pointerType: "mouse" } })
        .move({ ...points.start, duration: 0 })
        .down({ button: 0 })
        .move({ ...points.end, duration: 200 })
        .perform(true);
      const initial = await browser.execute(
        () => document.querySelector<HTMLElement>(".filetree-body")!.scrollTop,
      );
      await browser.waitUntil(
        async () =>
          (await browser.execute(
            () => document.querySelector<HTMLElement>(".filetree-body")!.scrollTop,
          )) >
          initial + 100,
        { timeout: 3000, timeoutMsg: "The held drag stopped scrolling at the sidebar edge" },
      );
    } finally {
      await browser.keys(Key.Escape);
      await browser
        .action("pointer", { id: "sidebar-drag", parameters: { pointerType: "mouse" } })
        .up({ button: 0 })
        .perform();
    }
    expect(fs.readFileSync(file("Scrolling/Note 00.md"), "utf8")).toBe("Note 0\n");
  });
});
