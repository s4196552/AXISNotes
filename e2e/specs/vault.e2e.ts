import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// Phase 0 acceptance: open a folder, create nested folders and notes, edit and save
// them, and see changes made in another program appear — on the real app and disk.

const vault = process.env.AXIS_E2E_VAULT!;
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) => fs.readFileSync(onDisk(rel), "utf8");
const row = (rel: string) => $(`[data-path="${rel}"]`);
const editorText = () => $(".cm-content").getText();

async function renameTo(name: string) {
  // The field starts with its text selected; type over it. (WebDriver's setValue/clear
  // blurs the field, and blur commits the rename.)
  await $(".filetree-rename").waitForDisplayed();
  await browser.keys([Key.Ctrl, "a"]);
  await browser.keys(name);
  await browser.keys(Key.Enter);
}

describe("AXIS desktop app on a real vault", () => {
  it("opens the vault from AXIS_OPEN_VAULT and lists its files", async () => {
    await expect(row("Welcome.md")).toBeDisplayed();
    await expect(row("School")).toBeDisplayed();
    await expect($(".sidebar-header")).toHaveText(path.basename(vault));
  });

  it("opens a note with live preview", async () => {
    await row("Welcome.md").click();
    await expect($(".editor-title")).toHaveText("Welcome");
    await browser.waitUntil(async () => (await editorText()).includes("Hello from disk"));
  });

  it("autosaves edits to the file on disk", async () => {
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys(" edited in AXIS");
    await browser.waitUntil(() => read("Welcome.md").includes("edited in AXIS"), {
      timeoutMsg: "edit never reached the disk",
    });
    await expect($(".editor-status")).toHaveText("Saved");
  });

  it("reloads a note edited by another program right after an autosave", async () => {
    fs.writeFileSync(onDisk("Welcome.md"), "# Welcome\n\nChanged in Notepad\n");
    await browser.waitUntil(async () => (await editorText()).includes("Changed in Notepad"), {
      timeoutMsg: "external edit did not appear",
    });
    await browser.pause(1000); // let any trailing watcher events arrive
    const banner = await $(".editor-banner");
    expect((await banner.isExisting()) ? await banner.getText() : "").toBe("");
  });

  it("handles an atomic save (temp file renamed over the note) by another editor", async () => {
    const tmp = onDisk(".Welcome.md.tmp-other-editor");
    fs.writeFileSync(tmp, "# Welcome\n\nSaved atomically elsewhere\n");
    fs.renameSync(tmp, onDisk("Welcome.md"));
    await browser.waitUntil(async () => (await editorText()).includes("Saved atomically"), {
      timeoutMsg: "atomic save did not appear",
    });
    await browser.pause(1000);
    const banner = await $(".editor-banner");
    expect((await banner.isExisting()) ? await banner.getText() : "").toBe("");
  });

  it("shows files created by another program", async () => {
    fs.writeFileSync(onDisk("From Outside.md"), "hi");
    await expect(row("From Outside.md")).toBeDisplayed();
  });

  it("creates nested folders and notes on disk", async () => {
    await row("School").click(); // select + expand
    await $('button[aria-label="New folder"]').click();
    await renameTo("Math");
    await browser.waitUntil(() => fs.existsSync(onDisk("School/Math")));

    await row("School/Math").click();
    await $('button[aria-label="New note"]').click();
    await renameTo("Calculus");
    await browser.waitUntil(() => fs.existsSync(onDisk("School/Math/Calculus.md")), {
      timeoutMsg: "nested note not created",
    });
    await expect($(".editor-title")).toHaveText("Calculus");

    await $(".cm-content").click();
    await browser.keys("# Limits");
    await browser.waitUntil(() => read("School/Math/Calculus.md") === "# Limits");
  });

  it("stays responsive on a 1 MB note", async () => {
    const para = "Some **bold** text, a [link](https://example.com), and `code`.\n\n";
    fs.writeFileSync(
      onDisk("Big.md"),
      "# Big\n\n" + para.repeat(Math.ceil(1_000_000 / para.length)),
    );
    await row("Big.md").click();
    await expect($(".editor-title")).toHaveText("Big");
    await $(".cm-content").click();

    const text = "typing speed check";
    const started = Date.now();
    await browser.keys(text);
    await browser.waitUntil(async () => (await $(".cm-content").getText()).includes(text));
    const perKeyMs = (Date.now() - started) / text.length;
    console.log(`1 MB note: ${perKeyMs.toFixed(1)} ms per keystroke (incl. WebDriver overhead)`);
    expect(perKeyMs).toBeLessThan(100);
    await browser.waitUntil(() => read("Big.md").includes(text), { timeout: 10_000 });
  });

  it("renames a note with F2 and keeps editing the renamed file", async () => {
    await row("School/Math/Calculus.md").click();
    await browser.keys(Key.F2);
    await renameTo("Calculus I");
    await browser.waitUntil(() => fs.existsSync(onDisk("School/Math/Calculus I.md")));
    expect(fs.existsSync(onDisk("School/Math/Calculus.md"))).toBe(false);
    await expect($(".editor-title")).toHaveText("Calculus I");
  });
});
