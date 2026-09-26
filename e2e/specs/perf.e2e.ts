import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// Phase 1 acceptance: a 5,000-note vault stays fast in the real app. Search times are
// read from the search panel, which measures the round trip through IPC.

async function searchMs(query: string): Promise<{ ms: number; text: string }> {
  const box = $('input[aria-label="Search notes"]');
  await box.setValue(query);
  // The summary line is re-rendered as results update, so a handle can go stale
  // between finding and reading it; treat that as "not yet".
  let text = "";
  await browser.waitUntil(
    async () => {
      try {
        text = await $(".search-summary").getText();
      } catch {
        return false;
      }
      return /results? · \d+ ms|No results/.test(text);
    },
    { timeoutMsg: `no results for ${query}` },
  );
  return { ms: Number(/(\d+) ms/.exec(text)?.[1] ?? 0), text };
}

describe("Phase 1: 5,000-note vault performance", () => {
  it("opens and indexes the vault", async () => {
    const started = Date.now();
    await $('[data-path="Folder 0"]').waitForDisplayed({ timeout: 60_000 });
    console.log(`vault visible after ${Date.now() - started} ms (from session start)`);
  });

  it("answers searches in under 100 ms", async () => {
    await $('[role="tab"][aria-label="Search"]').click();
    for (const q of [
      "energy",
      '"about river"',
      "tag:area/cell",
      "prop:status=done budget",
      "lorem -poem",
    ]) {
      const { ms, text } = await searchMs(q);
      console.log(`${q.padEnd(26)} ${text}`);
      expect(ms).toBeLessThan(100);
    }
  });

  it("filters 5,000 notes in the quick switcher", async () => {
    await browser.keys([Key.Ctrl, "o"]);
    await $('[role="combobox"][aria-label="Quick switcher"]').waitForDisplayed();
    const started = Date.now();
    await browser.keys("Note 4999");
    await browser.waitUntil(async () =>
      (await $('[role="option"][aria-selected="true"]').getText()).startsWith("Note 4999"),
    );
    console.log(`switcher filter: ${Date.now() - started} ms (incl. WebDriver typing)`);
    await browser.keys(Key.Enter);
    await expect($(".editor-title")).toHaveText("Note 4999");
    // Backlinks come from Note 4998 ([[Note 4999]]).
    await expect($('[aria-label="Linked mentions"]')).toHaveText(
      expect.stringContaining("Note 4998"),
    );
  });
});
