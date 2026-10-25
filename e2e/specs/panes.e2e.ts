import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const vault = process.env.AXIS_E2E_VAULT!;
const config = () =>
  JSON.parse(fs.readFileSync(path.join(vault, ".axisnotes/config.json"), "utf8"));
const themes = [
  "system",
  "light",
  "dark",
  "axis:darker",
  "axis:minimal",
  "axis:glass",
  "axis:translucent",
  "axis:contrast",
  "axis:retro",
];
const screenshot = async (name: string) => {
  const dir = path.resolve(".agents/qa/T-128");
  fs.mkdirSync(dir, { recursive: true });
  await browser.saveScreenshot(path.join(dir, `${name}.png`));
};

async function chooseTheme(theme: string, liquid = false) {
  await $('button[aria-label="Settings"]').click();
  await $(`label[data-theme-id="${theme}"]`).click();
  await browser.waitUntil(() => config().theme === theme);
  if (theme === "axis:translucent") {
    await browser.execute(() =>
      document.querySelector<HTMLInputElement>('input[aria-label="Window effect"]')!.focus(),
    );
    await browser.keys(Key.Home);
    for (let i = 0; i < (liquid ? 3 : 2); i++) await browser.keys(Key.ArrowRight);
    await browser.waitUntil(
      () => config().appearance.windowEffect === (liquid ? "liquid" : "frosted"),
    );
  }
  // Themes keep precisely their preview palette and fonts; pane geometry must not replace them.
  const matches = await browser.execute((id) => {
    const selector =
      id === "system"
        ? `[data-theme-preview="${matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"}"]`
        : "[data-theme-preview]";
    const preview = document.querySelector(`label[data-theme-id="${id}"] ${selector}`)!;
    const root = getComputedStyle(document.documentElement);
    const sample = getComputedStyle(preview);
    return ["--bg", "--fg", "--accent", "--font-note"].every(
      (name) => root.getPropertyValue(name).trim() === sample.getPropertyValue(name).trim(),
    );
  }, theme);
  if (!liquid) expect(matches).toBe(true);
  await browser.keys(Key.Escape);
  await $('[role="dialog"]').waitForExist({ reverse: true });
}

async function paneLayout(left = true, right = true, compact = false) {
  await browser.waitUntil(
    async () =>
      browser.execute(
        (l, r, small) => {
          const content = document.querySelector<HTMLElement>(".content")!;
          const shell = document.querySelector<HTMLElement>(".shell")!;
          const main = content.getBoundingClientRect();
          const status = document.querySelector(".statusbar")!.getBoundingClientRect();
          const close = (a: number, b: number) => Math.abs(a - b) < 1;
          if (
            shell.classList.contains("compact") !== small ||
            !close(main.top, 8) ||
            !close(main.bottom, status.top)
          )
            return false;
          if (getComputedStyle(content).borderRadius !== "18px") return false;
          let minX = 8,
            maxX = innerWidth - 8;
          for (const [side, shown] of [
            ["left", l],
            ["right", r],
          ] as const) {
            if (!shown) continue;
            const pane = document.querySelector<HTMLElement>(`.sidebar-slot.${side} > .sidebar`)!;
            const rect = pane.getBoundingClientRect();
            if (!close(rect.top, 8) || getComputedStyle(pane).borderRadius !== "18px") return false;
            if (side === "left") {
              if (!close(rect.left, 8)) return false;
              if (!small) minX = rect.right + 8;
            } else {
              if (!close(rect.right, innerWidth - 8)) return false;
              if (!small) maxX = rect.left - 8;
            }
          }
          return (
            close(main.left, minX) &&
            close(main.right, maxX) &&
            document.documentElement.scrollWidth <= innerWidth
          );
        },
        left,
        right,
        compact,
      ),
    { timeoutMsg: "Pane insets, gaps, corners or hidden-panel space are incorrect" },
  );
}

