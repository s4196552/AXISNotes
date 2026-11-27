import fs from "node:fs";
import path from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const vault = process.env.AXIS_E2E_VAULT!;
const file = (name: string) => path.join(vault, name);
const costs = `|Category|Hardware/Software|Administration|Facilities cost|
|---|---|---|---|
|1. Server Costs|Hardware: server, rack chassis, PDUs, TOR switches (+ maintenance). Software: OS, virtualization licenses (+ maintenance)|—|Space, Power, Cooling|
|2. Storage Costs|Hardware: storage disks, SAN or FC switches|Storage administration costs|Space, Power, Cooling|
|3. Network Costs|Network hardware: LAN switches, load balancer bandwidth costs|Network administration costs|Space, Power, Cooling|
|4. IT Labor Costs|—|Server administration costs|—|`;
async function open(name: string) {
  const row = $(`[data-path="${name}.md"]`);
  await row.waitForExist({ timeout: 15000 });
  await row.click();
  await expect($('input[aria-label="Note title"]')).toHaveValue(name);
}
async function snapshot(name: string) {
  const dir = path.resolve(".agents/qa/T-125");
  fs.mkdirSync(dir, { recursive: true });
  await browser.saveScreenshot(path.join(dir, name + ".png"));
}

describe("Obsidian tables and image layout on the real app (T-125)", () => {
  it("renders the exact supplied table without rewriting the file", async () => {
    await $(".filetree").waitForExist({ timeout: 15000 });
    fs.writeFileSync(file("Costs.md"), costs);
    await open("Costs");
    await $(".cm-markdown-table table").waitForExist();
    await expect($$(".cm-markdown-table th")).toBeElementsArrayOfSize(4);
    await expect($$(".cm-markdown-table tr")).toBeElementsArrayOfSize(5);
    expect(fs.readFileSync(file("Costs.md"), "utf8")).toBe(costs);
    await snapshot("01-costs-table");
  });
  it("edits a cell, saves Markdown, and switches between source and preview", async () => {
    const widths = () =>
      browser.execute(() =>
        [...document.querySelectorAll(".cm-markdown-table tr:first-child > *")].map(
          (cell) => cell.getBoundingClientRect().width,
        ),
      );
    const before = await widths();
    await $('.cm-markdown-table td[aria-label="Row 1, column 3"]').click();
    await expect($$(".cm-markdown-table textarea")).toBeElementsArrayOfSize(1);
    expect(await widths()).toEqual(before);
    await expect($$(".cm-markdown-table th")).toBeElementsArrayOfSize(4);
    await expect($('textarea[aria-label="Row 1, column 3"]')).toBeFocused();
    // WebDriver clearElement blurs the input. Use the user's actual selection/
    // typing sequence for an editor that intentionally closes on blur.
    await browser.keys([Key.Ctrl, "a"]);
    await browser.keys(Key.Ctrl);
    await browser.keys("Reviewed administration");
    await browser.waitUntil(() =>
      fs.readFileSync(file("Costs.md"), "utf8").includes("Reviewed administration"),
    );
    expect(fs.readFileSync(file("Costs.md"), "utf8")).toBe(
      costs.replace("|—|Space", "|Reviewed administration|Space"),
    );
    const dir = path.resolve(".agents/qa/T-134");
    fs.mkdirSync(dir, { recursive: true });
    await browser.saveScreenshot(path.join(dir, "direct-cell-edit.png"));
    await browser.keys("Tab");
    await expect($('textarea[aria-label="Row 1, column 4"]')).toBeFocused();
    // Since T-259 Enter goes to the cell below, as in Obsidian; Escape closes the editor.
    await browser.keys("Enter");
    await expect($('textarea[aria-label="Row 2, column 4"]')).toBeFocused();
    await browser.keys("Escape");
    await expect($$(".cm-markdown-table textarea")).toBeElementsArrayOfSize(0);
    expect(fs.readFileSync(file("Costs.md"), "utf8")).toBe(
      costs.replace("|—|Space", "|Reviewed administration|Space"),
    );
    await expect($(".cm-markdown-table table")).toHaveText(
      expect.stringContaining("Reviewed administration"),
    );
    await $('.cm-markdown-table td[aria-label="Row 1, column 1"]').click({ button: "right" });
    await $(".cm-table-menu").$("button=Edit as Markdown").click();
    await expect($(".cm-markdown-table table")).not.toExist();
    await $(".cm-table-tools").$("button=Show table").click();
    await expect($(".cm-markdown-table table")).toExist();
    await open("Media");
    await open("Costs");
    await expect($(".cm-markdown-table table")).toHaveText(
      expect.stringContaining("Reviewed administration"),
    );
  });
  it("keeps the supplied plan columns aligned and scrolls them inside a narrow note (T-126)", async () => {
    const plans = `| **Plan**           | **Best For**         | **Support Access**                     | **Min. Cost** | **Response Time** |
| ------------------ | -------------------- | -------------------------------------- | ------------- | ----------------- |
| **Basic**              | Early Learning       | 24/7 self-service & billing            | Free          | N/A               |
| **Business Support +** | Production Workloads | 24/7 AI-first & expert chat/phone      | $29/mo        | < 30 mins         |
| **Enterprise Support** | Business-Critical    | Designated TAM & White-glove concierge | $5,000/mo     | < 15 mins         |
| **Unified Operations** | Mission-Critical     | Designated team & managed Incident ops | $50,000/mo    | < 5 mins          |`;
    fs.writeFileSync(file("Plans.md"), plans);
    await open("Plans");
    await expect($$(".cm-markdown-table th")).toBeElementsArrayOfSize(5);
    await expect($(".cm-markdown-table table")).toHaveText(expect.stringContaining("< 30 mins"));
    expect(fs.readFileSync(file("Plans.md"), "utf8")).toBe(plans);
    // Since T-259 cells can shrink to 96px, so at the window's minimum width (720px) this
    // table fits by wrapping. Beside another note it can't: that is the narrow note here.
    await $('[data-path="Media.md"]').click({ button: "right" });
    await $('[role="menuitem"]=Open in split screen').click();
    await browser.waitUntil(async () => (await $$(".pane").length) === 2);
    const originalSize = await browser.getWindowSize();
    try {
      await browser.setWindowSize(720, 820);
      const measure = () =>
        browser.execute(() => {
          const scroll = document.querySelector<HTMLElement>(".cm-table-scroll")!;
          const editor = scroll.closest<HTMLElement>(".cm-scroller")!;
          const rows = [...scroll.querySelectorAll("tr")].map((row) =>
            [...row.cells].map((cell) => cell.getBoundingClientRect().width),
          );
          return {
            contained:
              scroll.getBoundingClientRect().right <= document.documentElement.clientWidth + 1,
            scrolls: scroll.scrollWidth > scroll.clientWidth,
            noteFits: editor.scrollWidth <= editor.clientWidth + 1,
            aligned: rows.every((row) =>
              row.every((width, i) => Math.abs(width - rows[0]![i]!) < 1),
            ),
          };
        });
      await browser.waitUntil(async () => (await measure()).scrolls);
      expect(await measure()).toEqual({
        contained: true,
        scrolls: true,
        aligned: true,
        noteFits: true,
      });
      await $('.cm-markdown-table td[aria-label="Row 2, column 4"]').click();
      expect((await measure()).aligned).toBe(true);
      // Type over the cell as the user does: setValue's clear blurs the field, which closes
      // the cell editor (T-134).
      await expect($('textarea[aria-label="Row 2, column 4"]')).toBeFocused();
      await browser.keys([Key.Ctrl, "a"]);
      await browser.keys(Key.Ctrl);
      await browser.keys("$39/mo");
      await browser.waitUntil(() => fs.readFileSync(file("Plans.md"), "utf8").includes("$39/mo"));
      await browser.keys("Escape");
      const dir = path.resolve(".agents/qa/T-126");
      fs.mkdirSync(dir, { recursive: true });
      await browser.saveScreenshot(path.join(dir, "plans-narrow.png"));
    } finally {
      await browser.setWindowSize(originalSize.width, originalSize.height);
    }
    // Close the split: the other pane (focus is on Plans, after editing it) holds only Media.
    const media = $('.pane:not(.focused) [role="tab"]');
    await expect(media).toHaveText(expect.stringContaining("Media"));
    await media.click();
    await browser.keys([Key.Ctrl, "w"]);
    await browser.keys(Key.Ctrl);
    await browser.waitUntil(async () => (await $$(".pane").length) <= 1);
    await open("Costs");
    await open("Plans");
    await expect($(".cm-markdown-table table")).toHaveText(expect.stringContaining("$39/mo"));
    const dir = path.resolve(".agents/qa/T-126");
    fs.mkdirSync(dir, { recursive: true });
    await browser.saveScreenshot(path.join(dir, "plans-wide.png"));
  });
  it("styles cell text, opens Ctrl+/ and : in a cell, and shows images in list items (T-263)", async () => {
    const source = "| Item | Note |\n| --- | --- |\n| Tent | Pack |";
    fs.writeFileSync(file("CellTools.md"), `${source}\n\n- [ ] Pack ![[dot.png|40]] today\n`);
    await open("CellTools");
    const saved = () => fs.readFileSync(file("CellTools.md"), "utf8");
    await $('.cm-markdown-table td[aria-label="Row 1, column 2"]').click();
    await expect($('textarea[aria-label="Row 1, column 2"]')).toBeFocused();
    await browser.keys([Key.Ctrl, "a"]);
    await browser.keys(Key.Ctrl);
    await browser.keys([Key.Ctrl, "b"]);
    await browser.keys(Key.Ctrl);
    await browser.waitUntil(() => saved().includes("| Tent | **Pack** |"));
    // Ctrl+/ then a filter; Enter inserts in the cell, never in the note around it.
    await browser.keys(Key.End);
    await browser.keys([Key.Ctrl, "/"]);
    await browser.keys(Key.Ctrl);
    await $(".cm-table-cell-menu").waitForExist();
    await browser.keys("priority high");
    await browser.keys("Enter");
    await browser.waitUntil(() => saved().includes("| Tent | **Pack**⏫ |"));
    await browser.keys(" :rocket");
    await $(".cm-table-cell-menu li[role=option]").waitForExist();
    await browser.keys("Enter");
    await browser.waitUntil(() => saved().includes("🚀 |"));
    await browser.keys("Escape");
    await expect($(".cm-markdown-table td strong.cm-lp-strong")).toHaveText("Pack");
    // The task keeps its checkbox, with the image after it at its |width.
    await expect($(".cm-list-media img")).toHaveAttribute("width", "40");
    await expect($(".cm-line input[type=checkbox]")).toExist();
    expect(saved()).toContain("- [ ] Pack ![[dot.png|40]] today");
    const dir = path.resolve(".agents/qa/T-263");
    fs.mkdirSync(dir, { recursive: true });
    await browser.saveScreenshot(path.join(dir, "cell-tools-and-list-image.png"));
  });
  /** Since T-154 crop and exact size are in the image's right-click menu (no toolbar). */
  const openImageControls = async () => {
    await $(".cm-image-embed[data-kind=image] .cm-image-frame").click({ button: "right" });
    await $(".cm-image-menu").$("button*=Crop and exact size").click();
  };
  it("saves image size/crop, preserves original bytes and restores on reopen", async () => {
    const original = fs.readFileSync(file("dot.png"));
    await open("Media");
    const image = $(".cm-image-embed[data-kind=image]");
    await openImageControls();
    await image.$("input[type=checkbox]").click();
    await image.$('input[aria-label="Width (px)"]').setValue("120");
    await image.$('input[aria-label="Height (px)"]').setValue("60");
    await image.$('input[aria-label="Left crop (%)"]').setValue("10");
    await image.$('input[aria-label="Right crop (%)"]').setValue("10");
    await image.$("button=Apply image changes").click();
    await browser.waitUntil(() =>
      fs.readFileSync(file("Media.md"), "utf8").includes('axis-image {"crop":[10,0,10,0]}'),
    );
    expect(fs.readFileSync(file("Media.md"), "utf8")).toContain("![[dot.png|120x60]]");
    expect(fs.readFileSync(file("dot.png")).equals(original)).toBe(true);
    await open("Costs");
    await open("Media");
    await expect($(".cm-image-frame")).toHaveAttribute(
      "style",
      expect.stringContaining("width: 120px"),
    );
    await openImageControls();
    await expect($('input[aria-label="Left crop (%)"]')).toHaveValue("10");
    await snapshot("02-image-controls");
  });
});
