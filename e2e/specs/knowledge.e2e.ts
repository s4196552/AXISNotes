import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// Phase 1 acceptance on the real app and disk: links, backlinks, mentions, properties,
// link-safe renames, search, tags, quick commands, switcher, daily notes, settings.

const vault = process.env.AXIS_E2E_VAULT!;
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) => fs.readFileSync(onDisk(rel), "utf8");
const row = (rel: string) => $(`[data-path="${rel}"]`);
const title = () => $(".editor-title");

/** Visual QA evidence for the phase checkpoint (gitignored). */
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "phase-1");
async function snapshot(name: string) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await browser.saveScreenshot(path.join(QA_DIR, `${name}.png`));
}

const until = (cond: () => boolean | Promise<boolean>, msg: string) =>
  browser.waitUntil(cond, { timeoutMsg: msg });

/** Wait until `actual()` equals `expected`, reporting the last actual value on timeout. */
async function untilEquals(actual: () => string, expected: string) {
  let last = "";
  try {
    await browser.waitUntil(() => (last = actual()) === expected);
  } catch {
    const editor = await $(".cm-content").getText();
    throw new Error(
      `expected ${JSON.stringify(expected)}, got ${JSON.stringify(last)}; editor shows ${JSON.stringify(editor)}`,
    );
  }
}

async function openNote(rel: string, name: string) {
  await row(rel).click();
  await expect(title()).toHaveText(name);
}

describe("Phase 1: knowledge features on a real vault", () => {
  it("follows a rendered wikilink to its heading", async () => {
    await openNote("Meeting.md", "Meeting");
    await $('[data-wikilink="Project Alpha#Goals"]').click();
    await expect(title()).toHaveText("Project Alpha");
    // The cursor lands on the heading line, so only that heading shows its raw `#` marks.
    await until(async () => {
      const text = await $(".cm-content").getText();
      return text.includes("## Goals") && !text.includes("# Project Alpha");
    }, "did not jump to #Goals");
  });

  it("lists backlinks and links an unlinked mention on disk", async () => {
    const linked = $('[aria-label="Linked mentions"]');
    await expect(linked).toHaveText(expect.stringContaining("Discussed [[Project Alpha#Goals]]"));
    const unlinked = $('[aria-label="Unlinked mentions"]');
    await expect(unlinked).toHaveText(expect.stringContaining("project alpha is late."));
    await unlinked.$("button=Link").click();
    await until(
      () => read("Meeting.md").includes("[[Project Alpha|project alpha]] is late."),
      "mention not linked",
    );
    await snapshot("01-note-links-backlinks-properties");
  });

  it("edits a property through the properties panel", async () => {
    const status = $('[aria-label="Value of status"]');
    await expect(status).toHaveValue("draft");
    await status.click();
    await browser.keys([Key.Ctrl, "a"]);
    await browser.keys(["done", Key.Tab]);
    await until(() => read("Project Alpha.md").includes("status: done"), "property not saved");
    expect(read("Project Alpha.md")).toContain("aliases: [PA]");
  });

  it("rewrites links in other notes when a note is renamed", async () => {
    await row("Project Alpha.md").click();
    await browser.keys(Key.F2);
    const input = $(".filetree-rename");
    await input.waitForDisplayed();
    await browser.keys([Key.Ctrl, "a"]);
    await browser.keys(["Project Apollo", Key.Enter]);
    await until(() => fs.existsSync(onDisk("Project Apollo.md")), "rename failed");
    await until(
      () =>
        read("Meeting.md").includes("[[Project Apollo#Goals]]") &&
        read("Meeting.md").includes("[[Project Apollo|project alpha]]"),
      "links were not rewritten",
    );
    await expect(title()).toHaveText("Project Apollo");
  });

  it("creates a missing note by clicking its link", async () => {
    await openNote("Meeting.md", "Meeting");
    await $('[data-wikilink="Budget"]').click();
    await expect(title()).toHaveText("Budget");
    expect(fs.existsSync(onDisk("Budget.md"))).toBe(true);
  });

  it("runs / commands and [[ autocomplete in the editor", async () => {
    await $(".cm-content").click();
    // CodeMirror ignores Enter for ~75 ms after the popup opens (interactionDelay).
    const accept = async () => {
      await $(".cm-tooltip-autocomplete").waitForDisplayed();
      await browser.pause(150);
      await browser.keys(Key.Enter);
    };
    await browser.keys("/h2");
    await accept();
    await browser.keys(["Costs", Key.Enter, "[[Cel"]);
    await accept();
    await untilEquals(() => read("Budget.md"), "## Costs\n[[Cells]]");
  });

  it("searches full text and by tag", async () => {
    await $('[role="tab"][aria-label="Search"]').click();
    const box = $('input[aria-label="Search notes"]');
    await box.setValue("mitochondria");
    const results = $('[aria-label="Search results"]');
    await expect(results).toHaveText(expect.stringContaining("Cells"));
    await expect(results.$("mark")).toHaveText("mitochondria");

    await openNoteFromResults(results);
    await $('[data-tag="biology"]').click();
    await expect(box).toHaveValue("tag:biology");
    await expect(results).toHaveText(expect.stringContaining("Cells"));
    await snapshot("02-tag-search");
  });

  it("opens notes with the quick switcher (Ctrl+O)", async () => {
    await browser.keys([Key.Ctrl, "o"]);
    const input = $('[role="combobox"][aria-label="Quick switcher"]');
    await input.waitForDisplayed();
    await browser.keys("pa"); // alias of Project Apollo
    await browser.keys(Key.Enter);
    await expect(title()).toHaveText("Project Apollo");
  });

  it("creates today's daily note (Ctrl+Shift+D)", async () => {
    await browser.keys([Key.Ctrl, Key.Shift, "d"]);
    const today = new Date();
    const name = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    await until(() => fs.existsSync(onDisk(`Daily/${name}.md`)), "daily note not created");
    await expect(title()).toHaveText(name);
  });

  it("switches the theme from settings and saves it to .axisnotes/config.json", async () => {
    await $('button[aria-label="Settings"]').click();
    await $('select[aria-label="Theme"]').selectByAttribute("value", "dark");
    await until(
      async () => (await browser.execute(() => document.documentElement.dataset.theme)) === "dark",
      "theme not applied",
    );
    await until(
      () => read(".axisnotes/config.json").includes('"theme": "dark"'),
      "config not saved",
    );
    await snapshot("03-settings-dark");
    await browser.keys(Key.Escape);
    await snapshot("04-app-dark");
  });
});

async function openNoteFromResults(results: ReturnType<typeof $>) {
  await results.$("button").click();
  await expect(title()).toHaveText("Cells");
}