describe("Rounded modular panes (T-128)", () => {
  it("uses the same geometry across themes while preserving palettes and appearance preferences", async () => {
    await $('.filetree-row[data-path="Welcome.md"]').waitForDisplayed({ timeout: 15000 });
    await $('.filetree-row[data-path="Welcome.md"]').click();
    await chooseTheme("dark");
    const preferences = config().appearance;
    for (const theme of themes) {
      await chooseTheme(theme);
      await paneLayout();
      expect(config().appearance).toEqual(preferences);
      await screenshot(theme.replace("axis:", ""));
    }
    await chooseTheme("axis:translucent", true);
    await paneLayout();
    await screenshot("liquid");
    await chooseTheme("axis:translucent");
    await chooseTheme("dark");
    expect(config().appearance).toEqual(preferences);
  });

  it("collapses gaps with hidden panels and keeps menus and window controls usable", async () => {
    await $('button[aria-label="Hide left panel"]').click();
    await paneLayout(false, true);
    await $('button[aria-label="Hide right panel"]').click();
    await paneLayout(false, false);
    await $('main button[aria-label="Show left panel"]').click();
    await paneLayout(true, false);
    await $('main button[aria-label="Show right panel"]').click();
    await paneLayout();
    const controlsFit = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>(".window-controls button")].every((button) => {
        const r = button.getBoundingClientRect();
        return (
          document
            .elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
            ?.closest("button") === button
        );
      }),
    );
    expect(controlsFit).toBe(true);
    await $('.filetree-row[data-path="Welcome.md"]').click({ button: 2 });
    await $(".filetree-menu").waitForDisplayed();
    const menuUnclipped = await browser.execute(() => {
      const menu = document.querySelector<HTMLElement>(".filetree-menu")!;
      const r = menu.getBoundingClientRect();
      return (
        r.right <= innerWidth &&
        r.bottom <= innerHeight &&
        menu.contains(document.elementFromPoint(r.right - 8, r.top + 20))
      );
    });
    expect(menuUnclipped).toBe(true);
    await browser.keys(Key.Escape);
  });

  it("resizes within the new gaps and preserves compact overlays and regional zoom", async () => {
    const original = await browser.getWindowSize();
    try {
      await browser.setWindowSize(1100, 820);
      await paneLayout();
      const grip = await browser.execute(() => {
        const rect = document
          .querySelector('[aria-label="Resize left panel"]')!
          .getBoundingClientRect();
        return {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };
      });
      await browser
        .action("pointer", { parameters: { pointerType: "mouse" } })
        .move({ ...grip, duration: 0 })
        .down({ button: 0 })
        .move({ x: grip.x + 32, y: grip.y, duration: 200 })
        .up({ button: 0 })
        .perform();
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            document.querySelector(".sidebar-slot.left .sidebar")!.getBoundingClientRect().width ===
            292,
        ),
      );
      // A resize press prevents native text selection; keyboard resizing starts
      // with focus on the separator, as when tabbing to it.
      await browser.execute(() =>
        document.querySelector<HTMLElement>('[aria-label="Resize left panel"]')!.focus(),
      );
      await browser.keys(Key.End);
      await browser.waitUntil(async () =>
        browser.execute(
          () =>
            Math.abs(document.querySelector(".content")!.getBoundingClientRect().width - 320) < 1,
        ),
      );
      await $('div[aria-label="Resize left panel"]').doubleClick();
      await paneLayout();
      await browser.execute(() =>
        document.querySelector(".filetree-body")!.dispatchEvent(
          new WheelEvent("wheel", {
            ctrlKey: true,
            deltaY: -100,
            bubbles: true,
            cancelable: true,
          }),
        ),
      );
      await paneLayout();
      const width = await browser.execute(
        () => document.querySelector(".sidebar-slot.left .sidebar")!.getBoundingClientRect().width,
      );
      expect(width).toBe(260);
      await browser.keys([Key.Ctrl, "0"]);
      await browser.setWindowSize(720, 820);
      await paneLayout(false, false, true);
      await $('main button[aria-label="Show left panel"]').click();
      await paneLayout(true, false, true);
      await screenshot("compact");
      await browser.keys(Key.Escape);
      await paneLayout(false, false, true);
      await $('main button[aria-label="Show right panel"]').click();
      await paneLayout(false, true, true);
      await $(".overlay-scrim").click({ x: 20, y: 200 });
      await paneLayout(false, false, true);
    } finally {
      await browser.setWindowSize(original.width, original.height);
    }
  });
});
