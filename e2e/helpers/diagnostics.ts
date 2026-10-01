import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { browser } from "@wdio/globals";

const artifactRoot = process.env.AXIS_E2E_ARTIFACTS ?? path.resolve(".agents/logs/e2e-artifacts");
const MAX_CAPTURES = 40;
const MAX_JSON_BYTES = 128 * 1024;
const MAX_SCREENSHOT_BYTES = 2 * 1024 * 1024;
let lastSelector = "";
const recentCommands: { command: string; selector?: string; text?: string }[] = [];

/** Fail closed before collecting UI: native app must have our nonce-marked disposable vault. */
async function requireFixtureSession() {
  const vault = process.env.AXIS_E2E_VAULT;
  const config = process.env.AXIS_CONFIG_DIR;
  const nonce = process.env.AXIS_E2E_CAPTURE_NONCE;
  const isTemp = (dir: string | undefined, prefix: string) =>
    Boolean(
      dir &&
      path.dirname(path.resolve(dir)) === path.resolve(os.tmpdir()) &&
      path.basename(dir).startsWith(prefix),
    );
  if (
    !isTemp(vault, "axis-e2e-") ||
    !isTemp(config, "axis-e2e-config-") ||
    !nonce ||
    process.env.AXIS_AI_MEMORY_KEYS !== "1"
  ) {
    throw new Error("UI diagnostics refused: not an isolated fixture session");
  }
  const marker = JSON.parse(
    fs.readFileSync(path.join(vault!, ".axis-e2e-fixture.json"), "utf8"),
  ) as { nonce?: string };
  if (marker.nonce !== nonce) throw new Error("UI diagnostics refused: fixture marker mismatch");
  const current = await browser.executeAsync((done: (value: { root?: string } | null) => void) => {
    const native = window as unknown as {
      __TAURI_INTERNALS__: { invoke(command: string): Promise<{ root: string } | null> };
    };
    native.__TAURI_INTERNALS__.invoke("current_vault").then(done, () => done(null));
  });
  const canonical = (dir: string) => {
    const result = fs.realpathSync.native(dir).replace(/^\\\\\?\\/, "");
    return process.platform === "win32" ? result.toLowerCase() : result;
  };
  if (!current?.root || canonical(current.root) !== canonical(vault!)) {
    throw new Error("UI diagnostics refused: native app is not using the fixture vault");
  }
}

/** Remember selectors/results, never keyboard payloads, request bodies or credentials. */
export function recordCommand(command: string, args: unknown[], result: unknown) {
  if (command === "findElement" || command === "findElements") {
    lastSelector = String(args[1] ?? "").slice(0, 256);
  } else if (command === "findElementFromElement" || command === "findElementsFromElement") {
    lastSelector = String(args[2] ?? "").slice(0, 256);
  }
  recentCommands.push({
    command,
    selector: lastSelector,
    ...(command === "getElementText" ? { text: String(result ?? "").slice(0, 512) } : {}),
  });
  if (recentCommands.length > 12) recentCommands.shift();
}

/** Read diagnostic DOM data only; this does not click, focus or alter application state. */
export async function inspectRenderedElement(selector: string) {
  await requireFixtureSession();
  const element = await browser.$(selector);
  const webdriverText = await browser.getElementText(await element.elementId);
  const displayed = await element.isDisplayed();
  const dom = await browser.execute((query: string) => {
    const element = document.querySelector(query) as HTMLElement | null;
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      innerText: element.innerText,
      textContent: element.textContent,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      display: style.display,
      visibility: style.visibility,
      opacity: style.opacity,
    };
  }, selector);
  return { selector, webdriverText, displayed, dom };
}

