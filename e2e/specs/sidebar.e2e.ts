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

async function drag(from: string, to: string | null, side = 0.5, cancel = false) {
  await row(from).scrollIntoView();
  const points = await browser.execute(
    (src, dst, fraction) => {
      const source = document.querySelector<HTMLElement>(`.filetree-row[data-path="${src}"]`)!;
      const body = document.querySelector<HTMLElement>(".filetree-body")!;
      const a = source.getBoundingClientRect();
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
});
