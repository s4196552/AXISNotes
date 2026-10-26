import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const vault = process.env.AXIS_E2E_VAULT!;
const file = (name: string) => path.join(vault, name);
const row = (name: string) => $(`[data-path="${name}"]`);
const arrow = (action: string, title: string) =>
  $(`.cm-heading-arrow[aria-label="${action} heading: ${title}"]`);
const body = () => $(".cm-content").getText();

const NORMAL = [
  "# Parent",
  "Parent intro",
  "",
  "## Child",
  "Child paragraph",
  "",
  "- Child list item",
  "",
  "> Child quotation",
  "",
  "| Column |",
  "| --- |",
  "| Cell value |",
  "",
  "![[dot.svg]]",
  "",
  "````markdown",
  "# Code example, not a heading",
  "````",
  "",
  "###### Deep",
  "Deep body",
  "",
  "## Sibling",
  "Sibling body",
  "",
  "# Next",
  "Next body",
  "",
].join("\n");

describe("Default heading folding (T-133)", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      fs.mkdirSync(path.resolve(".agents/qa/T-133"), { recursive: true });
      await browser.saveScreenshot(path.resolve(".agents/qa/T-133/failure.png"));
    }
  });

  it("folds complete nested Markdown sections by default, without editing the source", async () => {
    await row("Welcome.md").waitForDisplayed({ timeout: 15000 });
    fs.writeFileSync(
      file("dot.svg"),
      '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>',
    );
    fs.writeFileSync(file("Hierarchy.md"), NORMAL);
    await row("Hierarchy.md").waitForDisplayed();
    await row("Hierarchy.md").click();
    await arrow("Collapse", "Parent").waitForDisplayed();
    const outline = $('[aria-label="Outline view"]');
    if ((await outline.getAttribute("aria-pressed")) === "true") await outline.click();
    await expect(outline).toHaveAttribute("aria-pressed", "false");
    await arrow("Collapse", "Child").click();
    await browser.waitUntil(async () => !(await body()).includes("Child paragraph"));
    expect(await body()).not.toContain("Child list item");
    expect(await body()).not.toContain("Child quotation");
    expect(await body()).not.toContain("Cell value");
    expect(await body()).not.toContain("Code example");
    expect(await body()).not.toContain("Deep body");
    expect(await body()).toContain("Sibling body");
    await expect($(".cm-image-embed img")).not.toExist();
    await arrow("Collapse", "Parent").click();
    expect(await body()).not.toContain("Sibling");
    expect(await body()).toContain("Next body");
    await arrow("Expand", "Parent").click();
    expect(await body()).toContain("Parent intro");
    expect(await body()).not.toContain("Child paragraph");
    await arrow("Expand", "Child").click();
    await browser.waitUntil(async () => (await body()).includes("Deep body"));
    await $(".cm-image-embed img").waitForDisplayed();
    expect(fs.readFileSync(file("Hierarchy.md"), "utf8")).toBe(NORMAL);
    // The arrow is a keyboard-accessible control even with Outline view disabled.
    await browser.execute(() => {
      document
        .querySelector<HTMLElement>('.cm-heading-arrow[aria-label="Collapse heading: Deep"]')!
        .focus();
    });
    await browser.keys(Key.Enter);
    expect(await body()).not.toContain("Deep body");
    await arrow("Expand", "Deep").click();
    fs.mkdirSync(path.resolve(".agents/qa/T-133"), { recursive: true });
    await browser.execute(() => {
      document.querySelector<HTMLElement>(".note-scroller")!.scrollTop = 0;
    });
    await browser.saveScreenshot(path.resolve(".agents/qa/T-133/standard-headings.png"));
  });

  it("uses the same hierarchy for toggle headings and retains nested toggle state", async () => {
    const doc =
      "> [!toggle|h1]+ Toggle parent\n> quoted intro\nUnquoted body\n\n" +
      "## Normal child\nNormal child body\n\n> [!toggle|h3]- Toggle child\n> Nested body\n" +
      "More nested body\n\n## Normal sibling\nSibling body\n\n# Outside\nOutside body\n";
    fs.writeFileSync(file("Mixed.md"), doc);
    await row("Mixed.md").waitForDisplayed();
    await row("Mixed.md").click();
    const parent = () => $(".cm-toggle-arrow:not(.cm-heading-arrow)");
    await parent().waitForDisplayed();
    await parent().click();
    await browser.waitUntil(async () => !(await body()).includes("Unquoted body"));
    expect(await body()).not.toContain("Normal sibling");
    expect(await body()).toContain("Outside body");
    await browser.waitUntil(() => fs.readFileSync(file("Mixed.md"), "utf8").includes("h1]-"));
    await parent().click();
    expect(await body()).toContain("Unquoted body");
    expect(await body()).toContain("Normal child body");
    expect(await body()).not.toContain("Nested body");
    expect(await body()).not.toContain("More nested body");
    await arrow("Collapse", "Normal child").click();
    expect(await body()).not.toContain("Toggle child");
    await arrow("Expand", "Normal child").click();
    expect(await body()).toContain("Toggle child");
    expect(await body()).not.toContain("Nested body");
    await browser.waitUntil(() => fs.readFileSync(file("Mixed.md"), "utf8") === doc);
    await browser.saveScreenshot(path.resolve(".agents/qa/T-133/mixed-headings.png"));
  });
});
