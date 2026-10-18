import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// Updates from a folder (T-066) on the real app. With AXIS_CONFIG_DIR set, the default
// updates folder is `<config>/updates`, so this never sees a real published update.

const updates = path.join(process.env.AXIS_CONFIG_DIR!, "updates");
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "updates");

function publish(version: string) {
  fs.mkdirSync(updates, { recursive: true });
  const file = `AXISNotes_${version}_x64-setup.exe`;
  const bytes = Buffer.from("not a real installer");
  fs.writeFileSync(path.join(updates, file), bytes);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  const platform = `${process.platform === "win32" ? "windows" : process.platform}-x86_64`;
  fs.writeFileSync(
    path.join(updates, "latest.json"),
    JSON.stringify({
      version,
      notes: "Updates from a folder",
      platforms: { [platform]: { file, sha256 } },
    }),
  );
}

async function command(label: string) {
  await browser.keys([Key.Ctrl, "p"]);
  await $('[role="combobox"][aria-label="Command palette"]').waitForDisplayed();
  await browser.keys(label);
  await browser.keys(Key.Enter);
}

describe("Updates from a folder", () => {
  it("finds nothing until a newer version is published", async () => {
    await $(".shell").waitForDisplayed();
    await command("Check for updates");
    await expect($('[role="dialog"][aria-label="Settings"] h2')).toHaveText("Updates");
    await expect($(".updates-status")).toHaveText("You have the latest version.");
    await expect($("input[aria-label='Updates folder']")).toHaveValue(updates);
  });

  it("offers a published version, on demand and at launch", async () => {
    publish("0.99.0");
    await $("button=Check for updates").click();
    await expect($(".updates-status")).toHaveText(
      expect.stringContaining("AXISNotes 0.99.0 is available."),
    );
    await expect($("button=Install 0.99.0 and restart")).toBeDisplayed();

    // A fresh start of the UI checks by itself and shows the banner.
    await browser.refresh();
    const banner = $('[role="region"][aria-label="Update available"]');
    await banner.waitForDisplayed();
    await expect(banner).toHaveText(expect.stringContaining("AXISNotes 0.99.0 is available."));
    fs.mkdirSync(QA_DIR, { recursive: true });
    await browser.saveScreenshot(path.join(QA_DIR, "banner.png"));

    // This E2E build is a development build, which refuses to install over the real app.
    await banner.$("button=Install and restart").click();
    await expect(banner.$('[role="alert"]')).toHaveText(
      expect.stringContaining("not a development build"),
    );
    await banner.$('button[aria-label="Later"]').click();
    await expect(banner).not.toBeDisplayed();
  });

  it("never installs over unsaved edits (T-073)", async () => {
    const welcome = path.join(process.env.AXIS_E2E_VAULT!, "Welcome.md");
    const onDisk = () => fs.readFileSync(welcome, "utf8");
    await browser.refresh();
    const banner = $('[role="region"][aria-label="Update available"]');
    await banner.waitForDisplayed();
    await $('[data-path="Welcome.md"]').click();
    await browser.waitUntil(async () => (await $(".cm-content").getText()).includes("Hello"));

    // An edit that collides with a change made in another program: a conflict banner.
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys(" mine");
    fs.writeFileSync(welcome, "# Welcome\n\ntheirs\n");
    await expect($(".editor-banner")).toHaveText(expect.stringContaining("changed on disk"));

    // Installing is refused, naming the note, and neither version is lost.
    await banner.$("button=Install and restart").click();
    await expect(banner.$('[role="alert"]')).toHaveText(
      expect.stringContaining("Unsaved changes in “Welcome” (changed on disk)"),
    );
    expect(onDisk()).toBe("# Welcome\n\ntheirs\n");
    await expect($(".cm-content")).toHaveText(expect.stringContaining("mine"));
    fs.mkdirSync(QA_DIR, { recursive: true });
    await browser.saveScreenshot(path.join(QA_DIR, "unsaved-conflict.png"));

    // Resolved, installing goes ahead — an edit still in the autosave delay is saved first.
    await $(".editor-banner").$("button=Keep my version").click();
    await browser.waitUntil(() => onDisk().includes("mine"));
    await $(".cm-content").click();
    await browser.keys(" more");
    await banner.$("button=Install and restart").click();
    // This development build refuses at the installer step, after the guard has passed.
    await expect(banner.$('[role="alert"]')).toHaveText(
      expect.stringContaining("not a development build"),
    );
    expect(onDisk()).toContain("mine more");
    await banner.$('button[aria-label="Later"]').click();
  });

  it("stays quiet at launch when checking is turned off", async () => {
    await command("Open settings");
    await $("nav[aria-label='Settings sections']").$("button=Updates").click();
    const box = $("input[aria-label='Check for updates when AXISNotes starts']");
    await box.click();
    await expect(box).not.toBeSelected();
    await browser.refresh();
    await $(".shell").waitForDisplayed();
    await browser.pause(1500);
    await expect($('[role="region"][aria-label="Update available"]')).not.toBeDisplayed();
  });
});
