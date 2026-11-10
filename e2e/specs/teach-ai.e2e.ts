import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const source = "# Cells\n\nMitochondria make ATP.\n";
const vault = process.env.AXIS_E2E_VAULT!;
const qa = path.resolve(".agents/qa/T-216");
const requests: string[] = [];
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

async function chooseSkill() {
  await $(".cm-content").click();
  await browser.keys([Key.Ctrl, "/"]);
  await browser.keys(Key.Ctrl);
  await $(".cm-tooltip-autocomplete").waitForDisplayed();
  await browser.keys("Teach the AI");
  await browser.waitUntil(async () => (await $$(".cm-completionLabel").length) === 1);
  const option = $('.cm-tooltip-autocomplete [role="option"]');
  await expect(option.$(".cm-completionLabel")).toHaveText("Teach the AI");
  await expect(option.$(".cm-commandIcon svg")).toExist();
  await browser.saveScreenshot(path.join(qa, "teach-the-ai-menu.png"));
  await browser.pause(150); // CodeMirror's completion interaction delay.
  await browser.keys(Key.Enter);
}

describe("Teach the AI student skill (T-216)", () => {
  before(async () => {
    fs.writeFileSync(path.join(vault, "Welcome.md"), source);
    fs.mkdirSync(qa, { recursive: true });
    server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += chunk.toString()));
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
    await $(".shell").waitForDisplayed({ timeout: 15000 });
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
    await $('.filetree [data-path="Welcome.md"]').click();
    await $(".cm-content").waitForDisplayed();
  });

  after(() => server?.close());

  for (const format of ["Markdown", "HTML"]) {
    it(`lets the user teach, reply and wrap up with a saved ${format} transcript`, async () => {
      const count = requests.length;
      await chooseSkill();
      const block = $('[role="group"][aria-label="AI block"]');
      await expect(block.$(".ai-skill")).toHaveText(expect.stringContaining("Skill: Teach the AI"));
      await expect(block.$("button=Markdown")).toHaveAttribute("aria-pressed", "true");
      expect(requests.length).toBe(count);
      await block.$(`button=${format}`).click();

      answer = "Could you teach me how mitochondria help a cell?";
      await block.$("button=Run").click();
      await block.$("button=Wrap up").waitForDisplayed();
      await expect(block.$('[aria-label="Conversation"]')).toHaveText(
        expect.stringContaining(answer),
      );
      expect(requests.at(-1)).toContain("# Skill: Teach the AI");
      expect(requests.at(-1)).toContain("The user is your teacher.");
      expect(requests.at(-1)).toContain("Mitochondria make ATP.");
      expect(requests.at(-1)).toContain("Start the conversation.");
      expect(requests.at(-1)).not.toContain("Start the interview.");

      const explanation = "Mitochondria make ATP, which carries usable energy for the cell.";
      answer = "So ATP carries energy the cell can use. How is that energy released?";
      await block.$('[aria-label="AI prompt"]').setValue(explanation);
      await block.$("button=Reply").click();
      await block.$("button=Wrap up").waitForDisplayed();
      await expect(block.$('[aria-label="Conversation"]')).toHaveText(
        expect.stringContaining(answer),
      );
      expect(requests.at(-1)).toContain(explanation);
      expect(requests.at(-1)).toContain("Could you teach me how mitochondria help a cell?");
      await expect(block.$(".ai-scope")).toBeDisabled();

      answer = "You explained ATP clearly. Practise explaining how its energy is released next.";
      await block.$("button=Wrap up").click();
      await block.$("button=Open the saved conversation").waitForDisplayed();
      await expect(block.$('[aria-label="Conversation"]')).toHaveText(
        expect.stringContaining(answer),
      );
      expect(requests.length).toBe(count + 3);
      expect(requests.at(-1)).toContain("wrap up");
      expect(requests.at(-1)).toContain(explanation);
      const file = path.join(vault, `Teach the AI - Welcome.${format === "HTML" ? "html" : "md"}`);
      await browser.waitUntil(
        () => fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(answer),
      );
      const saved = fs.readFileSync(file, "utf8");
      expect(saved).toContain(explanation);
      expect(saved).toContain("Start the conversation.");
      if (format === "HTML") expect(saved).toContain("<!doctype html>");
      expect(fs.readFileSync(path.join(vault, "Welcome.md"), "utf8")).toBe(source);
      await browser.saveScreenshot(path.join(qa, `teach-the-ai-${format.toLowerCase()}.png`));
      await block.$('[aria-label="Close AI block"]').click();
    });
  }
});
