import path from "node:path";
import fs from "node:fs";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// T-100–T-105 on the real app: the Home dashboard opens from the keyboard, task text shows
// its [[links]], quick add writes today's daily note, the layout is customized and saved
// to .axisnotes/config.json, a folder gets its own dashboard, and it all comes back after
// the front end reloads.

const vault = process.env.AXIS_E2E_VAULT!;
const today = process.env.AXIS_E2E_TODAY!;
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "T-105");
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) =>
  fs.existsSync(onDisk(rel)) ? fs.readFileSync(onDisk(rel), "utf8") : "";
const widget = (name: string) => $(`section.dashboard-widget[aria-label="${name}"]`);
const heading = () => $(".dashboard-heading h1");

async function snapshot(name: string) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await browser.saveScreenshot(path.join(QA_DIR, `${name}.png`));
}

async function openHome() {
  await browser.keys([Key.Ctrl, Key.Shift, "h"]);
  await browser.waitUntil(async () => (await heading().getText()) === "Home", {
    timeoutMsg: "Ctrl+Shift+H did not open Home",
  });
}

describe("Dashboards on the real app (T-105)", () => {
  it("opens Home and shows today's task with its link and formatting", async () => {
    await $(".filetree").waitForExist({ timeout: 15000 });
    await openHome();
    const tasks = widget("Today's tasks");
    await expect(tasks.$("button.inline-wikilink=Welcome")).toBeDisplayed();
    await expect(tasks.$("strong=now")).toExist();
    await expect(tasks).not.toHaveText(expect.stringContaining("[["));
    await snapshot("01-home");
  });

  it("quick-adds a task into today's daily note, creating it", async () => {
    const box = widget("Today's tasks").$('input[aria-label="Add a task"]');
    await box.setValue("Buy milk");
    await browser.keys(Key.Enter);
    const daily = `Daily/${today}.md`;
    await browser.waitUntil(() => read(daily).includes("- [ ] Buy milk"), {
      timeoutMsg: `the task was not written to ${daily}`,
    });
    await expect(widget("Today's tasks").$("span=Buy milk")).toBeDisplayed();
  });

  it("follows a [[link]] in a task to its note", async () => {
    await widget("Today's tasks").$("button.inline-wikilink=Welcome").click();
    await expect($(".editor-title")).toHaveText("Welcome");
    await openHome();
  });

  it("customizes the layout and saves it in the vault config", async () => {
    await $("button=Customize").click();
    await $('button[aria-label="Make Calendar wide"]').click();
    await $('button[aria-label="Move Pinned earlier"]').click();
    await widget("Pinned").$("button=Pin a file or folder").click();
    await $(".picker-input").setValue("Biology");
    await browser.keys(Key.Enter);
    await $("button=Done").click();
    await browser.waitUntil(
      () => {
        const config = read(".axisnotes/config.json");
        return config.includes('"size": "wide"') && config.includes('"School/Biology.md"');
      },
      { timeoutMsg: "the layout was not saved" },
    );
    await expect(widget("Calendar")).toHaveElementClass("wide");
    await snapshot("02-customized");
  });

  it("adds a dashboard to a folder from the file tree", async () => {
    await $('.filetree [data-path="School"]').click({ button: "right" });
    await $('[role="menuitem"]=Add dashboard').click();
    await browser.waitUntil(async () => (await heading().getText()) === "School");
    await expect(widget("Today's tasks").$("button.inline-wikilink=Welcome")).toBeDisplayed();
    await snapshot("03-folder");
  });

  it("brings the dashboards back after the front end reloads", async () => {
    await openHome();
    await browser.refresh();
    await $(".tabbar").waitForExist({ timeout: 15000 });
    await browser.waitUntil(
      async () => (await heading().isExisting()) && (await heading().getText()) === "Home",
      {
        timeout: 15000,
        timeoutMsg: "Home did not come back",
      },
    );
    await expect(widget("Calendar")).toHaveElementClass("wide");
    await expect(widget("Pinned").$('button[title="School/Biology.md"]')).toBeDisplayed();
    await snapshot("04-restored");
  });
});
