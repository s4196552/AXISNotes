import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// Phase 3 acceptance on the real app and disk: a grid with formulas saves and reloads
// identically; a canvas holds live note cards and freehand drawings. Also the tasks view,
// computed properties and time tracking.

const vault = process.env.AXIS_E2E_VAULT!;
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) => fs.readFileSync(onDisk(rel), "utf8");
const json = (rel: string) => JSON.parse(read(rel)) as Record<string, unknown>;
const row = (rel: string) => $(`[data-path="${rel}"]`);
const cell = (addr: string) => $(`[data-addr="${addr}"]`);
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "phase-3");

async function snapshot(name: string) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await browser.saveScreenshot(path.join(QA_DIR, `${name}.png`));
}

async function status(text: string) {
  await browser.waitUntil(async () => (await $('[role="status"]').getText()) === text, {
    timeoutMsg: `status never became "${text}"`,
  });
}

describe("Phase 3: grids, canvases and structured data on a real vault", () => {
  it("edits a grid with formulas and saves it", async () => {
    await row("Budget.axgrid").click();
    await expect(cell("B4")).toHaveText("7.5");
    await cell("B2").click();
    await browser.keys(["1", "0", Key.Enter]);
    await expect(cell("B4")).toHaveText("14.5");
    // A formula typed through the formula bar.
    await cell("C4").click();
    await $('[aria-label="Formula bar"]').click();
    await browser.keys(["=B4*2", Key.Enter]);
    await expect(cell("C4")).toHaveText("29");
    await browser.waitUntil(() => {
      const cells = json("Budget.axgrid").cells as Record<string, string>;
      return cells.B2 === "10" && cells.C4 === "=B4*2";
    });
    await status("Saved");
    await snapshot("01-grid");
  });

  it("reloads the grid identically without rewriting it", async () => {
    const saved = read("Budget.axgrid");
    const mtime = fs.statSync(onDisk("Budget.axgrid")).mtimeMs;
    await row("Bio.md").click();
    await expect($(".editor-title")).toHaveText("Bio");
    await row("Budget.axgrid").click();
    await expect(cell("C4")).toHaveText("29");
    await expect(cell("B4")).toHaveText("14.5");
    await expect(cell("A1")).toHaveElementClass("bold");
    await browser.pause(1200); // longer than the autosave delay
    expect(read("Budget.axgrid")).toBe(saved);
    expect(fs.statSync(onDisk("Budget.axgrid")).mtimeMs).toBe(mtime);
  });

  it("adds a live note card to a canvas and draws on it", async () => {
    await row("Board.axcanvas").click();
    const canvas = $("canvas.interactive");
    await canvas.waitForDisplayed({ timeout: 20_000 }); // Excalidraw is lazy-loaded

    await $("button*=Add note card").click();
    await browser.keys("Bio");
    await browser.keys(Key.Enter);
    const card = $('[data-card-path="Bio.md"]');
    await card.waitForDisplayed();
    await expect(card).toHaveText(expect.stringContaining("mitochondria"));

    // Freehand: pen tool (7), then drag across the lower-left of the canvas.
    const size = await canvas.getSize();
    await canvas.click({
      x: -Math.floor(size.width / 2) + 60,
      y: Math.floor(size.height / 2) - 60,
    });
    await browser.keys("7");
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({
        origin: canvas,
        x: -Math.floor(size.width / 2) + 80,
        y: Math.floor(size.height / 2) - 120,
      })
      .down()
      .move({
        origin: canvas,
        x: -Math.floor(size.width / 2) + 140,
        y: Math.floor(size.height / 2) - 90,
        duration: 150,
      })
      .move({
        origin: canvas,
        x: -Math.floor(size.width / 2) + 220,
        y: Math.floor(size.height / 2) - 130,
        duration: 150,
      })
      .up()
      .perform();

    await browser.waitUntil(
      () => {
        const els = json("Board.axcanvas").elements as { type: string; link?: string }[];
        return (
          els.some((e) => e.type === "embeddable" && e.link === "axis:Bio.md") &&
          els.some((e) => e.type === "freedraw")
        );
      },
      { timeout: 10_000, timeoutMsg: "card and drawing not saved to Board.axcanvas" },
    );
    await snapshot("02-canvas");
  });

  it("shows the card and drawing again after reopening, and follows note edits", async () => {
    await row("Bio.md").click();
    await expect($(".editor-title")).toHaveText("Bio");
    fs.writeFileSync(onDisk("Bio.md"), "# Cells\n\nRibosomes build proteins.\n");
    await row("Board.axcanvas").click();
    const card = $('[data-card-path="Bio.md"]');
    await card.waitForDisplayed({ timeout: 20_000 });
    await expect(card).toHaveText(expect.stringContaining("Ribosomes"));
    const els = json("Board.axcanvas").elements as { type: string }[];
    expect(els.filter((e) => e.type === "freedraw")).toHaveLength(1);
  });

  it("completes a task from the tasks view", async () => {
    await $('[aria-label="Tasks"]').click();
    await expect($('[aria-label="Overdue"]')).toHaveText(expect.stringContaining("Water plants"));
    await $('[aria-label="Complete: Water plants"]').click();
    await browser.waitUntil(
      () => /- \[x\] Water plants 📅 2026-01-02 ⏫ ✅ \d{4}-\d{2}-\d{2}/.test(read("Todo.md")),
      {
        timeoutMsg: "task not completed in Todo.md",
      },
    );
    await snapshot("03-tasks");
  });

  it("evaluates computed properties and tracks time in the note", async () => {
    await row("Trip.md").click();
    await expect($('[aria-label="Result of total"]')).toHaveText("= 705");
    await $('[aria-label="Start timer"]').click();
    await $('[role="timer"]').waitForDisplayed();
    await browser.pause(1500);
    await $('[aria-label="Stop timer"]').click();
    await browser.waitUntil(() => /time_log:\n\s+- start: \S+\n\s+end: \S+/.test(read("Trip.md")), {
      timeoutMsg: "time entry not closed in Trip.md",
    });
    await $('[aria-label="Time report"]').click();
    await expect($('[aria-label="Time by group"]')).toHaveText(expect.stringContaining("Trip"));
    await snapshot("04-time");
  });
});
