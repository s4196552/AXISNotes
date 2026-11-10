import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const qa = path.resolve(".agents/qa/T-218");
const vault = process.env.AXIS_E2E_VAULT!;
async function settings() {
  await $(".shell").waitForDisplayed();
  await browser.keys([Key.Ctrl, ","]);
  await browser.keys(Key.Ctrl);
  await $('[aria-label="App logo"]').waitForDisplayed();
}
async function loaded() {
  await browser.waitUntil(() =>
    browser.execute(() => {
      const image = document.querySelector<HTMLImageElement>(
        '[aria-label="App logo"] img.app-logo',
      );
      return Boolean(image?.complete && image.naturalWidth);
    }),
  );
}
describe("Custom app logo and default pack", () => {
  before(() => {
    fs.mkdirSync(qa, { recursive: true });
  });
  it("renders both supplied designs, persists the choice and restores the original", async () => {
    await settings();
    for (const title of ["AXIS Risograph", "AXIS Neon"]) {
      await $(`button=${title}`).click();
      await loaded();
      await expect($(`button=${title}`)).toHaveAttribute("aria-pressed", "true");
      await browser.saveScreenshot(path.join(qa, `${title}.png`));
    }
    await browser.waitUntil(() =>
      fs
        .readFileSync(path.join(vault, ".axisnotes/config.json"), "utf8")
        .includes("builtin:axis-neon.png"),
    );
    await browser.refresh();
    await settings();
    await expect($("button=AXIS Neon")).toHaveAttribute("aria-pressed", "true");
    await loaded();
    await $("button=Restore original logo").click();
    await expect($("button=AXIS Original")).toHaveAttribute("aria-pressed", "true");
    await loaded();
  });
  it("renders a custom image imported through the native backend", async () => {
    const source = path.resolve("src/assets/logos/risograph.png");
    const result = (await browser.executeAsync(
      (sourcePath: string, done: (result: unknown) => void) => {
        const host = window as unknown as {
          __TAURI_INTERNALS__: { invoke(c: string, a: object): Promise<unknown> };
        };
        host.__TAURI_INTERNALS__
          .invoke("import_image", { source: sourcePath, folder: "Attachments/Branding" })
          .then(done, (error: unknown) => done({ error }));
      },
      source,
    )) as { path: string; error?: unknown };
    expect(result.error).toBeUndefined();
    expect(fs.readFileSync(path.join(vault, result.path))).toEqual(fs.readFileSync(source));
    const configPath = path.join(vault, ".axisnotes/config.json");
    const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
    config.appearance.logo = result.path;
    fs.writeFileSync(configPath, JSON.stringify(config));
    await browser.refresh();
    await settings();
    await loaded();
    expect(await $('[aria-label="App logo"] img.app-logo').getAttribute("src")).toContain(
      "Branding",
    );
    await browser.saveScreenshot(path.join(qa, "custom-logo.png"));
  });
});
