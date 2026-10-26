import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";

const vault = process.env.AXIS_E2E_VAULT!;

describe("Code syntax and commands (T-135)", () => {
  it("highlights Python and Java and inserts language blocks through Ctrl+/", async () => {
    await $(".filetree").waitForExist({ timeout: 15000 });
    const text =
      'Intro `code`\n\n```PYTHON\ndef hello():\n    return "world" # comment\n```\n\n```java\npublic class Hello { String x = "world"; }\n```\n\nEnd\n';
    const file = path.join(vault, "Code.md");
    fs.writeFileSync(file, text);
    const row = $('[data-path="Code.md"]');
    await row.waitForExist({ timeout: 15000 });
    await row.click();
    await $(".cm-code-keyword").waitForExist();
    await expect($(".cm-code-string")).toBeExisting();
    await expect($(".cm-lp-code")).toHaveText("code");
    expect(fs.readFileSync(file, "utf8")).toBe(text);
    await $(".cm-content").click();
    await browser.keys(["Control", "End", "NULL"]);
    await browser.keys(["Control", "/", "NULL"]);
    await browser.keys("Python");
    const option = $(".cm-tooltip-autocomplete").$("li*=Python code block");
    await option.waitForExist();
    await option.click();
    await browser.keys('print("hello")');
    await browser.waitUntil(() =>
      fs.readFileSync(file, "utf8").includes('```python\nprint("hello")\n```'),
    );
  });
});
