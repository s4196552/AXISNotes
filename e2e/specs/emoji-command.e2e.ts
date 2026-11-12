import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

describe("Emoji command", () => {
  it("opens on a colon, filters by keyword and inserts the selected emoji", async () => {
    const note = path.join(process.env.AXIS_E2E_VAULT!, "Emoji.md");
    await $(".filetree").waitForDisplayed();
    fs.writeFileSync(note, "");
    const row = $('[data-path="Emoji.md"]');
    await row.waitForDisplayed();
    await row.click();
    await $('.cm-content[aria-label="Note Emoji"]').click();

    await browser.keys(":");
    const menu = $(".cm-tooltip-autocomplete");
    await menu.waitForDisplayed();
    await browser.keys("rocket");
    await menu.$(".cm-completionLabel*=rocket").click();
    await browser.waitUntil(() => fs.readFileSync(note, "utf8") === "🚀");

    await browser.keys(" at 10:30");
    await browser.waitUntil(() => fs.readFileSync(note, "utf8") === "🚀 at 10:30");
    await expect(menu).not.toExist();

    await browser.keys(Key.Enter);
    await browser.keys("::status");
    await menu.$(".cm-completionLabel=status").click();
    await browser.waitUntil(() => fs.readFileSync(note, "utf8") === "🚀 at 10:30\nstatus:: ");
  });
});
