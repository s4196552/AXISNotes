import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// T-074 on the real app: closing the window saves every open note first, and stays open
// (naming the note) while one can't be saved. The window's close button can't be clicked
// through WebDriver, so this sends the same event Tauri sends when it is clicked.

const vault = process.env.AXIS_E2E_VAULT!;
const welcome = path.join(vault, "Welcome.md");
const onDisk = () => fs.readFileSync(welcome, "utf8");
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "close");

async function requestClose() {
  await browser.execute(() => {
    type Invoke = (cmd: string, args: object) => Promise<unknown>;
    const { invoke } = (window as unknown as { __TAURI_INTERNALS__: { invoke: Invoke } })
      .__TAURI_INTERNALS__;
    void invoke("plugin:event|emit", { event: "tauri://close-requested", payload: null });
  });
}

describe("Closing the window", () => {
  it("stays open over a note with an unresolved conflict, naming it", async () => {
    await $('[data-path="Welcome.md"]').click();
    await browser.waitUntil(async () => (await $(".cm-content").getText()).includes("Hello"));
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys(" mine");
    fs.writeFileSync(welcome, "# Welcome\n\ntheirs\n");
    await expect($(".editor-banner")).toHaveText(expect.stringContaining("changed on disk"));

    await requestClose();
    const error = $('.statusbar [role="alert"]');
    await expect(error).toHaveText(
      expect.stringContaining("Not closed, so no edits are lost. Unsaved changes in “Welcome”"),
    );
    expect(onDisk()).toBe("# Welcome\n\ntheirs\n");
    await expect($(".cm-content")).toHaveText(expect.stringContaining("mine"));
    fs.mkdirSync(QA_DIR, { recursive: true });
    await browser.saveScreenshot(path.join(QA_DIR, "close-refused.png"));
  });

  it("saves an edit still waiting for autosave, then closes", async () => {
    await $(".editor-banner").$("button=Keep my version").click();
    await browser.waitUntil(() => onDisk().includes("mine"));
    // Closing again right after a refusal still saves everything it can first.
    await $(".cm-content").click();
    await browser.keys(" more");
    await requestClose();
    await browser.waitUntil(() => onDisk().includes("mine more"), {
      timeoutMsg: "the edit never reached the disk",
    });
    // …and the window really closed (closing needs `core:window:allow-destroy`).
    await browser.waitUntil(
      async () => {
        try {
          await browser.getTitle();
          return false;
        } catch {
          return true;
        }
      },
      { timeoutMsg: "the window stayed open" },
    );
  });
});
