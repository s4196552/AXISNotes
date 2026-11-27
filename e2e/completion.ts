import { $, browser } from "@wdio/globals";
import { Key } from "webdriverio";

/**
 * Choose the open command menu's entry labelled exactly `label` from the keyboard, as a
 * person would: arrow down to it, then Enter. Several entries can match what was typed
 * (since T-257 and T-267 a skill shares its name with a collection skill or a study block),
 * so waiting for a single match no longer works.
 */
export async function pickCompletion(label: string): Promise<void> {
  const menu = $(".cm-tooltip-autocomplete");
  await menu.$(`.cm-completionLabel=${label}`).waitForExist();
  await browser.pause(150); // CodeMirror ignores Enter just after the menu opens.
  const selected = () =>
    browser.execute(
      () =>
        document.querySelector(
          '.cm-tooltip-autocomplete li[aria-selected="true"] .cm-completionLabel',
        )?.textContent ?? null,
    );
  const seen: (string | null)[] = [];
  for (let i = 0; i < 40; i++) {
    const now = await selected();
    if (now === label) {
      await browser.keys(Key.Enter);
      return;
    }
    seen.push(now);
    await browser.keys(Key.ArrowDown);
  }
  throw new Error(`"${label}" was never selected in the menu; saw ${JSON.stringify(seen)}`);
}
