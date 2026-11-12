import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";

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
  it("uses one library across the dashboard and sidebar and preserves it when disabled", async () => {
    const config = process.env.AXIS_CONFIG_DIR!;
    const fixture = path.join(config, "Where's app #1 (100%).exe");
    fs.copyFileSync(path.join(process.env.SystemRoot!, "System32", "where.exe"), fixture);

    const sidebar = ".sidebar:not(.sidebar-right) [data-axis-hub]";
    const dashboard = '.dashboard-widget[aria-label="AXIS Hub"] [data-axis-hub]';
    const sidebarTab = () => $('[role="tab"][aria-label="AXIS Hub"]');

    await $(".shell").waitForDisplayed();
    await $('button[aria-label="Home"]').click();
    await $("button=Customize").click();
    await $('section[aria-label="Add a widget"]').$("button*=AXIS Hub").click();
    await $("button=Done").click();
    await hubText(dashboard, ".group-name", "Favorites");

    await sidebarTab().click();
    await hubText(sidebar, ".group-name", "Favorites");
    await hubControl(sidebar, "#add-group");
    await hubControl(sidebar, '#dialog input[placeholder="e.g. Gaming"]', "Studio");
    await hubControl(sidebar, '#dialog button[type="submit"]');
    await hubText(sidebar, "#page-title", "Studio");
    await hubText(dashboard, "#content", "Studio");

    await hubControl(sidebar, "#add-shortcut");
    await hubControl(sidebar, '#dialog input[placeholder="e.g. Project files"]', "Where fixture");
    await hubControl(sidebar, "#dialog input[required]:not([maxlength='100'])", fixture);
    await hubControl(sidebar, '#dialog button[type="submit"]');
    await hubText(sidebar, ".shortcut-label", "Where fixture");
    const tile = '[aria-label="Open Where fixture"]';
    await hubControl(dashboard, tile);
    await hubText(dashboard, "#notice", "Opened Where fixture");
    expect(await browser.getWindowHandles()).toHaveLength(1);

    const saved = JSON.parse(fs.readFileSync(path.join(config, "hub", "library.json"), "utf8"));
    expect(
      saved.plugins[0].groups.find((group: { name: string }) => group.name === "Studio")
        .shortcuts[0].target,
    ).toEqual({ kind: "path", path: fixture });

    await $('button[aria-label="Settings"]').click();
    const settings = $('[role="dialog"][aria-label="Settings"]');
    await settings.$("button=Plugins").click();
    const enabled = settings.$('input[type="checkbox"]');
    await enabled.click();
    await expect(sidebarTab()).not.toExist();
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
    await sidebarTab().click();
    await hubText(sidebar, "#content", "Studio");
    expect(
      await browser.execute(() => {
        const hub = document.querySelector(".sidebar-hub")!;
        const sidebar = hub.closest(".sidebar")!;
        const time = sidebar.querySelector('[aria-label="Time report"]')!;
        return (
          getComputedStyle(hub).overflowY === "auto" &&
          time.getBoundingClientRect().right <= sidebar.getBoundingClientRect().right
        );
      }),
    ).toBe(true);
    await $('.dashboard-widget[aria-label="AXIS Hub"]').scrollIntoView();

    const qa = path.resolve(".agents/qa/T-230");
    fs.mkdirSync(qa, { recursive: true });
    await browser.saveScreenshot(path.join(qa, "embedded-hub.png"));
  });
});
