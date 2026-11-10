import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const fold = () => browser.keys([Key.Ctrl, "q"]);
const row = (name: string) => $(`.filetree [data-path="${name}"]`);
const vaultFile = (name: string) => path.join(process.env.AXIS_E2E_VAULT!, name);

describe("Ctrl+Q in notes and sidebars", () => {
  const source =
    "# Biology\n\n> [!toggle]+ Embedded title\n> Embedded text ^cells\n\nOther material";
  const host = [
    "# Welcome",
    "- Parent\n  - Child item",
    "![[School/Biology#^cells]]",
    "![[Welcome#^local]]",
    "> [!toggle]- Mirror title\n> Mirror body ^local",
  ].join("\n\n");
  before(() => {
    fs.writeFileSync(vaultFile("Welcome.md"), host);
    fs.writeFileSync(vaultFile("School/Biology.md"), source);
  });

  it("folds a nested list from its child and persists a toggle in the focused embed", async () => {
    await row("Welcome.md").click();
    const child = $(".cm-line*=Child item");
    await child.click();
    await fold();
    await expect(child).not.toExist();
    await fold();
    await expect(child).toBeDisplayed();

    const inside = $(".cm-embed-body").$(".cm-line*=Embedded text");
    await inside.click();
    await fold();
    await expect(inside).not.toExist();
    await browser.waitUntil(() =>
      fs.readFileSync(vaultFile("School/Biology.md"), "utf8").includes("[!toggle]-"),
    );
    await fold();
    await expect(inside).toBeDisplayed();
    await browser.waitUntil(
      () => fs.readFileSync(vaultFile("School/Biology.md"), "utf8") === source,
    );
    const mirror = $('.cm-content[aria-label="Embedded Welcome#^local"]');
    const mirroredBody = mirror.$(".cm-line*=Mirror body");
    await mirror.$(".cm-line*=Mirror title").click();
    await fold();
    await expect(mirroredBody).toBeDisplayed();
    await fold();
    await expect(mirroredBody).not.toExist();
    expect(fs.readFileSync(vaultFile("Welcome.md"), "utf8")).toBe(host);
  });

  it("reopens the same folder and sidebar section on a second press", async () => {
    const folder = row("School");
    await folder.click();
    const expanded = (await folder.getAttribute("aria-expanded")) === "true";
    await fold();
    await expect(folder).toHaveAttribute("aria-expanded", String(!expanded));
    await fold();
    await expect(folder).toHaveAttribute("aria-expanded", String(expanded));

    const outline = $('.side-section[aria-label="Outline section"] .side-section-toggle');
    await outline.click();
    const wasOpen = (await outline.getAttribute("aria-expanded")) === "true";
    await browser.keys([Key.Ctrl, "p"]);
    await $("input[role=combobox]").setValue("Expand or collapse current block");
    await browser.keys(Key.Enter);
    await expect(outline).toHaveAttribute("aria-expanded", String(!wasOpen));
    await fold();
    await expect(outline).toHaveAttribute("aria-expanded", String(wasOpen));

    const graph = $('section[aria-label="Local graph"] .side-section-toggle');
    await graph.click();
    await expect(graph).toHaveAttribute("aria-expanded", "false");
    await fold();
    await expect(graph).toHaveAttribute("aria-expanded", "true");
    await fold();
    await expect(graph).toHaveAttribute("aria-expanded", "false");
  });

  it("Ctrl+Shift+Q expands mixed blocks, collapses the whole note and reopens every level", async () => {
    const note = [
      "> [!toggle]- First toggle\n> First detail",
      "> [!tip]+ Second toggle\n> Second detail",
      "![[School/Biology#^cells]]",
      "# Section one\n- Parent\n  - Child\n    - Leaf detail",
      "# Section two\n```js\nconst codeDetail = 1;\n```",
    ].join("\n\n");
    fs.writeFileSync(vaultFile("Whole page.md"), note);
    await row("Whole page.md").waitForExist();
    await row("Whole page.md").click();
    const all = () => browser.keys([Key.Ctrl, Key.Shift, "q"]);
    await $(".cm-embed-body").$(".cm-line*=Embedded text").click();
    await all();
    await expect($(".cm-line*=First detail")).toBeDisplayed();
    await expect($(".cm-line*=Leaf detail")).toBeDisplayed();
    await expect($(".cm-line*=codeDetail")).toBeDisplayed();
    await browser.waitUntil(() =>
      fs.readFileSync(vaultFile("Whole page.md"), "utf8").includes("[!toggle]+"),
    );
    await $(".cm-line*=Leaf detail").click();
    await all();
    await expect($(".cm-line*=First detail")).not.toExist();
    await expect($(".cm-line*=Second detail")).not.toExist();
    await expect($(".cm-line*=Leaf detail")).not.toExist();
    await expect($(".cm-line*=codeDetail")).not.toExist();
    await browser.waitUntil(() =>
      fs.readFileSync(vaultFile("Whole page.md"), "utf8").includes("[!tip]-"),
    );
    const collapsed = path.resolve(".agents/qa/T-225/whole-page-collapsed.png");
    fs.mkdirSync(path.dirname(collapsed), { recursive: true });
    await browser.saveScreenshot(collapsed);
    await browser.keys([Key.Ctrl, "p"]);
    await $("input[role=combobox]").setValue("Expand or collapse all blocks in current note");
    await browser.keys(Key.Enter);
    await expect($(".cm-line*=First detail")).toBeDisplayed();
    await expect($(".cm-line*=Second detail")).toBeDisplayed();
    await expect($(".cm-line*=Leaf detail")).toBeDisplayed();
    await expect($(".cm-line*=codeDetail")).toBeDisplayed();
    await browser.waitUntil(
      () =>
        fs.readFileSync(vaultFile("Whole page.md"), "utf8") ===
        note.replace("[!toggle]-", "[!toggle]+"),
    );
    expect(fs.readFileSync(vaultFile("School/Biology.md"), "utf8")).toBe(source);
    const capture = path.resolve(".agents/qa/T-225/whole-page-expanded.png");
    fs.mkdirSync(path.dirname(capture), { recursive: true });
    await browser.saveScreenshot(capture);
  });
});
