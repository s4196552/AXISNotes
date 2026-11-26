import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

// T-295: the sidebar AI chat draws on the open canvas. A local test provider streams a
// scripted answer (canvas operations as JSON) a piece at a time; the canvas shows each
// operation as it arrives, keeps the finished drawing as one undo step, and the chat
// refuses a canvas in an "AI: never" folder before anything is sent.

const vault = () => process.env.AXIS_E2E_VAULT!;
const read = (rel: string) => fs.readFileSync(path.join(vault(), ...rel.split("/")), "utf8");
type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  text?: string;
  containerId?: string | null;
  backgroundColor?: string;
};
const elements = (rel: string) => (JSON.parse(read(rel)) as { elements: El[] }).elements;
const qa = path.resolve(".agents/qa/T-295");

const FLOWCHART = {
  ops: [
    { op: "add", id: "pro", text: "Prophase", x: 0, y: 0, width: 170, height: 70 },
    { op: "add", id: "meta", text: "Metaphase", x: 260, y: 0, width: 170, height: 70 },
    { op: "add", id: "ana", text: "Anaphase", x: 520, y: 0, width: 170, height: 70 },
    { op: "add", id: "telo", text: "Telophase", x: 780, y: 0, width: 170, height: 70 },
    { op: "arrow", id: "p-m", from: "pro", to: "meta" },
    { op: "arrow", id: "m-a", from: "meta", to: "ana" },
    { op: "arrow", id: "a-t", from: "ana", to: "telo" },
  ],
  reply: "Drew the four phases of mitosis as a flowchart.",
};
const MOVE = {
  ops: [{ op: "change", id: "ana", x: 260, y: 160, backgroundColor: "#b2f2bb" }],
  reply: "Moved Anaphase under Metaphase and colored it green.",
};

let server: http.Server;
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

/** Stream `text` as server-sent events, a few characters every 60 ms. */
function stream(res: http.ServerResponse, text: string) {
  res.setHeader("content-type", "text/event-stream");
  const pieces = text.match(/[\s\S]{1,24}/g) ?? [];
  let i = 0;
  const next = () => {
    if (i >= pieces.length) {
      res.end("data: [DONE]\n\n");
      return;
    }
    const delta = { content: pieces[i++] };
    res.write(
      `data: ${JSON.stringify({ model: "fixture-model", choices: [{ index: 0, delta }] })}\n\n`,
    );
    setTimeout(next, 60);
  };
  next();
}

async function openFile(rel: string) {
  const row = $(`.filetree [data-path="${rel}"]`);
  // Files in a folder show once the folder is expanded.
  if (!(await row.isExisting())) await $(`.filetree [data-path="${rel.split("/")[0]}"]`).click();
  await row.waitForDisplayed();
  await row.click();
  await $("canvas.interactive").waitForDisplayed({ timeout: 20_000 });
}

/** Wait until the chat (its answers or its error line) shows `text`. */
async function chatSays(text: string, timeout: number) {
  await browser.waitUntil(async () => (await $(".sidebar-chat").getText()).includes(text), {
    timeout,
    timeoutMsg: `the chat never said "${text}"`,
  });
}

async function draw(prompt: string) {
  const box = $('.sidebar-chat textarea[aria-label="Chat message"]');
  await box.setValue(prompt);
  await $('.sidebar-chat button[aria-label="Draw"]').click();
}

describe("AI chat drawing on a canvas", () => {
  before(async () => {
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
        stream(res, JSON.stringify(raw.includes("Anaphase box") ? MOVE : FLOWCHART, null, 1));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    await $(".filetree").waitForDisplayed({ timeout: 30_000 });
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
    if (this.currentTest?.state === "failed")
      await browser.saveScreenshot(path.join(qa, "failed.png"));
  });

  it("draws a flowchart while the answer streams, then moves and recolors a box", async () => {
    await openFile("Boards/Mitosis.axcanvas");
    await $('button[aria-label="AI chat"]').click();
    await expect($('.sidebar-chat [aria-label="Chat action"]')).toHaveValue("draw");
    await expect($(".sidebar-chat-context")).toHaveText(expect.stringContaining("Mitosis"));

    await draw("Draw a flowchart of mitosis");
    // Part-way through the answer, some of it is already on the canvas.
    await browser.waitUntil(
      async () => /[1-6] changes? so far/.test(await $(".sidebar-chat-log").getText()),
      { timeout: 15_000, interval: 50, timeoutMsg: "no partial drawing shown" },
    );
    await browser.saveScreenshot(path.join(qa, "1-drawing-live.png"));
    await chatSays("Drew the four phases", 20_000);
    await expect($(".sidebar-chat-log")).toHaveText(expect.stringContaining("Canvas: added 7"));
    await browser.waitUntil(() => elements("Boards/Mitosis.axcanvas").length >= 11, {
      timeout: 10_000,
      timeoutMsg: "flowchart not saved",
    });
    const drawn = elements("Boards/Mitosis.axcanvas");
    expect(drawn.filter((e) => e.type === "arrow")).toHaveLength(3);
    expect(drawn.find((e) => e.containerId === "ana")?.text).toBe("Anaphase");
    await browser.saveScreenshot(path.join(qa, "2-flowchart.png"));

    // The model sees the canvas as a short summary, never the raw scene.
    const first = requests[0]!;
    expect(first).toContain("Canvas: Boards/Mitosis.axcanvas");
    expect(first).not.toContain("versionNonce");

    await draw("Move the Anaphase box under Metaphase and color it green");
    await chatSays("Moved Anaphase under Metaphase", 20_000);
    expect(requests[1]).toContain('\\"id\\":\\"ana\\"');
    expect(requests[1]).not.toContain("versionNonce");
    await browser.waitUntil(
      () => {
        const ana = elements("Boards/Mitosis.axcanvas").find((e) => e.id === "ana");
        return ana?.x === 260 && ana.y === 160 && ana.backgroundColor === "#b2f2bb";
      },
      { timeout: 10_000, timeoutMsg: "move not saved" },
    );
    await browser.saveScreenshot(path.join(qa, "3-moved-green.png"));

    // Ctrl+Z takes back the move in one step, then the whole flowchart in one more.
    await $(".excalidraw").click();
    await browser.keys([Key.Ctrl, "z"]);
    await browser.waitUntil(
      () => {
        const ana = elements("Boards/Mitosis.axcanvas").find((e) => e.id === "ana");
        return ana?.x === 520 && ana.y === 0 && ana.backgroundColor !== "#b2f2bb";
      },
      { timeout: 10_000, timeoutMsg: "first undo didn't take back the move" },
    );
    expect(elements("Boards/Mitosis.axcanvas").filter((e) => e.type === "arrow")).toHaveLength(3);
    await browser.keys([Key.Ctrl, "z"]);
    await browser.waitUntil(() => elements("Boards/Mitosis.axcanvas").length === 0, {
      timeout: 10_000,
      timeoutMsg: "second undo didn't take back the whole flowchart",
    });
    await browser.saveScreenshot(path.join(qa, "4-undone.png"));
  });

  it("refuses a canvas in an AI: never folder before anything is sent", async () => {
    const before = requests.length;
    await openFile("Private/Secret.axcanvas");
    await draw("Draw a flowchart of mitosis");
    await chatSays("marked AI: never", 10_000);
    await browser.pause(500);
    expect(requests.length).toBe(before);
    expect(elements("Private/Secret.axcanvas")).toHaveLength(0);
    await browser.saveScreenshot(path.join(qa, "5-never-refused.png"));
  });
});
