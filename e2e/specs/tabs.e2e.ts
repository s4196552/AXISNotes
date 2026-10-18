import path from "node:path";
import fs from "node:fs";
import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// T-085 on the real app: notes open in tabs, the keyboard moves between them, renames
// follow, and the tabs (with a pinned one) come back after the front end reloads.

const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "T-085");
const row = (rel: string) => $(`.filetree [data-path="${rel}"]`);
const tab = (rel: string) => $(`.tabbar [role="tab"][data-path="${rel}"]`);
const tabTitles = async () =>
  Promise.all(await $$(".tabbar [role='tab'] .tab-title").map((t) => t.getText()));
const activeTitle = () => $(".tabbar [role='tab'][aria-selected='true'] .tab-title").getText();

async function snapshot(name: string) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await browser.saveScreenshot(path.join(QA_DIR, `${name}.png`));
}

async function renameTo(name: string) {
  await $(".filetree-rename").waitForDisplayed();
  await browser.keys([Key.Ctrl, "a"]);
  await browser.keys(name);
  await browser.keys(Key.Enter);
}

describe("Tabs on the real app (T-085)", () => {
  it("opens notes in the active tab, and in a new tab with a middle-click", async () => {
    await expect(row("Welcome.md")).toBeDisplayed();
    await row("Welcome.md").click();
    await expect($(".editor-title")).toHaveText("Welcome");
    expect(await tabTitles()).toEqual(["Welcome"]);

    await row("School").click();
    await row("School/Biology.md").click({ button: "middle" });
    await browser.waitUntil(async () => (await tabTitles()).length === 2, {
      timeoutMsg: "middle-click did not open a tab",
    });
    expect(await tabTitles()).toEqual(["Welcome", "Biology"]);
    expect(await activeTitle()).toBe("Biology");
    await expect($(".editor-title")).toHaveText("Biology");
    await snapshot("01-two-tabs");
  });

  it("switches, opens and closes tabs from the keyboard", async () => {
    await browser.keys([Key.Ctrl, Key.Tab]);
    await browser.waitUntil(async () => (await activeTitle()) === "Welcome");
    await expect($(".editor-title")).toHaveText("Welcome");

    await browser.keys([Key.Ctrl, "t"]);
    await browser.waitUntil(async () => (await tabTitles()).length === 3);
    expect(await activeTitle()).toBe("New tab");
    await expect($(".new-tab")).toBeDisplayed();

    await browser.keys([Key.Ctrl, "w"]);
    await browser.waitUntil(async () => (await tabTitles()).length === 2);
    await browser.keys([Key.Ctrl, "2"]);
    await browser.waitUntil(async () => (await activeTitle()) === "Biology");
  });

  it("follows a rename in the file tree", async () => {
    await row("School/Biology.md").click();
    await browser.keys(Key.F2);
    await renameTo("Cells");
    await row("School/Cells.md").waitForExist();
    await browser.waitUntil(async () => (await tabTitles()).includes("Cells"), {
      timeoutMsg: "the tab kept the old name",
    });
    await expect($(".editor-title")).toHaveText("Cells");
  });

  it("pins a tab from its menu", async () => {
    const welcome = tab("Welcome.md");
    await welcome.click({ button: "right" });
    await $(".tab-menu").$("button=Pin").click();
    await expect(welcome.$("button[aria-label='Unpin Welcome']")).toExist();
    await snapshot("02-pinned");
  });

  it("brings the tabs back when the app reloads", async () => {
    await tab("School/Cells.md").click();
    await browser.waitUntil(async () => (await activeTitle()) === "Cells");
    await browser.pause(300);

    // Reload the whole front end (store included). A new WebDriver session can't stand in
    // for an app restart here: each session gets a fresh WebView2 profile, so local storage
    // starts empty, unlike a real restart.
    await browser.refresh();

    await $(".tabbar").waitForExist({ timeout: 15000 });
    await browser.waitUntil(async () => (await tabTitles()).length === 2, {
      timeout: 10000,
      timeoutMsg: "tabs were not restored",
    });
    expect(await tabTitles()).toEqual(["Welcome", "Cells"]);
    expect(await activeTitle()).toBe("Cells");
    await expect($(".editor-title")).toHaveText("Cells");
    await expect($("button[aria-label='Unpin Welcome']")).toExist();
    await snapshot("03-restored");
  });
});
