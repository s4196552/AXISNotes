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

async function ctrlWheel(selector: string) {
  const at = await browser.execute((s: string) => {
    const box = document.querySelector(s)!.getBoundingClientRect();
    const clip = document.querySelector(".sidebar-chat-log")!.getBoundingClientRect();
    return {
      x: Math.round((Math.max(box.left, clip.left) + Math.min(box.right, clip.right)) / 2),
      y: Math.round((Math.max(box.top, clip.top) + Math.min(box.bottom, clip.bottom)) / 2),
    };
  }, selector);
  await browser.performActions([
    { type: "key", id: "zoom-key", actions: [{ type: "keyDown", value: "\uE009" }] },
  ]);
  try {
    await browser.performActions([
      {
        type: "wheel",
        id: "zoom-wheel",
        actions: [{ type: "scroll", x: at.x, y: at.y, deltaX: 0, deltaY: -120, duration: 100 }],
      },
    ]);
  } finally {
    await browser.releaseActions();
  }
}

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
    await browser.execute(() => localStorage.removeItem("axisnotes.areaZoom"));
    await browser.refresh();
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

  it("renders AXISNotes Markdown blocks and offers the unchanged source", async () => {
    const before = fs.readFileSync(file(), "utf8");
    answer =
      "## Energy\n\n> [!tip] Remember\n> ==ATP== powers cells.\n\n> [!note]- Test yourself\n> Explain energy transfer.\n\n| Topic | Detail |\n| --- | --- |\n| Cells | **ATP** |\n\n- [x] Read\n- [ ] Recall\n\n```green\nconst energy = 'ATP';\n```";
    await $(".sidebar-chat").$("button=New chat").click();
    await $('[aria-label="Chat action"]').selectByAttribute("value", "ask");
    await $('[aria-label="Chat message"]').setValue("Explain with Markdown blocks");
    await $(".sidebar-chat").$("button=Send").click();
    const turn = $(".sidebar-chat-turn.assistant");
    await expect(turn.$("h2")).toHaveText("Energy");
    await expect(turn.$(".answer-callout-tip mark")).toHaveText("ATP");
    await expect(turn.$("table td strong")).toHaveText("ATP");
    await expect(turn.$("details p")).not.toBeDisplayed();
    await turn.$("details summary").click();
    await expect(turn.$("details p")).toBeDisplayed();
    await expect(turn.$('pre[data-code-color="green"] code')).toHaveText("const energy = 'ATP';");
    const dir = path.resolve(".agents/qa/T-213");
    fs.mkdirSync(dir, { recursive: true });
    await browser.execute(() => {
      const log = document.querySelector(".sidebar-chat-log");
      if (log) log.scrollTop = 0;
    });
    await browser.saveScreenshot(path.join(dir, "markdown-blocks.png"));
    const count = requests.length;
    await $('[aria-label="Answer display"]').selectByAttribute("value", "source");
    await expect(turn.$(".sidebar-chat-source")).toHaveText(answer);
    await expect(turn.$("table")).not.toExist();
    await browser.saveScreenshot(path.join(dir, "markdown-source.png"));
    await $('[aria-label="Answer display"]').selectByAttribute("value", "markdown");
    await expect(turn.$("table")).toBeDisplayed();
    expect(requests).toHaveLength(count);
    expect(fs.readFileSync(file(), "utf8")).toBe(before);
  });

  it("sends a right-clicked file to the right chat without sending automatically", async () => {
    const count = requests.length;
    await $('.filetree [data-path="School"]').click();
    await $('.filetree [data-path="School/Biology.md"]').click({ button: "right" });
    await $('[role="menuitem"]=AI').click();
    await $('[role="menuitem"]=Send to AI Chat').click();
    await expect($(".sidebar-chat-context")).toHaveText(
      expect.stringContaining("Attached notes · 1"),
    );
    expect(requests).toHaveLength(count);
    await $('[aria-label="Chat message"]').setValue("Explain this attached note");
    answer = "Attached biology note reviewed.";
    await $(".sidebar-chat").$("button=Send").click();
    await expect($(".sidebar-chat-log")).toHaveText(expect.stringContaining(answer));
    expect(requests.at(-1)).toContain("School/Biology.md");
    expect(requests.at(-1)).toContain("read ch. 1");
    await expect($(".cm-content")).toHaveText(expect.stringContaining("Other material."));
  });

  it("zooms the AI content with a real Ctrl+wheel gesture and copies the exact answer", async () => {
    const zoom = () =>
      browser.execute(() => getComputedStyle(document.querySelector(".sidebar-chat-log")!).zoom);
    const before = await zoom();
    await ctrlWheel(".sidebar-chat-log");
    await browser.waitUntil(async () => (await zoom()) !== before);
    expect(await zoom()).toBe("1.1");
    await browser.execute(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (window as unknown as { copiedAnswer: string }).copiedAnswer = value;
          },
        },
      });
    });
    await $(".sidebar-chat-turn.assistant:last-of-type").$("button=Copy answer").click();
    expect(
      await browser.execute(() => (window as unknown as { copiedAnswer: string }).copiedAnswer),
    ).toBe(answer);
  });

  it("renders interactive HTML safely, retains copy/source controls and zooms inside its frame", async () => {
    const before = fs.readFileSync(file(), "utf8");
    await $(".sidebar-chat").$("button=New chat").click();
    await $('[aria-label="Answer format"]').selectByAttribute("value", "html");
    answer =
      "<!doctype html><html><head><style>body{font:16px sans-serif}button{padding:12px}</style></head><body><h1>Energy page</h1><button onclick=\"this.textContent='Correct!'\">Check</button></body></html>";
    await $('[aria-label="Chat message"]').setValue("Give an interactive HTML answer");
    await $(".sidebar-chat").$("button=Send").click();
    const frame = $('.sidebar-chat iframe[title="AI HTML answer"]');
    await frame.waitForDisplayed();
    await expect(frame).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-modals");
    expect(requests.at(-1)).toContain("HTML document");
    const dpr = await browser.execute(() => window.devicePixelRatio);
    await browser.switchFrame(frame);
    await expect($("h1")).toHaveText("Energy page");
    await $("button").click();
    await expect($("button")).toHaveText("Correct!");
    expect(
      await browser.execute(() => {
        try {
          void parent.document.body;
          return false;
        } catch {
          return true;
        }
      }),
    ).toBe(true);
    const ipc = await browser.executeAsync((done: (result: string) => void) => {
      const host = window as unknown as {
        __TAURI_INTERNALS__?: { invoke(c: string): Promise<unknown> };
      };
      if (!host.__TAURI_INTERNALS__) return done("unavailable");
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
    await $('[aria-label="Chat message"]').click();
    await ctrlWheel(".sidebar-chat iframe");
    await browser.waitUntil(() =>
      browser.execute(
        () => getComputedStyle(document.querySelector(".sidebar-chat-log")!).zoom === "1.25",
      ),
    );
    expect(await browser.execute(() => window.devicePixelRatio)).toBe(dpr);
    await $(".sidebar-chat").$("button=Copy answer").click();
    expect(
      await browser.execute(() => (window as unknown as { copiedAnswer: string }).copiedAnswer),
    ).toBe(answer);
    await $(".sidebar-chat").$("button=Copy text").click();
    await browser.waitUntil(() =>
      browser.execute(() =>
        (window as unknown as { copiedAnswer: string }).copiedAnswer.includes("Energy page"),
      ),
    );
    expect(
      await browser.execute(() => (window as unknown as { copiedAnswer: string }).copiedAnswer),
    ).not.toContain("<html>");
    const count = requests.length;
    await $('[aria-label="Answer display"]').selectByAttribute("value", "source");
    await expect($(".assistant .sidebar-chat-source")).toHaveText(answer);
    await $('[aria-label="Answer display"]').selectByAttribute("value", "markdown");
    await frame.waitForDisplayed();
    expect(requests).toHaveLength(count);
    expect(fs.readFileSync(file(), "utf8")).toBe(before);
    const qa = path.resolve(".agents/qa/T-227");
    fs.mkdirSync(qa, { recursive: true });
    await browser.saveScreenshot(path.join(qa, "sidebar-html-copy-zoom.png"));
    await $(".sidebar-right").$("button=Note details").click();
    await $(".sidebar-right").$("button=AI chat").click();
    await expect($('[aria-label="Answer format"]')).toHaveValue("html");
    await frame.waitForDisplayed();
  });
});
