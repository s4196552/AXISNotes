import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const file = (name: string) => path.join(process.env.AXIS_E2E_VAULT!, `${name}.md`);
const row = (name: string) => $(`[data-path="${name}.md"]`);
const read = (name: string) => fs.readFileSync(file(name), "utf8");

async function open(name: string) {
  await row(name).waitForDisplayed();
  await row(name).click();
  await $('.cm-content[aria-label="Note ' + name + '"]').waitForDisplayed();
}

async function cursorRow() {
  return browser.execute(() => {
    const node = document.getSelection()?.focusNode;
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest(".cm-line")?.textContent?.trim() ?? "";
  });
}

const diagram = "flowchart TD\n  A[Start] --> B[Finish]";
const diagramDoc = `Intro\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\nAfter\n`;

describe("Markdown editing in live preview", () => {
  before(async () => {
    await $(".filetree").waitForDisplayed({ timeout: 15000 });
    fs.writeFileSync(file("Vertical"), "First row\n## Second heading\nThird row\n\n> Fourth row\n");
    fs.writeFileSync(
      file("Wrapped"),
      "A long paragraph with words to wrap. ".repeat(24) + "\nAfter",
    );
    fs.writeFileSync(file("List edits"), "- [x] Packed");
    fs.writeFileSync(file("Quick quote"), "");
    fs.writeFileSync(file("Resizable diagram"), diagramDoc);
  });

  it("moves one rendered row at a time with plain, Ctrl and Shift arrows", async () => {
    await open("Vertical");
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.Home]);
    await browser.keys(Key.ArrowDown);
    await browser.waitUntil(async () => (await cursorRow()).includes("Second heading"));
    await browser.keys([Key.Ctrl, Key.ArrowDown]);
    await browser.waitUntil(async () => (await cursorRow()).includes("Third row"));
    await browser.keys([Key.Ctrl, Key.Shift, Key.ArrowUp]);
    await browser.waitUntil(async () => (await cursorRow()).includes("Second heading"));
    expect(await browser.execute(() => document.getSelection()?.isCollapsed)).toBe(false);
    await browser.keys([Key.Ctrl, Key.Home]);
    await browser.keys([Key.Shift, Key.ArrowDown]);
    await browser.waitUntil(async () => (await cursorRow()).includes("Second heading"));
    expect(await browser.execute(() => document.getSelection()?.isCollapsed)).toBe(false);

    await open("Wrapped");
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.Home]);
    const cursor = () => $(".cm-cursor-primary").getLocation("y");
    const top = await cursor();
    await browser.keys(Key.ArrowDown);
    await browser.waitUntil(async () => (await cursor()) > top);
    expect(await cursorRow()).toContain("A long paragraph");
    await browser.keys(Key.ArrowUp);
    await browser.waitUntil(async () => (await cursor()) === top);
  });

  it("continues a filled list item and exits a new empty one", async () => {
    await open("List edits");
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys(Key.Enter);
    await browser.waitUntil(() => read("List edits") === "- [x] Packed\n- [ ] ");
    await browser.keys(Key.Enter);
    await browser.keys("Paragraph");
    await browser.waitUntil(() => read("List edits") === "- [x] Packed\nParagraph");
  });

  it("inserts the Quote template from Ctrl+/", async () => {
    await open("Quick quote");
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, "/"]);
    await browser.keys("quote");
    await $(".cm-tooltip-autocomplete").waitForDisplayed();
    await $(".cm-completionLabel=Quote").click();
    await browser.waitUntil(() => read("Quick quote") === "> [!NOTE] TITLE\n> Contents");
    await browser.keys("My quotation");
    await browser.waitUntil(() => read("Quick quote") === "> [!NOTE] TITLE\n> My quotation");
  });

  it("renders Mermaid without a frame, preserves resize and shows source on click", async () => {
    await open("Resizable diagram");
    await $(".cm-mermaid svg").waitForDisplayed({ timeout: 15000 });
    const frame = () => $(".cm-mermaid-frame");
    const before = await frame().getSize("width");
    const handle = frame().$('[data-handle="se"]');
    await frame().moveTo();
    const chrome = await browser.execute(() => {
      const wrapper = getComputedStyle(document.querySelector(".cm-mermaid")!);
      const diagram = getComputedStyle(document.querySelector(".cm-mermaid-frame")!);
      return [wrapper.borderTopWidth, diagram.outlineStyle];
    });
    expect(chrome).toEqual(["0px", "none"]);
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: handle })
      .down()
      .move({ origin: handle, x: -65, duration: 250 })
      .up()
      .perform();
    await browser.waitUntil(() => /mermaid width=\d+/.test(read("Resizable diagram")));
    const width = Number(/mermaid width=(\d+)/.exec(read("Resizable diagram"))![1]);
    expect(width).toBeLessThan(before);
    expect(read("Resizable diagram")).toBe(diagramDoc.replace("mermaid", `mermaid width=${width}`));
    await open("Vertical");
    await open("Resizable diagram");
    await expect(frame()).toHaveAttribute("style", `width: ${width}px;`);
    const qa = path.resolve(".agents/qa/T-232");
    fs.mkdirSync(qa, { recursive: true });
    await browser.saveScreenshot(path.join(qa, "resized-diagram.png"));
    await $(".cm-mermaid svg").click();
    await expect($(".cm-mermaid")).not.toExist();
    await expect($(".cm-content")).toHaveText(expect.stringContaining("```mermaid width="));
    await $(".cm-line=Intro").click();
    await $(".cm-mermaid svg").waitForDisplayed();
  });
});
