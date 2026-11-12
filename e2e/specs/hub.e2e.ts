import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const windows = process.platform === "win32" ? describe : describe.skip;

// WebView2's WebDriver does not provide usable element IDs for these shadow descendants.
// Operate on the bundled controls through their DOM, then assert the actual view and native state.
async function hubText(host: string, selector: string, expected: string) {
  let observed: string | null = null;
  try {
    await browser.waitUntil(async () => {
      observed = await browser.execute(
        (host, selector) =>
          document.querySelector(host)?.shadowRoot?.querySelector(selector)?.textContent?.trim() ??
          null,
        host,
        selector,
      );
      return observed?.includes(expected) ?? false;
    });
  } catch (error) {
    throw new Error(`Expected ${host} ${selector} to contain ${expected}; saw ${observed}`, {
      cause: error,
    });
  }
}

async function hubControl(host: string, selector: string, value?: string) {
  await browser.waitUntil(() =>
    browser.execute(
      (host, selector, value) => {
        const element = document
          .querySelector(host)
          ?.shadowRoot?.querySelector<HTMLElement>(selector);
        if (!element || element.hidden || element.matches(":disabled")) return false;
        if (value !== undefined && element instanceof HTMLInputElement) {
          element.value = value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
        } else element.click();
        return true;
      },
      host,
      selector,
      value,
    ),
  );
}

