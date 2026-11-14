import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const file = (name: string) => path.join(process.env.AXIS_E2E_VAULT!, name);
const welcome = () => $('.filetree [data-path="Welcome.md"]');
const second = () => $('.filetree [data-path="School/Biology.md"]');
const offset = () =>
  browser.execute(() => document.querySelector<HTMLElement>(".cm-scroller")!.scrollTop);

describe("Returning to the same note position", () => {
  before(async () => {
    fs.writeFileSync(
      file("Welcome.md"),
      "# Welcome\n\n" +
        Array.from(
          { length: 220 },
          (_, n) => `Row ${n + 1}: Cells use ATP to move, grow and repair.\n\n`,
        ).join(""),
    );
    fs.writeFileSync(file("School/Biology.md"), "# Biology\n\nA second note.\n");
    await browser.refresh();
    await $('.filetree [data-path="School"]').click();
    await welcome().click();
    await $(".cm-content").waitForDisplayed();
  });

  it("restores a scrolled viewport even when its caret remains near the beginning", async () => {
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.Home]);
    await browser.keys(Key.Ctrl);
    await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>(".cm-scroller")!;
      scroller.scrollTop = 3000;
      scroller.dispatchEvent(new Event("scroll"));
    });
    await browser.waitUntil(async () => (await offset()) > 2500);
    const before = await offset();
    await second().click();
    await expect($(".cm-content")).toHaveText(expect.stringContaining("A second note."));
    await welcome().click();
    await browser.waitUntil(async () => Math.abs((await offset()) - before) < 90, {
      timeout: 8000,
      timeoutMsg: "The note restored its previous viewport rather than row one",
    });
    const qa = path.resolve(".agents/qa/T-227");
    fs.mkdirSync(qa, { recursive: true });
    await browser.saveScreenshot(path.join(qa, "restored-note-position.png"));
  });

  it("also restores the cursor row through note navigation", async () => {
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.Home]);
    await browser.keys(Key.Ctrl);
    for (let n = 0; n < 30; n++) await browser.keys(Key.ArrowDown);
    const activeLine = () =>
      browser.execute(() => {
        const node = window.getSelection()?.anchorNode;
        const element = node instanceof Element ? node : node?.parentElement;
        return element?.closest(".cm-line")?.textContent ?? "";
      });
    for (let n = 0; n < 4 && !(await activeLine()).startsWith("Row"); n++)
      await browser.keys(Key.ArrowDown);
    const line = await activeLine();
    expect(line).toContain("Row");
    await second().click();
    await expect($(".cm-content")).toHaveText(expect.stringContaining("A second note."));
    await welcome().click();
    await browser.execute(() => document.querySelector<HTMLElement>(".cm-content")!.focus());
    await browser.waitUntil(async () => (await activeLine()) === line);
  });
});
