import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { captureUi, inspectRenderedElement } from "../helpers/diagnostics";

// Preserve native text assertions while capturing independent rendering evidence.
describe("native rendered-text diagnostics", () => {
  it("reads the visible title of a seeded note", async () => {
    await $('[data-path="Welcome.md"]').click();
    await $(".editor-title").waitForDisplayed();
    console.log(`Title probe: ${JSON.stringify(await inspectRenderedElement(".editor-title"))}`);
    await captureUi("probe-note-title", [".editor-title"]);
    await expect($(".editor-title")).toHaveText("Welcome");
  });
  it("reads a visible computed grid cell", async () => {
    await $('[data-path="Budget.axgrid"]').click();
    await $('[data-addr="B4"]').waitForDisplayed();
    await browser.waitUntil(
      async () => (await inspectRenderedElement('[data-addr="B4"]')).dom?.textContent === "7.5",
    );
    console.log(`Grid probe: ${JSON.stringify(await inspectRenderedElement('[data-addr="B4"]'))}`);
    await captureUi("probe-grid-cell", ['[data-addr="B4"]']);
    await expect($('[data-addr="B4"]')).toHaveText("7.5");
  });
  it("refuses capture when the native app has a different vault open", async () => {
    const original = process.env.AXIS_E2E_VAULT;
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "axis-e2e-capture-"));
    const marker = path.join(other, ".axis-e2e-fixture.json");
    fs.writeFileSync(marker, JSON.stringify({ nonce: process.env.AXIS_E2E_CAPTURE_NONCE }));
    const artifacts = process.env.AXIS_E2E_ARTIFACTS ?? path.resolve(".agents/logs/e2e-artifacts");
    const before = fs.existsSync(artifacts) ? fs.readdirSync(artifacts) : [];
    try {
      process.env.AXIS_E2E_VAULT = other;
      await expect(captureUi("must-not-capture-other-vault")).rejects.toThrow(
        "native app is not using the fixture vault",
      );
      expect(fs.existsSync(artifacts) ? fs.readdirSync(artifacts) : []).toEqual(before);
    } finally {
      process.env.AXIS_E2E_VAULT = original;
      fs.unlinkSync(marker);
      fs.rmdirSync(other);
    }
  });
});
