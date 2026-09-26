import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// Phase 4 acceptance on the real app: a provider is configured through Settings → AI
// against a mock OpenAI-compatible server on this machine; a question about a note streams
// back; a folder marked "AI: never" is refused before any request leaves the app; the API
// key is never readable from the webview and never written to disk.

const vault = process.env.AXIS_E2E_VAULT!;
const configDir = process.env.AXIS_CONFIG_DIR!;
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "phase-4");
const KEY = "sk-e2e-secret-4242";
const ANSWER = ["Hello ", "from ", "the ", "mock ", "provider."];

interface Seen {
  path: string;
  auth: string | undefined;
  body: { messages?: { role: string; content: unknown }[]; stream?: boolean; model?: string };
}
const seen: Seen[] = [];
let server: http.Server;
let baseUrl = "";

function startMock(): Promise<void> {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Seen["body"]) : {};
      seen.push({ path: req.url ?? "", auth: req.headers.authorization, body });
      if (req.url?.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-model", object: "model" }] }));
        return;
      }
      if (!req.url?.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      let i = 0;
      const tick = () => {
        if (i < ANSWER.length) {
          const chunk = {
            model: "mock-model",
            choices: [{ index: 0, delta: { content: ANSWER[i++] } }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          setTimeout(tick, 60);
        } else {
          res.write(
            `data: ${JSON.stringify({ model: "mock-model", choices: [], usage: { prompt_tokens: 42, completion_tokens: 5 } })}\n\n`,
          );
          res.end("data: [DONE]\n\n");
        }
      };
      tick();
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      resolve();
    }),
  );
}

async function snapshot(name: string) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await browser.saveScreenshot(path.join(QA_DIR, `${name}.png`));
}

async function fill(selector: string, value: string) {
  const el = $(selector);
  await el.click();
  await browser.keys([Key.Ctrl, "a"]);
  await browser.keys(value);
  await browser.keys(Key.Tab); // blur commits
}

/** Call a Tauri command the way any webview code could. */
function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  return browser.executeAsync(
    (c: string, a: Record<string, unknown>, done: (v: unknown) => void) => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke(c: string, a: unknown): Promise<unknown> };
      };
      w.__TAURI_INTERNALS__.invoke(c, a).then(done, (e: unknown) => done({ rejected: e }));
    },
    cmd,
    args,
  ) as Promise<T>;
}

describe("Phase 4: AI providers, privacy and keys on the real app", () => {
  before(startMock);
  after(() => server?.close());

  it("sets up a provider in Settings → AI and tests the connection", async () => {
    await $('[aria-label="Settings"]').click();
    await $("button=AI").click();
    await $('select[aria-label="Provider type"]').selectByAttribute("value", "custom");
    await $("button*=Add provider").click();
    const card = $('[aria-label="Provider OpenAI-compatible endpoint"]');
    await card.waitForDisplayed();
    await fill('[aria-label="Endpoint of OpenAI-compatible endpoint"]', baseUrl);
    // The endpoint is saved on blur; wait for it before checking the "local" badge.
    await browser.waitUntil(() => {
      const file = path.join(configDir, "ai-settings.json");
      return fs.existsSync(file) && fs.readFileSync(file, "utf8").includes(baseUrl);
    });
    await expect(card).toHaveText(expect.stringContaining("On this device"));

    await $('[aria-label="API key for OpenAI-compatible endpoint"]').setValue(KEY);
    await card.$("button=Save key").click();
    await expect(card).toHaveText(expect.stringContaining("Key saved in keychain"));
    await card.$("button*=Test connection").click();
    await expect(card.$('[role="status"]')).toHaveText(
      expect.stringContaining("Connected · 1 model"),
    );

    await $('select[aria-label="Provider for Chat and other"]').selectByAttribute(
      "value",
      "custom",
    );
    await fill('[aria-label="Model for Chat and other"]', "mock-model");
    await snapshot("01-settings");
    await $('[aria-label="Close settings"]').click();
  });

  it("never exposes the key to the webview or writes it to disk", async () => {
    const view = await invoke<{ providers: { id: string; hasKey: boolean }[] }>("ai_settings");
    expect(JSON.stringify(view)).not.toContain(KEY);
    expect(view.providers[0]).toMatchObject({ id: "custom", hasKey: true });
    const settingsFile = fs.readFileSync(path.join(configDir, "ai-settings.json"), "utf8");
    expect(settingsFile).toContain(baseUrl);
    expect(settingsFile).not.toContain(KEY);
    // The key did reach the provider (as an Authorization header), and only there.
    expect(seen.find((s) => s.path.endsWith("/models"))?.auth).toBe(`Bearer ${KEY}`);
  });

  it("streams an answer about the open note", async () => {
    seen.length = 0;
    await $('[data-path="School"]').click();
    await $('[data-path="School/Bio.md"]').click();
    await expect($(".editor-title")).toHaveText("Bio");
    await $('[aria-label="Ask AI"]').click();
    await expect($('[aria-label="Destination"]')).toHaveText(
      expect.stringContaining("OpenAI-compatible endpoint · mock-model"),
    );
    await $('[aria-label="Question"]').setValue("What do mitochondria make?");
    await browser.keys([Key.Ctrl, Key.Enter]);
    await expect($('[aria-label="Answer"]')).toHaveText("Hello from the mock provider.");
    await expect($(".ask-ai-meta")).toHaveText(
      expect.stringContaining("mock-model (on this device) · 42 in / 5 out tokens"),
    );
    const chat = seen.find((s) => s.path.endsWith("/chat/completions"))!;
    expect(chat.body.stream).toBe(true);
    expect(JSON.stringify(chat.body.messages)).toContain("Mitochondria make ATP.");
    await snapshot("02-answer");
    await $('[aria-label="Close"]').click();
  });

  it("blocks a note from an 'AI: never' folder before anything is sent", async () => {
    seen.length = 0;
    await $('[data-path="Medical"]').click();
    await $('[data-path="Medical/scan.md"]').click();
    await expect($(".editor-title")).toHaveText("scan");
    await browser.keys([Key.Ctrl, "j"]);
    await $('[aria-label="Question"]').setValue("Summarize this");
    await $("button*=Ask").click();
    await expect($('.ask-ai [role="alert"]')).toHaveText(
      expect.stringMatching(/^Not sent: .*AI: never/),
    );
    expect(seen).toHaveLength(0);
    await snapshot("03-blocked");

    // Even a direct command from the webview is refused by the Rust layer.
    const direct = await invoke<{ rejected?: { code: string } }>("ai_run", {
      runId: "direct",
      request: {
        messages: [{ role: "user", content: [{ type: "text", text: "leak" }] }],
        attach: ["Medical/scan.md"],
      },
    });
    expect(direct.rejected?.code).toBe("Blocked");
    expect(seen).toHaveLength(0);
    await $('[aria-label="Close"]').click();
  });

  it("keeps a metadata-only request log", async () => {
    const log = fs.readFileSync(path.join(configDir, "ai-requests.jsonl"), "utf8");
    const entries = log
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { status: string });
    expect(entries.map((e) => e.status)).toEqual(expect.arrayContaining(["ok", "blocked"]));
    for (const secret of [
      "What do mitochondria",
      "Mitochondria make ATP",
      "Private results",
      KEY,
      "leak",
    ])
      expect(log).not.toContain(secret);
    expect(fs.existsSync(path.join(vault, ".axis", "ai-requests.jsonl"))).toBe(false);
  });
});