windows("AXIS Hub plugin", () => {
  it("uses one library across the dashboard and both sidebars and preserves it when disabled", async () => {
    const config = process.env.AXIS_CONFIG_DIR!;
    const fixture = path.join(config, "Where's app #1 (100%).exe");
    fs.copyFileSync(path.join(process.env.SystemRoot!, "System32", "where.exe"), fixture);

    const leftHub = ".sidebar:not(.sidebar-right) [data-axis-hub]";
    const rightHub = ".sidebar-right [data-axis-hub]";
    const dashboard = '.dashboard-widget[aria-label="AXIS Hub"] [data-axis-hub]';
    const leftTab = () => $('.sidebar:not(.sidebar-right) [role="tab"][aria-label="AXIS Hub"]');
    const rightSidebar = () => $(".sidebar-right");
    const rightTab = () => rightSidebar().$("button=AXIS Hub");

    await $(".shell").waitForDisplayed();
    await $('button[aria-label="Home"]').click();
    await $("button=Customize").click();
    await $('section[aria-label="Add a widget"]').$("button*=AXIS Hub").click();
    await $("button=Done").click();
    await hubText(dashboard, ".group-name", "Favorites");

    const showRight = () => $('button[aria-label="Show right panel"]');
    if (await showRight().isDisplayed()) await showRight().click();
    await rightTab().click();
    await expect(rightTab()).toHaveAttribute("aria-selected", "true");
    await hubText(rightHub, ".group-name", "Favorites");
    await hubControl(rightHub, "#add-group");
    await hubControl(rightHub, '#dialog input[placeholder="e.g. Gaming"]', "Studio");
    await hubControl(rightHub, '#dialog button[type="submit"]');
    await hubText(rightHub, "#page-title", "Studio");
    await hubText(dashboard, "#content", "Studio");

    await hubControl(rightHub, "#add-shortcut");
    await hubControl(rightHub, '#dialog input[placeholder="e.g. Project files"]', "Where fixture");
    await hubControl(rightHub, "#dialog input[required]:not([maxlength='100'])", fixture);
    await hubControl(rightHub, '#dialog button[type="submit"]');
    await hubText(rightHub, ".shortcut-label", "Where fixture");
    const tile = '[aria-label="Open Where fixture"]';
    await hubControl(dashboard, tile);
    await hubText(dashboard, "#notice", "Opened Where fixture");
    expect(await browser.getWindowHandles()).toHaveLength(1);

    const saved = JSON.parse(fs.readFileSync(path.join(config, "hub", "library.json"), "utf8"));
    expect(
      saved.plugins[0].groups.find((group: { name: string }) => group.name === "Studio")
        .shortcuts[0].target,
    ).toEqual({ kind: "path", path: fixture });

    await rightSidebar().$("button=AI chat").click();
    await expect(rightSidebar().$("button=AI chat")).toHaveAttribute("aria-selected", "true");
    await expect($(rightHub)).not.toExist();
    await rightSidebar().$("button=Note details").click();
    await expect(rightSidebar().$("button=Note details")).toHaveAttribute("aria-selected", "true");
    await rightTab().click();
    await hubText(rightHub, "#content", "Studio");
    await $('button[aria-label="Hide right panel"]').click();
    await expect($(rightHub)).not.toExist();
    await showRight().click();
    await expect(rightTab()).toHaveAttribute("aria-selected", "true");
    await hubText(rightHub, "#content", "Studio");

    await $('button[aria-label="Settings"]').click();
    const settings = $('[role="dialog"][aria-label="Settings"]');
    await settings.$("button=Plugins").click();
    const enabled = settings.$('input[type="checkbox"]');
    await enabled.click();
    await expect(leftTab()).not.toExist();
    await expect(rightTab()).not.toExist();
    await expect($(rightHub)).not.toExist();
    await expect(rightSidebar().$("button=Note details")).toHaveAttribute("aria-selected", "true");
    await expect($(dashboard)).not.toExist();
    await enabled.click();
    await settings.$("button=Manage shortcut packs").click();
    const manager = '[data-axis-hub="settings"]';
    await hubText(manager, "#page-title", "Shortcut packs");
    await hubControl(manager, ".plugins-view .section-actions button:nth-child(2)");
    await hubControl(manager, '#dialog input[placeholder="Plugin name"]', "Workshop");
    await hubControl(manager, '#dialog button[type="submit"]');
    await hubText(manager, "#page-title", "Workshop");
    await settings.$('button[aria-label="Close settings"]').click();
    await hubText(dashboard, "#content", "Studio");
    await hubText(rightHub, "#content", "Studio");
    await leftTab().click();
    await hubText(leftHub, "#content", "Studio");
    expect(
      await browser.execute(() => {
        const left = document.querySelector(".sidebar:not(.sidebar-right)")!;
        const right = document.querySelector(".sidebar-right")!;
        const time = left.querySelector('[aria-label="Time report"]')!;
        return (
          getComputedStyle(right.querySelector(".sidebar-hub")!).overflowY === "auto" &&
          time.getBoundingClientRect().right <= left.getBoundingClientRect().right
        );
      }),
    ).toBe(true);
    await $('.sidebar:not(.sidebar-right) [role="tab"][aria-label="Files"]').click();
    await browser.refresh();
    await $(".shell").waitForDisplayed();
    await $('button[aria-label="Home"]').click();
    if (await showRight().isDisplayed()) await showRight().click();
    await expect(rightTab()).toHaveAttribute("aria-selected", "true");
    await hubText(rightHub, "#content", "Studio");
    await hubText(dashboard, "#content", "Studio");
    await $('.dashboard-widget[aria-label="AXIS Hub"]').scrollIntoView();

    const qa = path.resolve(".agents/qa/T-231");
    fs.mkdirSync(qa, { recursive: true });
    await browser.saveScreenshot(path.join(qa, "right-sidebar-hub.png"));

    const resizer = '[aria-label="Resize right panel"]';
    await browser.execute(
      (selector) => document.querySelector<HTMLElement>(selector)?.focus(),
      resizer,
    );
    await browser.keys(Key.Home);
    await expect($(resizer)).toHaveAttribute("aria-valuenow", "180");
    expect(
      await browser.execute(() => {
        const tabs = document.querySelector(".sidebar-right .sidebar-tabs")!;
        const bounds = tabs.getBoundingClientRect();
        return [...tabs.querySelectorAll("button")].every((button) => {
          const { right, bottom } = button.getBoundingClientRect();
          return right <= bounds.right && bottom <= bounds.bottom;
        });
      }),
    ).toBe(true);
    await hubText(rightHub, "#content", "Studio");
  });
});
