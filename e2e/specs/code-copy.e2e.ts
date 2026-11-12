import fs from "node:fs";
import path from "node:path";
import { $, $$, browser, expect } from "@wdio/globals";

describe("Code block copy", () => {
  it("copies just the code from the top-right button in preview and while editing", async function () {
    this.timeout(120_000);
    const note = path.join(process.env.AXIS_E2E_VAULT!, "Copy code.md");
    const code = '  print("hello")  \n\n  ```';
    const source =
      "Intro\n\n````python\n" +
      code +
      "\n````\n\n```green\nsecond block\n```\n\n> ~~~\n>   quoted\n> ~~~\n";
    await $(".filetree").waitForDisplayed();
    fs.writeFileSync(note, source);
    const row = $('[data-path="Copy code.md"]');
    await row.waitForDisplayed();
    await row.click();

    await browser.execute(() => {
      const copies: string[] = [];
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: { writeText: (text: string) => Promise.resolve(void copies.push(text)) },
      });
      Object.assign(window, { codeCopies: copies });
    });
    const copies = () =>
      browser.execute(() => (window as unknown as { codeCopies: string[] }).codeCopies);
    const buttons = () => $$('button[aria-label="Copy code"]');
    await browser.waitUntil(() =>
      browser.execute(() => document.querySelectorAll(".cm-lp-code-copy").length === 3),
    );

    const aligned = await browser.execute(() => {
      const button = document.querySelector(".cm-lp-code-copy")!;
      const block = button.closest(".cm-lp-code-first")!.getBoundingClientRect();
      const rect = button.getBoundingClientRect();
      return (
        rect.top >= block.top &&
        rect.top - block.top < 8 &&
        rect.right <= block.right &&
        block.right - rect.right < 12
      );
    });
    expect(aligned).toBe(true);
    await (await buttons())[0]!.click();
    await (await buttons())[1]!.click();
    await (await buttons())[2]!.click();
    expect(await copies()).toEqual([code, "second block", "  quoted"]);

    await $(".cm-lp-code-first + .cm-lp-codeblock").click();
    await expect($(".cm-lp-code-first")).toHaveText("````python");
    await (await buttons())[0]!.click();
    expect(await copies()).toEqual([code, "second block", "  quoted", code]);
    await expect($(".cm-lp-code-first")).toHaveText("````python");
    expect(fs.readFileSync(note, "utf8")).toBe(source);
  });
});
