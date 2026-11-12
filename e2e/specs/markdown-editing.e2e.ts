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
    fs.writeFileSync(
      file("Line controls"),
      "Opening\n# First\n## Child\nBody\n# Second\nTarget row\n",
    );
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

  it("shows line controls on hover and selection, inserts below, and moves or selects a block", async () => {
    await open("Line controls");
    const intro = $(".cm-line=Opening");
    const first = $(".cm-lp-h1*=First");
    await intro.click();
    await first.moveTo();
    await intro.$(".cm-line-add").waitForDisplayed();
    const grip = () => first.$(".cm-line-grip");
    await grip().waitForDisplayed();
    const arrow = () => first.$(".cm-heading-arrow");
    await arrow().click();
    await expect($(".cm-lp-h2*=Child")).not.toExist();
    await arrow().click();
    await $(".cm-lp-h2*=Child").waitForDisplayed();
    await first.moveTo();
    await grip().doubleClick();
    const selected = await browser.execute(() => document.getSelection()?.toString());
    expect(selected).toContain("First");
    expect(selected).toContain("Child");
    expect(selected).toContain("Body");
    expect(selected).not.toContain("Second");

    await intro.moveTo();
    await intro.$(".cm-line-add").click();
    await $(".cm-tooltip-autocomplete").waitForDisplayed();
    await browser.waitUntil(() => read("Line controls").startsWith("Opening\n\n# First"));
    await browser.keys(Key.Escape);
    const target = $(".cm-line=Target row");
    const height = await target.getSize("height");
    await first.moveTo();
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: grip() })
      .down()
      .move({ origin: target, y: Math.floor(height / 2) - 1, duration: 300 })
      .up()
      .perform();
    await browser.waitUntil(
      () => read("Line controls") === "Opening\n\n# Second\nTarget row\n# First\n## Child\nBody\n",
    );
  });

  it("inserts the Quote template from Ctrl+/", async () => {
    await open("Quick quote");
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, "/"]);
    await browser.keys("quote");
    await $(".cm-tooltip-autocomplete").waitForDisplayed();
    await $(".cm-completionLabel=Quote").click();
    await browser.waitUntil(() => read("Quick quote") === "> [!NOTE] TITLE\n> Contents");
    await browser.keys(" extended");
    await browser.waitUntil(() => read("Quick quote") === "> [!NOTE] TITLE extended\n> Contents");
  });

  it("selects Mermaid for resizing on click and shows source on double-click", async () => {
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
    await $(".cm-mermaid-graphic").click();
    await expect($(".cm-mermaid-selected")).toExist();
    await expect($(".cm-mermaid svg")).toBeDisplayed();
    const pointer = () =>
      browser.action("pointer", { id: "diagram-resize", parameters: { pointerType: "mouse" } });
    const guides = $(".cm-mermaid-guides");
    const guideX = () =>
      browser.execute(() => {
        const guide = document.querySelector<HTMLElement>(".cm-mermaid-guides")!;
        return parseFloat(guide.style.getPropertyValue("--guide-x"));
      });
    await pointer().move({ origin: handle }).down().perform(true);
    await expect(guides).toBeDisplayed();
    const start = await guideX();
    await pointer().move({ origin: "pointer", x: -65, y: 0, duration: 250 }).perform(true);
    expect(await guideX()).toBeLessThan(start);
    const guideExtendsBelowDiagram = await browser.execute(() => {
      const guide = document.querySelector<HTMLElement>(".cm-mermaid-guides")!;
      const bounds = guide.getBoundingClientRect();
      const y = parseFloat(getComputedStyle(guide, "::before").top);
      const diagramBottom = document
        .querySelector(".cm-mermaid-frame")!
        .getBoundingClientRect().bottom;
      return y < guide.clientHeight && bounds.top + y > diagramBottom;
    });
    expect(guideExtendsBelowDiagram).toBe(true);
    const qa = path.resolve(".agents/qa/T-241");
    fs.mkdirSync(qa, { recursive: true });
    await browser.saveScreenshot(path.join(qa, "diagram-guides.png"));
    await pointer().up().perform();
    await browser.waitUntil(() => /mermaid width=\d+/.test(read("Resizable diagram")));
    await expect(guides).not.toBeDisplayed();
    await expect($(".cm-mermaid-selected")).toExist();
    const width = Number(/mermaid width=(\d+)/.exec(read("Resizable diagram"))![1]);
    expect(width).toBeLessThan(before);
    expect(read("Resizable diagram")).toBe(diagramDoc.replace("mermaid", `mermaid width=${width}`));
    await open("Vertical");
    await open("Resizable diagram");
    await expect(frame()).toHaveAttribute("style", `width: ${width}px;`);
    await browser.saveScreenshot(path.join(qa, "resized-diagram.png"));
    await $(".cm-mermaid-graphic").doubleClick();
    await expect($(".cm-mermaid")).not.toExist();
    await expect($(".cm-content")).toHaveText(expect.stringContaining("```mermaid width="));
    await $(".cm-line=Intro").click();
    await $(".cm-mermaid svg").waitForDisplayed();
  });
});
