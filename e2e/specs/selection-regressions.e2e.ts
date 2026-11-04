import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const vault = process.env.AXIS_E2E_VAULT!;
const file = (name: string) => path.join(vault, ...name.split("/"));
const row = (name: string) => $(`[data-path="${name}"]`);
const embed = "![[selection.svg|160]]";
const original = `Intro\n\n${embed}\n\nOutro\n`;

async function chord(key: string) {
  await browser.action("key").down(Key.Ctrl).down(key).up(key).up(Key.Ctrl).perform();
}

async function open(name: string) {
  await row(name).waitForDisplayed();
  await row(name).click();
  await $(".editor-status").waitForDisplayed();
  await browser.waitUntil(async () => (await $(".editor-status").getText()) === "Saved");
}

async function screenshot(name: string) {
  const dir = path.resolve(".agents/qa/T-160");
  fs.mkdirSync(dir, { recursive: true });
  await browser.saveScreenshot(path.join(dir, name));
}

describe("Selected images and selected folders (T-159 release regressions)", () => {
  before(async () => {
    await $(".filetree").waitForExist({ timeout: 15000 });
    fs.writeFileSync(
      file("selection.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#3483eb"/></svg>',
    );
    fs.writeFileSync(file("Image copy.md"), original);
    fs.writeFileSync(file("Image cut.md"), original);
    for (const [name, text] of Object.entries({
      "Selection A/One.md": "one",
      "Selection A/Two.md": "two",
      "Selection B/Other.md": "other",
    })) {
      fs.mkdirSync(path.dirname(file(name)), { recursive: true });
      fs.writeFileSync(file(name), text);
    }
  });

  it("copies the selected image with Ctrl+C while the text cursor is elsewhere", async () => {
    await open("Image copy.md");
    await $(".cm-image-frame").click();
    await $(".cm-image-selected").waitForDisplayed();
    await chord("c");
    await $(".cm-image-selected").waitForDisplayed();
    await chord(Key.End);
    await browser.keys(Key.Enter);
    await chord("v");
    await browser.waitUntil(
      () => fs.readFileSync(file("Image copy.md"), "utf8").split(embed).length === 3,
    );
    expect(fs.readFileSync(file("Image copy.md"), "utf8").split("Intro")).toHaveLength(2);
    await screenshot("image-copy.png");
  });

  it("cuts the selected image with Ctrl+X and restores it with Undo", async () => {
    await open("Image cut.md");
    await $(".cm-image-frame").click();
    await $(".cm-image-selected").waitForDisplayed();
    await chord("x");
    await browser.waitUntil(
      () => fs.readFileSync(file("Image cut.md"), "utf8") === "Intro\n\nOutro\n",
    );
    await chord("z");
    await browser.waitUntil(() => fs.readFileSync(file("Image cut.md"), "utf8") === original);
    await $(".cm-image-frame").waitForDisplayed();
  });

  it("moves the selected folder when the drag starts on its selected child", async () => {
    await row("Selection A").waitForDisplayed();
    await row("Selection A").click();
    await row("Selection A/Two.md").waitForDisplayed();
    await browser.action("key").down(Key.Shift).perform(true);
    await row("Selection A/Two.md").click();
    await browser.releaseActions();
    await expect(row("Selection A")).toHaveAttribute("aria-selected", "true");
    await expect(row("Selection A/One.md")).toHaveAttribute("aria-selected", "true");
    await expect(row("Selection A/Two.md")).toHaveAttribute("aria-selected", "true");

    await row("Selection A/One.md").dragAndDrop(await row("Selection B"), { duration: 700 });
    await browser.waitUntil(() => fs.existsSync(file("Selection B/Selection A/One.md")));
    expect(fs.readFileSync(file("Selection B/Selection A/One.md"), "utf8")).toBe("one");
    expect(fs.readFileSync(file("Selection B/Selection A/Two.md"), "utf8")).toBe("two");
    expect(fs.existsSync(file("Selection A"))).toBe(false);
    expect(fs.existsSync(file("Selection B/One.md"))).toBe(false);
    await screenshot("folder-move.png");
  });
});
