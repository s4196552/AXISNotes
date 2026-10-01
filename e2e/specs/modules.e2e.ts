import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
const vault = process.env.AXIS_E2E_VAULT!;
const configPath = path.join(vault, ".axisnotes", "config.json");
const content = () => fs.readFileSync(path.join(vault, "Welcome.md"), "utf8");
async function features() {
  await browser.keys([Key.Ctrl, ","]);
  await $("button=Features").click();
  await $("#feature-graph").waitForDisplayed();
}
async function close() {
  await $('[aria-label="Close settings"]').click();
}
describe("bundled modules in the real desktop app", () => {
  it("starts with the local graph collapsed and loads it on request", async () => {
    await $('[data-path="Welcome.md"]').click();
    await expect($(".editor-title")).toHaveText("Welcome");
    await expect($('[data-testid="local-graph-canvas"]')).not.toExist();
    await $("button=Show local graph").click();
    await $('[data-testid="local-graph-canvas"]').waitForDisplayed();
    await $("button=Hide local graph").click();
    await expect($('[data-testid="local-graph-canvas"]')).not.toExist();
  });
  it("disables graph, AI and time tools, persists preferences and preserves the note", async () => {
    const original = content();
    await features();
    for (const id of ["graph", "aiAssist", "timeTracking"]) {
      const input = $("#feature-" + id);
      await input.waitForEnabled();
      await input.click();
    }
    await browser.waitUntil(() => {
      const c = JSON.parse(fs.readFileSync(configPath, "utf8"));
      return !c.features.graph && !c.features.aiAssist && !c.features.timeTracking;
    });
    await close();
    await expect($('[aria-label="Graph view"]')).not.toExist();
    await expect($('[aria-label="Ask AI"]')).not.toExist();
    await expect($('[aria-label="Start timer"]')).not.toExist();
    await browser.keys([Key.Ctrl, "g"]);
    await expect($('[data-testid="graph-canvas"]')).not.toExist();
    expect(content()).toBe(original);
    await browser.execute(() => location.reload());
    await $('[data-path="Welcome.md"]').waitForDisplayed();
    await $('[data-path="Welcome.md"]').click();
    await expect($('[aria-label="Ask AI"]')).not.toExist();
    await expect($('[aria-label="Start timer"]')).not.toExist();
  });
  it("reenables tools and refuses to disable a running timer", async () => {
    await features();
    for (const id of ["graph", "aiAssist", "timeTracking"]) {
      const input = $("#feature-" + id);
      await input.waitForEnabled();
      await input.click();
    }
    await close();
    await $('[aria-label="Start timer"]').waitForDisplayed();
    await $('[aria-label="Start timer"]').click();
    await browser.waitUntil(() => content().includes("time_log:"));
    await browser.execute(() => location.reload());
    await $('[data-path="Welcome.md"]').waitForDisplayed();
    await $('[data-path="Welcome.md"]').click();
    await $('[aria-label="Stop timer"]').waitForDisplayed();
    await features();
    await $("#feature-timeTracking").click();
    await expect($('[role="alert"]')).toHaveText(expect.stringContaining("Stop the running timer"));
    await expect($("#feature-timeTracking")).toBeChecked();
    await close();
    await $('[aria-label="Stop timer"]').click();
    await browser.waitUntil(() => /end:/.test(content()));
    const original = content();
    await features();
    await $("#feature-timeTracking").click();
    await close();
    expect(content()).toBe(original);
  });
  it("returns an active graph to the note and keeps it closed after reenable", async () => {
    await $('[aria-label="Graph view"]').click();
    await $('[data-testid="graph-canvas"]').waitForDisplayed();
    await features();
    await $("#feature-graph").click();
    await close();
    await expect($(".editor-title")).toHaveText("Welcome");
    await expect($('[data-testid="graph-canvas"]')).not.toExist();
    await features();
    await $("#feature-graph").click();
    await close();
    await expect($(".editor-title")).toHaveText("Welcome");
    await expect($('[data-testid="graph-canvas"]')).not.toExist();
    await browser.keys([Key.Ctrl, "g"]);
    await $('[data-testid="graph-canvas"]').waitForDisplayed();
  });
});
