import { browser } from "@wdio/globals";
import { Key } from "webdriverio";

/** Read painted text only. Hidden descendants are excluded by innerText; hidden roots
 * are rejected before reading because innerText on a hidden element returns textContent. */
export async function readVisibleText(element: WebdriverIO.Element) {
  if (!(await element.isDisplayed())) return "";
  return browser.execute((node: HTMLElement) => {
    if (
      !node.isConnected ||
      !node.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    )
      return "";
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return "";
    return node.innerText;
  }, element);
}

/** WebKit 2.52.6 evidence: CI 36806735758 returns empty native text for painted text,
 * and WDIO's simultaneous key-down sequence loses adjacent repeated characters.
 * Keep native WebDriver interactions and require rendered, visible text. */
export function installLinuxDriverCompatibility() {
  if (process.platform !== "linux") return;
  browser.overwriteCommand(
    "getText",
    async function (this: WebdriverIO.Element, original) {
      const nativeText = await original();
      return nativeText || readVisibleText(this);
    },
    true,
  );
  browser.overwriteCommand("keys", async function (original, value) {
    const chunks: string[] = typeof value === "string" ? [value] : value;
    const modifiers = new Set<string>([Key.Ctrl, Key.Shift, Key.Alt, Key.Command, Key.Control]);
    if (chunks.some((chunk) => modifiers.has(chunk))) return original(value);
    const action = browser.action("key");
    for (const chunk of chunks) {
      for (const character of chunk) action.down(character).up(character);
    }
    await action.perform(true);
  });
}
