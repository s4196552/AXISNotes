import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const vault = process.env.AXIS_E2E_VAULT!;
const row = (name: string) => $(`[data-path="${name}"]`);

async function scrollTo(top: number) {
  await browser.executeAsync((y: number, done: () => void) => {
    const scroller = document.querySelector<HTMLElement>(".note-scroller")!;
    scroller.scrollTop = y;
    // Let CodeMirror measure newly visible lines before choosing the final offset.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        scroller.scrollTop = y;
        requestAnimationFrame(() => requestAnimationFrame(done));
      }),
    );
  }, top);
}

async function metadataInView() {
  return browser.execute(() => {
    const scroller = document.querySelector<HTMLElement>(".note-scroller")!;
    const top = scroller.getBoundingClientRect().top;
    const bottom = scroller.getBoundingClientRect().bottom;
    return [".page-cover", ".page-icon", ".editor-header"].map((selector) => {
      const element = scroller.querySelector<HTMLElement>(selector);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      return rect.bottom > top && rect.top < bottom;
    });
  });
}

describe("Note header scrolling (T-132)", () => {
  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      fs.mkdirSync(path.resolve(".agents/qa/T-132"), { recursive: true });
      await browser.saveScreenshot(path.resolve(".agents/qa/T-132/failure.png"));
      console.log(
        await browser.execute(() => ({
          body: document.body.innerText.slice(-4000),
          errors: (window as unknown as { testErrors?: string[] }).testErrors,
        })),
      );
    }
  });
  it("scrolls the cover, icon and title away and restores them at the top", async () => {
    await row("Welcome.md").waitForDisplayed({ timeout: 15000 });
    fs.writeFileSync(
      path.join(vault, "Scrolling.md"),
      "---\nbanner: gradient:dusk\n---\n# Scrolling\n\n" +
        Array.from(
          { length: 120 },
          (_, i) => `Paragraph ${i + 1}: readable note content.\n\n`,
        ).join(""),
    );
    await row("Scrolling.md").waitForDisplayed();
    await row("Scrolling.md").click();
    await $(".page-cover").waitForDisplayed();
    await browser.execute(() => {
      const target = window as unknown as { testErrors: string[] };
      target.testErrors = [];
      window.addEventListener("error", (event) => {
        target.testErrors.push(String(event.error?.stack ?? event.message));
      });
      window.addEventListener("unhandledrejection", (event) => {
        target.testErrors.push(String(event.reason?.stack ?? event.reason));
      });
    });
    await $(".page-header").moveTo();
    await $("button=Add icon").click();
    const picker = $('[role="dialog"][aria-label="Icon for Scrolling.md"]');
    await picker.waitForDisplayed();
    // Use an emoji: Lucide selection currently hits the separate graph rasterizer's
    // nested flushSync/cloneNode failure (recorded in the task handoff).
    await picker.$("button=Emoji").click();
    await picker.$('[role="option"]').waitForDisplayed();
    await picker.$('[role="option"]').click();
    await $(".page-icon").waitForDisplayed();
    const layout = await browser.execute(() => {
      const scroller = document.querySelector<HTMLElement>(".note-scroller")!;
      const metadata = scroller.querySelector<HTMLElement>(".editor-page-top")!;
      const content = scroller.querySelector<HTMLElement>(".cm-content")!;
      return {
        metadataBottom: metadata.getBoundingClientRect().bottom,
        contentTop: content.getBoundingClientRect().top,
        metadataWidth: metadata.getBoundingClientRect().width,
        scrollerWidth: scroller.clientWidth,
      };
    });
    expect(layout.metadataBottom).toBeLessThanOrEqual(layout.contentTop + 1);
    expect(Math.abs(layout.metadataWidth - layout.scrollerWidth)).toBeLessThan(2);
    expect(await metadataInView()).toEqual([true, true, true]);
    await scrollTo(1000);
    await browser.waitUntil(async () => (await metadataInView()).every((visible) => !visible));
    // Scroll geometry must remain stable rather than toggling compact/expanded states.
    expect(await $(".note-scroller").getProperty("scrollTop")).toBe(1000);
    await scrollTo(0);
    await browser.waitUntil(async () => (await metadataInView()).every(Boolean));
    await expect($(".page-header")).not.toHaveElementClass("compact");

    await $(".editor-title").setValue("Scrolling renamed");
    await browser.keys(Key.Enter);
    await row("Scrolling renamed.md").waitForDisplayed();
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys([Key.Enter, "Still editable after scrolling"]);
    await browser.waitUntil(() =>
      fs.readFileSync(path.join(vault, "Scrolling renamed.md"), "utf8").includes("Still editable"),
    );
    await $(".note-scroller").waitForDisplayed();
    await scrollTo(0);
    fs.mkdirSync(path.resolve(".agents/qa/T-132"), { recursive: true });
    await browser.saveScreenshot(path.resolve(".agents/qa/T-132/header-at-top.png"));
  });

  it("also scrolls away an icon without a cover, with outline gutters enabled", async () => {
    await scrollTo(0);
    await $(".page-cover").moveTo();
    await $("button=Remove cover").click();
    await expect($(".page-cover")).not.toExist();
    await $('[aria-label="Outline view"]').click();
    await $(".cm-gutters").waitForDisplayed();
    await scrollTo(1000);
    await browser.waitUntil(async () => (await metadataInView()).every((visible) => !visible));
    fs.mkdirSync(path.resolve(".agents/qa/T-132"), { recursive: true });
    await browser.saveScreenshot(path.resolve(".agents/qa/T-132/scrolled-outline.png"));
    await scrollTo(0);
    expect(await metadataInView()).toEqual([false, true, true]);
    await scrollTo(1000);
    await row("Welcome.md").click();
    await row("Scrolling renamed.md").click();
    await browser.waitUntil(async () => (await metadataInView()).every((visible) => !visible));
    expect(await $(".note-scroller").getProperty("scrollTop")).toBe(1000);
    await scrollTo(0);
    await browser.waitUntil(async () => (await metadataInView())[2] === true);
  });
});
