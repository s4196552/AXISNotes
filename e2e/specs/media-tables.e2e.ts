import fs from "node:fs";
import path from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";

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
    await $(".cm-markdown-table").$("button=Edit cells").click();
    await $('textarea[aria-label="Row 1, column 3"]').setValue("Reviewed administration");
    await browser.waitUntil(() =>
      fs.readFileSync(file("Costs.md"), "utf8").includes("Reviewed administration"),
    );
    await $(".cm-markdown-table").$("button=Done editing").click();
    await expect($(".cm-markdown-table table")).toHaveText(
      expect.stringContaining("Reviewed administration"),
    );
    await $(".cm-markdown-table").$("button=Edit Markdown").click();
    await expect($(".cm-markdown-table table")).not.toExist();
    await $(".cm-table-tools").$("button=Show table").click();
    await expect($(".cm-markdown-table table")).toExist();
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
    const originalSize = await browser.getWindowSize();
    try {
      await browser.setWindowSize(720, 820);
      const measure = () =>
        browser.execute(() => {
          const scroll = document.querySelector<HTMLElement>(".cm-table-scroll")!;
          const editor = document.querySelector<HTMLElement>(".cm-scroller")!;
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
      await $(".cm-markdown-table").$("button=Edit cells").click();
      await expect($$(".cm-markdown-table th")).toBeElementsArrayOfSize(6);
      expect((await measure()).aligned).toBe(true);
      await $('textarea[aria-label="Row 2, column 4"]').setValue("$39/mo");
      await browser.waitUntil(() => fs.readFileSync(file("Plans.md"), "utf8").includes("$39/mo"));
      await $(".cm-markdown-table").$("button=Done editing").click();
      const dir = path.resolve(".agents/qa/T-126");
      fs.mkdirSync(dir, { recursive: true });
      await browser.saveScreenshot(path.join(dir, "plans-narrow.png"));
    } finally {
      await browser.setWindowSize(originalSize.width, originalSize.height);
    }
    await open("Costs");
    await open("Plans");
    await expect($(".cm-markdown-table table")).toHaveText(expect.stringContaining("$39/mo"));
    const dir = path.resolve(".agents/qa/T-126");
    fs.mkdirSync(dir, { recursive: true });
    await browser.saveScreenshot(path.join(dir, "plans-wide.png"));
  });
  it("saves image size/crop, preserves original bytes and restores on reopen", async () => {
    const original = fs.readFileSync(file("dot.png"));
    await open("Media");
    const image = $(".cm-image-embed[data-kind=image]");
    await image.$("button=Edit image").click();
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
    await $(".cm-image-embed[data-kind=image]").$("button=Edit image").click();
    await expect($('input[aria-label="Left crop (%)"]')).toHaveValue("10");
    await snapshot("02-image-controls");
  });
});