/** Only nonce-verified fixture UI is captured. Fixed bounds keep diagnostics affordable. */
export async function captureUi(label: string, selectors: string[] = []) {
  await requireFixtureSession();
  fs.mkdirSync(artifactRoot, { recursive: true });
  if (fs.readdirSync(artifactRoot).filter((name) => name.endsWith(".json")).length >= MAX_CAPTURES)
    return;
  const name = `${process.pid}-${label.replace(/[^a-zA-Z0-9-]/g, "-").slice(0, 110)}`;
  const file = path.join(artifactRoot, name);
  const errors: string[] = [];
  const commands = recentCommands.slice();
  let ui: unknown;
  try {
    ui = await browser.execute(
      (queries: string[]) => {
        const describe = (element: Element | null) => {
          if (!element) return null;
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          const clone = node.cloneNode(true) as HTMLElement;
          for (const input of clone.querySelectorAll("input,textarea")) {
            input.removeAttribute("value");
            if (input.tagName === "TEXTAREA") input.textContent = "[redacted]";
          }
          clone.removeAttribute("value");
          const secretInput =
            /key|password/i.test(node.getAttribute("aria-label") ?? "") ||
            (node instanceof HTMLInputElement && node.type === "password");
          const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
          return {
            tag: node.tagName,
            id: node.id,
            className: String(node.className).slice(0, 200),
            label: node.getAttribute("aria-label"),
            html: clone.outerHTML.slice(0, 2000),
            innerText: (node.innerText ?? "").slice(0, 2000),
            textContent: (node.textContent ?? "").slice(0, 2000),
            value: secretInput
              ? "[redacted]"
              : node instanceof HTMLInputElement
                ? node.value.slice(0, 256)
                : undefined,
            rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            styles: {
              display: style.display,
              visibility: style.visibility,
              opacity: style.opacity,
              contentVisibility: style.contentVisibility,
              fontFamily: style.fontFamily,
              fontSize: style.fontSize,
              overflow: style.overflow,
            },
            hitAtCenter: hit
              ? {
                  tag: hit.tagName,
                  className: String(hit.className),
                  label: hit.getAttribute("aria-label"),
                }
              : null,
          };
        };
        const nodes: { selector: string; element: ReturnType<typeof describe> }[] = [];
        for (const query of queries) {
          try {
            for (const element of Array.from(document.querySelectorAll(query)).slice(0, 4)) {
              if (nodes.length >= 24) break;
              nodes.push({ selector: query, element: describe(element) });
            }
          } catch {
            /* WebDriver can use selectors that are not CSS. */
          }
        }
        return {
          title: document.title,
          viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
          focus: describe(document.activeElement),
          selection: {
            anchorOffset: getSelection()?.anchorOffset,
            focusOffset: getSelection()?.focusOffset,
          },
          nodes,
        };
      },
      [
        ...selectors,
        lastSelector,
        ".editor-title",
        ".sidebar-header",
        '[data-addr="B4"]',
        '[role="alert"]',
        '[role="status"]',
        ".cm-content",
        '[role="dialog"]',
        "input:focus",
        'input[aria-label^="Endpoint"]',
        ".settings",
        ".modal-backdrop",
      ].filter(Boolean),
    );
  } catch (error) {
    errors.push(`DOM capture failed: ${String(error).slice(0, 300)}`);
  }
  const displayed: Record<string, boolean | string> = {};
  for (const selector of [
    ...selectors,
    ".editor-title",
    ".sidebar-header",
    '[data-addr="B4"]',
  ].slice(0, 6)) {
    try {
      displayed[selector] = await browser.$(selector).isDisplayed();
    } catch {
      displayed[selector] = "unavailable";
    }
  }
  let windowSize: unknown;
  try {
    windowSize = await browser.getWindowSize();
  } catch {
    windowSize = "unavailable";
  }
  try {
    await browser.saveScreenshot(`${file}.png`);
    if (fs.statSync(`${file}.png`).size > MAX_SCREENSHOT_BYTES) {
      fs.unlinkSync(`${file}.png`);
      errors.push("Screenshot exceeded the 2 MiB limit and was discarded");
    }
  } catch (error) {
    errors.push(`Screenshot failed: ${String(error).slice(0, 300)}`);
  }
  const data = JSON.stringify(
    {
      label,
      platform: process.platform,
      os: os.release(),
      node: process.version,
      windowSize,
      displayed,
      recentCommands: commands,
      ui,
      errors,
    },
    null,
    2,
  );
  fs.writeFileSync(
    `${file}.json`,
    Buffer.byteLength(data) <= MAX_JSON_BYTES
      ? data
      : JSON.stringify({ label, errors: ["DOM diagnostic exceeded the 128 KiB limit"] }),
  );
}
