import fs from "node:fs";
import path from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// Phase 2 acceptance on the real app and disk: embed a single bullet from another note and
// edit it in place (the source file changes), block-reference completion, outliner keys,
// and the graph view.

const vault = process.env.AXIS_E2E_VAULT!;
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) => fs.readFileSync(onDisk(rel), "utf8");
const row = (rel: string) => $(`[data-path="${rel}"]`);
const title = () => $(".editor-title");
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "phase-2");

async function snapshot(name: string) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await browser.saveScreenshot(path.join(QA_DIR, `${name}.png`));
}

async function untilEquals(actual: () => string, expected: string) {
  let last = "";
  try {
    await browser.waitUntil(() => (last = actual()) === expected);
  } catch {
    throw new Error(`expected ${JSON.stringify(expected)}, got ${JSON.stringify(last)}`);
  }
}

async function acceptCompletion() {
  await $(".cm-tooltip-autocomplete").waitForDisplayed();
  await browser.pause(150); // CodeMirror ignores Enter right after the popup opens
  await browser.keys(Key.Enter);
}

describe("Phase 2: blocks, outliner and graph on a real vault", () => {
  it("embeds a single bullet from another note", async () => {
    await row("Plan.md").click();
    await expect(title()).toHaveText("Plan");
    const embedded = $('[aria-label="Embedded Groceries#^m1"]');
    await embedded.waitForDisplayed();
    await expect(embedded).toHaveText(expect.stringContaining("milk"));
    await expect(embedded).toHaveText(expect.stringContaining("oat"));
    await expect(embedded).not.toHaveText(expect.stringContaining("eggs"));
    await snapshot("01-embed");
  });

  it("edits the embedded bullet in place and updates the source file", async () => {
    const embedded = $('[aria-label="Embedded Groceries#^m1"]');
    await embedded.click();
    await browser.keys([Key.Ctrl, Key.Home]);
    for (let i = 0; i < "- milk".length; i++) await browser.keys(Key.ArrowRight);
    await browser.keys(" 2L");
    await untilEquals(
      () => read("Groceries.md"),
      "# Groceries\n\n- eggs\n- milk 2L ^m1\n  - oat\n- bread\n",
    );
    // The note holding the embed is unchanged.
    expect(read("Plan.md")).toBe("# Plan\n\nThis week:\n\n![[Groceries#^m1]]\n\nMore text.\n");
  });

  it("completes [[Note#^ block references and adds the id to the target", async () => {
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys([Key.Enter, "[[Groceries#^bre"]);
    await acceptCompletion();
    await browser.waitUntil(() => /- bread \^[a-z0-9]{6}\n$/.test(read("Groceries.md")), {
      timeoutMsg: "id not added to Groceries.md",
    });
    const id = /- bread \^([a-z0-9]{6})/.exec(read("Groceries.md"))![1];
    await browser.waitUntil(() => read("Plan.md").includes(`[[Groceries#^${id}]]`), {
      timeoutMsg: "block link not saved in Plan.md",
    });
  });

  it("indents and moves list items with the keyboard", async () => {
    await row("Outline.md").click();
    await expect(title()).toHaveText("Outline");
    // Put the cursor at the end of "- b" by clicking its line.
    const lines = await $$(".cm-content .cm-line");
    await lines[1]!.click();
    await browser.keys(Key.End);
    await browser.keys(Key.Tab);
    await untilEquals(() => read("Outline.md"), "- a\n  - b\n    - b1\n- c\n");
    await browser.keys([Key.Shift, Key.Tab]);
    await browser.keys([Key.Alt, Key.ArrowDown]);
    await untilEquals(() => read("Outline.md"), "- a\n- c\n- b\n  - b1\n");
  });

  it("shows the vault graph and opens a note from it", async () => {
    await browser.keys([Key.Ctrl, "g"]);
    const count = $(".graph-count");
    await expect(count).toHaveText(expect.stringMatching(/3 notes · 1 link$/));
    const canvas = $('[data-testid="graph-canvas"]');
    await browser.waitUntil(
      () =>
        browser.execute(() =>
          Boolean(
            (
              document.querySelector('[data-testid="graph-canvas"]') as HTMLElement & {
                __sigma?: unknown;
              }
            ).__sigma,
          ),
        ),
      { timeoutMsg: "graph renderer did not start" },
    );
    await expect(canvas.$("canvas")).toBeExisting();
    await browser.pause(800); // let the layout settle for the screenshot
    await snapshot("02-graph");

    // WebGL nodes can't be clicked by label; fire sigma's click event for the node.
    await browser.execute(() => {
      const el = document.querySelector('[data-testid="graph-canvas"]') as HTMLElement & {
        __sigma?: { emit(e: string, p: unknown): void };
      };
      el.__sigma!.emit("clickNode", { node: "Groceries.md" });
    });
    await expect(title()).toHaveText("Groceries");
    // The header is CSS-uppercased, and WebDriver returns rendered text.
    await expect($('[aria-label="Local graph"]')).toHaveText(expect.stringMatching(/2 notes/i));
    await snapshot("03-local-graph");
  });
});
