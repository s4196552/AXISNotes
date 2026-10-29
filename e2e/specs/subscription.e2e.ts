import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";

// Native settings and IPC checks only. Never authorize a real account in automation.
describe("ChatGPT plan connection on the desktop app", () => {
  it("offers subscription sign-in without an API key or editable endpoint", async () => {
    await $('[aria-label="Settings"]').click();
    await $("button=AI").click();
    await $('select[aria-label="Provider type"]').selectByAttribute("value", "chatgpt");
    await $("button*=Add provider").click();
    const card = $('[aria-label="Provider ChatGPT plan (Plus / Pro)"]');
    await card.waitForDisplayed();
    await expect(card.$("button=Continue with ChatGPT")).toBeDisplayed();
    await expect(card.$("button=Manage usage")).toBeDisplayed();
    await expect(card.$("input[type=password]")).not.toExist();
    await expect(card.$('input[aria-label^="Endpoint"]')).not.toExist();
    await expect(card).toHaveText(expect.stringContaining("never switches to a paid API key"));
    const dir = path.resolve(".agents/qa/T-141");
    fs.mkdirSync(dir, { recursive: true });
    await browser.saveScreenshot(path.join(dir, "subscription-settings.png"));
    await card.$("button*=Test connection").click();
    await expect(card).toHaveText(expect.stringContaining("Connect your ChatGPT plan"));
  });
});
