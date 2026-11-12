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

  it("inserts built-in and vault-pack icons and renders them after reopening", async () => {
    const vault = process.env.AXIS_E2E_VAULT!;
    const note = path.join(vault, "Icons.md");
    const source = path.join(process.env.AXIS_CONFIG_DIR!, "Orbit Badge.svg");
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#347fff"/></svg>';
    fs.writeFileSync(source, svg);
    fs.writeFileSync(note, "");
    // Exercise the same native import the Add icon action uses with the file path
    // that the operating system dialog would return.
    const imported = await browser.executeAsync((file: string, done: (result: unknown) => void) => {
      const bridge = (
        window as unknown as {
          __TAURI_INTERNALS__: { invoke(command: string, args: unknown): Promise<unknown> };
        }
      ).__TAURI_INTERNALS__;
      bridge
        .invoke("import_image", { source: file, folder: ".axisnotes/packs/icons/My icons" })
        .then(done, (error) => done({ error }));
    }, source);
    expect(imported).toMatchObject({ path: ".axisnotes/packs/icons/My icons/Orbit Badge.svg" });
    await browser.refresh();
    const row = $('[data-path="Icons.md"]');
    await row.waitForDisplayed();
    await row.click();
    const editor = $('.cm-content[aria-label="Note Icons"]');
    await editor.click();
    const menu = $(".cm-tooltip-autocomplete");

    await browser.keys(":rocket");
    await menu.$(".cm-completionLabel=rocket").click();
    await browser.waitUntil(() => fs.readFileSync(note, "utf8").includes("lucide:Rocket"));
    await expect(editor.$(".cm-inline-note-icon svg")).toExist();

    await browser.keys(" :");
    await menu.$(".cm-completionLabel=Add icon…").waitForDisplayed();
    const savedIcon = path.join(
      vault,
      ".axisnotes",
      "packs",
      "icons",
      "My icons",
      "Orbit Badge.svg",
    );
    await browser.waitUntil(() => fs.existsSync(savedIcon));
    expect(fs.readFileSync(savedIcon, "utf8")).toBe(svg);
    await menu.$(".cm-completionLabel=Orbit Badge").waitForDisplayed();
    await browser.keys("orbit");
    await menu.$(".cm-completionLabel=Orbit Badge").click();
    await browser.waitUntil(() =>
      fs.readFileSync(note, "utf8").includes("/My%20icons/Orbit%20Badge.svg"),
    );

    await browser.refresh();
    await row.waitForDisplayed();
    await row.click();
    await browser.waitUntil(() =>
      browser.execute(() => {
        const img = document.querySelector<HTMLImageElement>(
          '.cm-inline-note-icon img[alt="Orbit Badge"]',
        );
        return Boolean(img?.complete && img.naturalWidth > 0);
      }),
    );
    await expect($(".cm-inline-note-icon svg")).toExist();
  });
});
