import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const vault = process.env.AXIS_E2E_VAULT!;
const qa = path.resolve(".agents/qa/T-223");
const source = "# Cells\n\nMitochondria make ATP.\n";
let answer = "";
let server: http.Server;

function invoke<T>(command: string, args: object): Promise<T> {
  return browser.executeAsync(
    (cmd: string, a: object, done: (r: unknown) => void) => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: { invoke(c: string, a: object): Promise<unknown> };
      };
      host.__TAURI_INTERNALS__.invoke(cmd, a).then(done, (error: unknown) => done({ error }));
    },
    command,
    args,
  ) as Promise<T>;
}
async function chooseSkill(name: string) {
  await $(".pane.focused .cm-content, .workspace.single .cm-content").click();
  await browser.keys([Key.Ctrl, "/"]);
  await browser.keys(Key.Ctrl);
  await $(".cm-tooltip-autocomplete").waitForDisplayed();
  await browser.keys(name);
  await browser.waitUntil(async () => (await $$(".cm-completionLabel").length) === 1);
  await browser.pause(150);
  await browser.keys(Key.Enter);
  await $('[aria-label="Results in"]').waitForDisplayed();
}
const block = () => $('[role="group"][aria-label="AI block"]');
const read = (name: string) => fs.readFileSync(path.join(vault, name), "utf8");

describe("AI skill result destinations (T-223)", () => {
  before(async () => {
    fs.mkdirSync(qa, { recursive: true });
    fs.writeFileSync(path.join(vault, "Welcome.md"), source);
    server = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => {
        if (req.url?.endsWith("/models")) {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
          return;
        }
        res.setHeader("content-type", "text/event-stream");
        res.end(
          `data: ${JSON.stringify({ model: "fixture-model", choices: [{ index: 0, delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`,
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await $(".shell").waitForDisplayed({ timeout: 15000 });
    const { settings } = await invoke<{ settings: Record<string, unknown> }>("ai_settings", {});
    await invoke("ai_save_settings", {
      settings: {
        ...settings,
        providers: [
          {
            id: "fixture",
            kind: "custom",
            name: "Local test provider",
            baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
            enabled: true,
          },
        ],
        tasks: { chat: { provider: "fixture", model: "fixture-model" } },
      },
    });
    await $('.filetree [data-path="School"]').click();
    await $('.filetree [data-path="School/Biology.md"]').waitForDisplayed();
    await $('.filetree [data-path="Welcome.md"]').click();
    await $(".cm-content").waitForDisplayed();
  });
  after(() => server?.close());
  afterEach(async () => {
    await browser.switchFrame(null);
  });

  it("renders Markdown in the note until the user chooses Insert", async () => {
    await chooseSkill("Mnemonic");
    await block().$('[aria-label="Results in"]').selectByAttribute("value", "note");
    answer = "## ATP memory aid\n\nATP carries energy.";
    await block().$("button=Run").click();
    await block().$(".ai-block-answer h2").waitForDisplayed();
    await expect(block().$(".ai-block-answer")).toHaveText(
      expect.stringContaining("ATP memory aid"),
    );
    expect(read("Welcome.md")).toBe(source);
    await browser.saveScreenshot(path.join(qa, "note-result.png"));
    await block().$("button=Insert").click();
    await browser.waitUntil(() => read("Welcome.md").includes("ATP memory aid"));
    // Restore this disposable fixture for the independent placement scenarios.
    await $('.filetree [data-path="School/Biology.md"]').click();
    fs.writeFileSync(path.join(vault, "Welcome.md"), source);
    await $('.filetree [data-path="Welcome.md"]').click();
    await browser.waitUntil(
      async () => !(await $(".cm-content").getText()).includes("ATP memory aid"),
    );
  });

  it("shows interactive HTML in the sidebar while browsing other notes", async () => {
    await chooseSkill("Practice test");
    await block().$('[aria-label="Results in"]').selectByAttribute("value", "sidebar");
    answer =
      "<!doctype html><html><body><h1>ATP quiz</h1><button onclick=\"this.textContent='Correct!'\">Check answer</button></body></html>";
    await block().$("button=Run").click();
    const sidebar = $('[aria-label="AI skill results"]');
    const frame = sidebar.$("iframe");
    await frame.waitForDisplayed();
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-modals");
    await browser.switchFrame(frame);
    await expect($("h1")).toHaveText("ATP quiz");
    await $("button").click();
    await expect($("button")).toHaveText("Correct!");
    expect(
      await browser.execute(() => {
        try {
          void window.parent.document.body;
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    const ipc = await browser.executeAsync((done: (result: string) => void) => {
      const host = window as unknown as {
        __TAURI_INTERNALS__: { invoke(c: string): Promise<unknown> };
      };
      Promise.race([
        host.__TAURI_INTERNALS__.invoke("list_notes").then(
          () => "allowed",
          () => "denied",
        ),
        new Promise<string>((resolve) => setTimeout(() => resolve("no response"), 1000)),
      ]).then(done);
    });
    expect(ipc).not.toBe("allowed");
    await browser.switchFrame(null);
    await $('.filetree [data-path="School/Biology.md"]').click();
    await expect(frame).toBeDisplayed();
    await sidebar.$("button*=Open source to continue").click();
    await block().waitForDisplayed();
    await expect(block().$('[aria-label="Results in"]')).toHaveValue("sidebar");
    expect(read("Welcome.md")).toBe(source);
    await browser.saveScreenshot(path.join(qa, "sidebar-html-result.png"));
    await block().$('[aria-label="Close AI block"]').click();
    await $('[aria-label="Close skill results"]').click();
  });

  for (const [format, skill] of [
    ["Markdown", "Mind map"],
    ["HTML", "Flash cards"],
  ]) {
    it(`opens a separate ${format} result beside the source and reuses its pane`, async () => {
      await chooseSkill(skill!);
      await block().$('[aria-label="Results in"]').selectByAttribute("value", "sideview");
      await block().$(`button=${format}`).click();
      answer =
        format === "HTML"
          ? "<!doctype html><html><body><h1>Energy cards</h1></body></html>"
          : "# Energy map\n\n- ATP\n  - Usable energy";
      await block().$("button=Run").click();
      await browser.waitUntil(async () => (await $$(".pane").length) === 2);
      const result = $(".pane:not(.focused)");
      if (format === "HTML") {
        await result.$(".web-view iframe").waitForDisplayed();
        await browser.switchFrame(result.$(".web-view iframe"));
        await expect($("h1")).toHaveText("Energy cards");
        await browser.switchFrame(null);
      } else
        await expect(result.$(".cm-content")).toHaveText(expect.stringContaining("Energy map"));
      await block().$("button=Open result beside note").click();
      await expect($$(".pane")).toBeElementsArrayOfSize(2);
      expect(read("Welcome.md")).toBe(source);
      await browser.saveScreenshot(path.join(qa, `sideview-${format!.toLowerCase()}.png`));
      await block().$('[aria-label="Close AI block"]').click();
      // Close only the result pane's single tab. The source stays open.
      await result.$('[role="tab"]').click();
      await browser.keys([Key.Ctrl, "w"]);
      await browser.keys(Key.Ctrl);
      await browser.waitUntil(async () => (await $$(".pane").length) === 1);
    });
  }
});
