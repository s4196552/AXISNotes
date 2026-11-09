import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const note = "# Welcome\n\n==Cells make ATP.==\n\nOther material.\n";
const file = () => path.join(process.env.AXIS_E2E_VAULT!, "Welcome.md");
let server: http.Server;
let answer = "Cells use ATP as an energy source.";
const requests: string[] = [];

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

describe("Sidebar AI chat", () => {
  before(async () => {
    fs.writeFileSync(file(), note);
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => {
        raw += chunk.toString();
      });
      req.on("end", () => {
        if (req.url?.endsWith("/models")) {
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
          return;
        }
        requests.push(raw);
        res.setHeader("content-type", "text/event-stream");
        res.end(
          `data: ${JSON.stringify({ model: "fixture-model", choices: [{ index: 0, delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`,
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { settings } = await invoke<{ settings: Record<string, unknown> }>("ai_settings", {});
    const result = await invoke<{ error?: unknown }>("ai_save_settings", {
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
    expect(result?.error).toBeUndefined();
  });
  after(() => server?.close());
  afterEach(async function () {
    if (this.currentTest?.state === "failed") {
      const dir = path.resolve(".agents/qa/T-206");
      fs.mkdirSync(dir, { recursive: true });
      await browser.saveScreenshot(path.join(dir, "failed.png"));
    }
  });

  it("asks about a right-clicked selection without sending the rest of the note", async () => {
    await $('.filetree [data-path="Welcome.md"]').click();
    await $(".cm-content").click();
    await browser.keys([Key.Ctrl, Key.End]);
    await browser.keys([Key.ArrowUp, Key.ArrowUp, Key.ArrowUp, Key.Home]);
    await browser.keys([Key.Shift, Key.End]);
    await $(".cm-line*=Cells").click({ button: "right" });
    await $('[role="menuitem"]=Ask AI about this selection').click();
    const summary = $(".sidebar-chat-context summary");
    const passage = $(".sidebar-chat-context blockquote");
    await expect(summary).toHaveText(expect.stringContaining("Selected text"));
    await expect(passage).not.toBeDisplayed();
    await summary.click();
    await expect(passage).toHaveText(expect.stringContaining("Cells make ATP."));
    await summary.click();
    await expect(passage).not.toBeDisplayed();
    await expect($('[aria-label="Chat message"]')).toHaveValue("Explain this selection.");
    await $(".sidebar-chat").$("button=Send").click();
    await expect($(".sidebar-chat-log")).toHaveText(expect.stringContaining(answer));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toContain("Cells make ATP.");
    expect(requests[0]).not.toContain("Other material.");
    expect(fs.readFileSync(file(), "utf8")).toBe(note);
  });

  it("shows proposed changes and applies them only after approval", async () => {
    answer = "==Mitochondria supply ATP.==";
    await $('[aria-label="Chat action"]').selectByAttribute("value", "edit");
    await $('[aria-label="Chat message"]').setValue("Improve the selected sentence");
    await $(".sidebar-chat").$("button=Suggest changes").click();
    const apply = $(".sidebar-chat").$("button=Apply approved changes");
    await apply.waitForDisplayed();
    expect(fs.readFileSync(file(), "utf8")).toBe(note);
    await apply.click();
    await browser.waitUntil(() => fs.readFileSync(file(), "utf8").includes(answer));
    expect(fs.readFileSync(file(), "utf8")).toContain("Other material.");
    const dir = path.resolve(".agents/qa/T-206");
    fs.mkdirSync(dir, { recursive: true });
    await browser.saveScreenshot(path.join(dir, "sidebar-chat.png"));
  });
});
