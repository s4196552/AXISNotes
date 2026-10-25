import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const vault = process.env.AXIS_E2E_VAULT!;
const file = (name: string) => path.join(vault, name);
const row = (name: string) => $(`.filetree-row[data-path="${name}"]`);

async function openMenu() {
  await browser.keys([Key.Ctrl, "/"]);
  await browser.keys(Key.Ctrl);
  await $(".cm-tooltip-autocomplete").waitForDisplayed();
  await expect($(".cm-commandIcon svg")).toBeDisplayed();
}

async function choose(query: string) {
  await browser.keys(query);
  // CodeMirror intentionally ignores accept keys during its initial interaction delay.
  await browser.pause(150);
  await browser.keys(Key.Enter);
}

describe("Command-menu native crash regression (T-131)", () => {
  it("opens Ctrl+/ on a dirty note and saves the command result", async () => {
    await row("Welcome.md").waitForDisplayed({ timeout: 15000 });
    await row("Welcome.md").click();
    await $(".cm-content").waitForDisplayed();
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys([Key.Enter, "Before command"]);
    await openMenu();
    await choose("h2");
    await browser.keys("After command");
    await browser.waitUntil(() =>
      fs.readFileSync(file("Welcome.md"), "utf8").includes("Before command\n## After command"),
    );
  });

  it("indexes a Unicode filename and links, then runs Ctrl+/ and continues saving", async () => {
    const result = await browser.executeAsync((done: (result: string) => void) => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: { invoke(command: string, args: object): Promise<unknown> };
      };
      void host.__TAURI_INTERNALS__
        .invoke("create_file", {
          path: "😀é.md",
          content: "# Unicode\n\nKeep this note and [[📚]]\n",
        })
        .then(
          () => done("created"),
          (error: unknown) => done(JSON.stringify(error)),
        );
    });
    expect(result).toBe("created");
    // Direct IPC bypasses the normal UI caller's refreshTree; the backend suppresses
    // its own watcher echo. An external change exercises the real refresh path.
    fs.writeFileSync(file("Refresh.md"), "# Refresh\n");
    await row("😀é.md").waitForDisplayed();
    await row("😀é.md").click();
    await expect($('input[aria-label="Note title"]')).toHaveValue("😀é");
    await $(".cm-content").waitForDisplayed();
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys([Key.Enter, "Saved before menu"]);
    await openMenu();
    await choose("task");
    await browser.keys("Keep studying");
    await browser.waitUntil(() =>
      fs.readFileSync(file("😀é.md"), "utf8").includes("- [ ] Keep studying"),
    );
    expect(fs.readFileSync(file("😀é.md"), "utf8")).toContain("Keep this note and [[📚]]");
  });

  it("survives a Unicode attachment watcher event and repeated command-menu use", async () => {
    fs.writeFileSync(file("😀.png"), "not an indexed document");
    await row("😀.png").waitForDisplayed();
    await $(".cm-content").click();
    for (let i = 0; i < 4; i++) {
      await openMenu();
      await browser.keys(Key.Escape);
    }
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys([Key.Enter, "Still saving after commands"]);
    await browser.waitUntil(() =>
      fs.readFileSync(file("😀é.md"), "utf8").includes("Still saving after commands"),
    );
    await browser.keys([Key.Ctrl, "p"]);
    await expect($('[role="dialog"][aria-label="Command palette"]')).toBeDisplayed();
    await browser.keys(Key.Escape);
    const dir = path.resolve(".agents/qa/T-131");
    fs.mkdirSync(dir, { recursive: true });
    await browser.saveScreenshot(path.join(dir, "commands-and-unicode-save.png"));
  });
});
