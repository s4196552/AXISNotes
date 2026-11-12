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

async function hubDrag(host: string, from: string, to: string, fraction = 0.5, cancel = false) {
  const points = await browser.execute(
    (host, from, to, fraction) => {
      const root = document.querySelector(host)!.shadowRoot!;
      const source = root.querySelector(from)!;
      const target = root.querySelector(to)!;
      source.scrollIntoView({ block: "nearest" });
      target.scrollIntoView({ block: "nearest" });
      return [source, target].map((element, index) => {
        const box = element.getBoundingClientRect();
        const at = index === 0 ? 0.5 : fraction;
        return {
          x: Math.round(box.left + box.width * at),
          y: Math.round(box.top + box.height * at),
        };
      });
    },
    host,
    from,
    to,
    fraction,
  );
  const device = { id: "hub-pointer" };
  const pointer = browser.action("pointer", device).move(points[0]!).down();
  pointer.move({ ...points[1]!, duration: 120 });
  if (cancel) {
    const highlighted = () =>
      browser.execute(
        (host) => !!document.querySelector(host)?.shadowRoot?.querySelector("[data-hub-drop]"),
        host,
      );
    await pointer.perform(true);
    expect(await highlighted()).toBe(true);
    await browser.action("key").down(Key.Escape).up(Key.Escape).perform(true);
    expect(await highlighted()).toBe(false);
    await browser.action("pointer", device).up().perform(true);
  } else await pointer.up().perform(true);
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

  it("reorders and moves shortcuts and nested groups with real pointer gestures", async function () {
    this.timeout(120_000);
    const libraryPath = path.join(process.env.AXIS_CONFIG_DIR!, "hub", "library.json");
    const makeShortcut = (id: string) => ({
      id,
      name: id,
      target: { kind: "path", path: path.join(process.env.AXIS_CONFIG_DIR!, `${id}.txt`) },
      icon: null,
    });
    fs.mkdirSync(path.dirname(libraryPath), { recursive: true });
    fs.writeFileSync(
      libraryPath,
      JSON.stringify({
        version: 1,
        plugins: [
          {
            id: "launcher",
            name: "Launcher",
            enabled: true,
            groups: [
              {
                id: "projects",
                name: "Projects",
                color: "mint",
                groups: [],
                shortcuts: ["Alpha", "Beta", "Gamma"].map(makeShortcut),
              },
              { id: "tools", name: "Tools", color: "blue", groups: [], shortcuts: [] },
            ],
          },
        ],
      }),
    );
    const groups = () => JSON.parse(fs.readFileSync(libraryPath, "utf8")).plugins[0].groups;
    const hub = ".sidebar-right [data-axis-hub]";
    await browser.refresh();
    await $(".shell").waitForDisplayed();
    const showRight = $('button[aria-label="Show right panel"]');
    if (await showRight.isDisplayed()) await showRight.click();
    await $(".sidebar-right").$("button=AXIS Hub").click();
    await hubText(hub, "#content", "Projects");
    await hubControl(hub, '[data-hub-group="projects"] .group-open');
    await hubText(hub, "#page-title", "Projects");

    await hubDrag(
      hub,
      '[data-hub-shortcut="Gamma"] .hub-drag-grip',
      '[data-hub-shortcut="Alpha"]',
      0.14,
    );
    await hubText(hub, "#notice", "Shortcut order saved");
    expect(groups()[0].shortcuts.map(({ id }: { id: string }) => id)).toEqual([
      "Gamma",
      "Alpha",
      "Beta",
    ]);

    await hubControl(hub, "#nav-home");
    await hubDrag(hub, '[data-hub-shortcut="Gamma"]', '[data-hub-group="tools"]', 0.5, true);
    expect(groups()[1].shortcuts).toEqual([]);
    await hubDrag(hub, '[data-hub-shortcut="Gamma"]', '[data-hub-group="tools"]');
    await hubText(hub, "#notice", "Moved Gamma");
    expect(groups()[1].shortcuts).toEqual([makeShortcut("Gamma")]);

    const tools = '[data-hub-group="tools"] .hub-drag-grip';
    const projects = '[data-hub-group="projects"]';
    await hubDrag(hub, tools, projects, 0.14);
    await hubText(hub, "#notice", "Group order saved");
    expect(groups().map(({ id }: { id: string }) => id)).toEqual(["tools", "projects"]);

    await hubDrag(hub, tools, projects);
    await hubText(hub, "#notice", "Moved Tools");
    expect(groups()[0].groups[0].shortcuts).toEqual([makeShortcut("Gamma")]);

    await hubControl(hub, `${projects} .group-open`);
    await hubText(hub, "#page-title", "Projects");
    await hubDrag(hub, tools, "[data-hub-parent]");
    await hubControl(hub, "#nav-home");
    await hubText(hub, '#content [data-hub-group="tools"]', "Tools");
    expect(groups().map(({ id }: { id: string }) => id)).toEqual(["projects", "tools"]);
    expect(groups()[0].groups).toEqual([]);
    expect(groups()[1].shortcuts).toEqual([makeShortcut("Gamma")]);
  });
});
