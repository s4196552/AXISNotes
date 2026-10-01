import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
import { tracePointer } from "../helpers/diagnostics";

// Phase 5 acceptance on the real app: offline spellcheck with quick fixes; the AI "fix
// grammar" action; handwriting converted to editable text with uncertain words flagged,
// through two different vision providers (an OpenAI-compatible endpoint and the Anthropic
// Messages API, both mocked on this machine); and a prompt producing an editable diagram
// in a note (Mermaid) and on a canvas (Excalidraw shapes).

const vault = process.env.AXIS_E2E_VAULT!;
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "phase-5");
const read = (rel: string) => fs.readFileSync(path.join(vault, ...rel.split("/")), "utf8");
const row = (rel: string) => $(`[data-path="${rel}"]`);

const HW_OPENAI = {
  text: "Buy milk and bred",
  uncertain: [{ word: "bred", alternatives: ["bread"], reason: "misspelled" }],
};
const HW_CLAUDE = {
  text: "Call Sam at noon",
  uncertain: [{ word: "Sam", alternatives: ["Pam"], reason: "unclear" }],
};
const MERMAID = "flowchart TD\n  A[Prophase] --> B[Metaphase]\n  B --> C[Anaphase]";
const GRAPH = {
  kind: "flowchart",
  direction: "down",
  nodes: [
    { id: "p", label: "Prophase" },
    { id: "m", label: "Metaphase" },
    { id: "a", label: "Anaphase" },
  ],
  edges: [
    { from: "p", to: "m" },
    { from: "m", to: "a" },
  ],
};

interface Seen {
  path: string;
  body: string;
}
const seen: Seen[] = [];
let server: http.Server;
let base = "";

function chatAnswer(body: string): string {
  if (body.includes('"image_url"')) return JSON.stringify(HW_OPENAI);
  if (body.includes("copy editor")) {
    // Like a real model: the user's whole text back, corrected.
    const { messages } = JSON.parse(body) as { messages: { role: string; content: unknown }[] };
    const user = messages.find((m) => m.role === "user")!.content;
    const text =
      typeof user === "string"
        ? user
        : (user as { text?: string }[]).map((p) => p.text ?? "").join("");
    return text.replace("has went", "have gone").replace("libary", "library");
  }
  if (body.includes("JSON graphs")) return JSON.stringify(GRAPH);
  if (body.includes("Mermaid")) return MERMAID;
  return "ok";
}

function startMock(): Promise<void> {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c: Buffer) => (raw += c.toString()));
    req.on("end", () => {
      seen.push({ path: req.url ?? "", body: raw });
      const url = req.url ?? "";
      if (url.endsWith("/models")) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ id: "mock-vision", object: "model" }] }));
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (event: string | null, data: unknown) =>
        res.write(`${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(data)}\n\n`);
      if (url.endsWith("/messages")) {
        // Anthropic Messages streaming format.
        const text = JSON.stringify(HW_CLAUDE);
        send("message_start", {
          type: "message_start",
          message: { model: "claude-sonnet-5", usage: { input_tokens: 1200, output_tokens: 1 } },
        });
        send("content_block_start", {
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        });
        for (const piece of [text.slice(0, 20), text.slice(20)])
          send("content_block_delta", {
            type: "content_block_delta",
            index: 0,
            delta: { type: "text_delta", text: piece },
          });
        send("message_delta", { type: "message_delta", usage: { output_tokens: 30 } });
        send("message_stop", { type: "message_stop" });
        res.end();
        return;
      }
      const answer = chatAnswer(raw);
      for (const piece of answer.match(/[\s\S]{1,24}/g) ?? [])
        send(null, { model: "mock", choices: [{ index: 0, delta: { content: piece } }] });
      send(null, {
        model: "mock",
        choices: [],
        usage: { prompt_tokens: 50, completion_tokens: 20 },
      });
      res.end("data: [DONE]\n\n");
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      resolve();
    }),
  );
}

async function snapshot(name: string) {
  fs.mkdirSync(QA_DIR, { recursive: true });
  await browser.saveScreenshot(path.join(QA_DIR, `${name}.png`));
}

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

interface SettingsView {
  settings: Record<string, unknown> & { tasks: Record<string, unknown> };
}

async function useHandwritingProvider(provider: string, model: string) {
  const { settings } = await invoke<SettingsView>("ai_settings");
  await invoke("ai_save_settings", {
    settings: { ...settings, tasks: { ...settings.tasks, handwriting: { provider, model } } },
  });
}

async function openNote(rel: string, title: string) {
  if (rel.includes("/")) await row(rel.slice(0, rel.lastIndexOf("/"))).click();
  await row(rel).click();
  await expect($(".editor-title")).toHaveText(title);
}

/** Put the cursor at the end of the open note. */
async function cursorAtEnd() {
  await $(".cm-content").click();
  await browser.keys([Key.Ctrl, Key.End]);
}

async function slash(command: string) {
  await browser.keys(Key.Enter);
  await browser.keys(`/${command}`);
  await $(".cm-tooltip-autocomplete").waitForDisplayed();
  await browser.pause(200); // completions ignore Enter for a moment after they open
  await browser.keys(Key.Enter);
}

/** Write a zig-zag on the handwriting pad. */
async function scribble() {
  const pad = $(".hw-pad");
  await pad.waitForDisplayed();
  const stopTrace = await tracePointer(".hw-pad");
  try {
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: pad, x: -150, y: -20 })
      .down()
      .move({ origin: pad, x: -100, y: 30, duration: 100 })
      .move({ origin: pad, x: -50, y: -30, duration: 100 })
      .move({ origin: pad, x: 0, y: 30, duration: 100 })
      .up()
      .perform();
  } finally {
    console.log(`Handwriting native pointer trace: ${JSON.stringify(await stopTrace())}`);
  }
  await $("button*=Convert to text").waitForEnabled();
}

describe("Phase 5: AI features on the real app", () => {
  before(async () => {
    await startMock();
    const { settings } = await invoke<SettingsView>("ai_settings");
    const r = await invoke<{ rejected?: unknown }>("ai_save_settings", {
      settings: {
        ...settings,
        providers: [
          { id: "local", kind: "custom", name: "Mock endpoint", baseUrl: base, enabled: true },
          { id: "claude", kind: "anthropic", name: "Claude", baseUrl: base, enabled: true },
        ],
        tasks: {
          handwriting: { provider: "local", model: "mock-vision" },
          textFixes: { provider: "local", model: "mock-text" },
          diagrams: { provider: "local", model: "mock-text" },
          chat: { provider: "local", model: "mock-text" },
        },
      },
    });
    expect(r.rejected).toBeUndefined();
    await invoke("ai_set_key", { providerId: "claude", key: "sk-ant-e2e" });
  });
  after(() => server?.close());
  afterEach(async function () {
    if (this.currentTest?.state === "failed")
      await snapshot(`fail-${this.currentTest.title.slice(0, 40).replace(/\W+/g, "-")}`);
  });

  it("underlines misspellings offline and fixes one from the quick-fix menu", async () => {
    seen.length = 0;
    await openNote("School/Bio.md", "Bio");
    const bad = $(".cm-misspelled=teh");
    await bad.waitForDisplayed({ timeout: 15_000 }); // the dictionary loads in a worker
    await bad.click({ button: "right" });
    const menu = $(".cm-spell-menu");
    await menu.waitForDisplayed();
    await snapshot("01-spellcheck");
    const the = menu.$("button=the");
    await the.waitForDisplayed({ timeout: 15_000 }); // suggestions arrive from the worker
    await the.click();
    await browser.waitUntil(() => read("School/Bio.md").includes("is the powerhouse"), {
      timeoutMsg: "spelling fix not saved",
    });
    expect(seen).toHaveLength(0); // spellcheck never touches the network
  });

  it("fixes grammar with AI, showing each change before applying it", async () => {
    seen.length = 0;
    await openNote("Essay.md", "Essay");
    await $('[aria-label="Fix writing"]').click();
    await $("button=Fix").click();
    const changes = $('[aria-label="Changes"]');
    await changes.waitForDisplayed();
    await expect(changes.$('button[aria-label^="Change “has went”"]')).toBeDisplayed();
    await snapshot("02-fix-writing");
    await $("button*=Apply").click();
    await browser.waitUntil(
      () => read("Essay.md").includes("I have gone to the library yesterday."),
      { timeoutMsg: "fixes not applied" },
    );
    expect(read("Essay.md").startsWith("# Essay\n\n")).toBe(true);
    expect(seen.some((s) => s.body.includes('"textFixes"') || s.body.includes("copy editor"))).toBe(
      true,
    );
  });

  it("converts handwriting to text with an OpenAI-compatible vision model", async () => {
    seen.length = 0;
    await openNote("Pad.md", "Pad");
    await cursorAtEnd();
    await slash("handwr");
    await scribble();
    await $("button*=Convert to text").click();
    const flag = $('button[aria-label="bred (Misspelled)"]');
    await flag.waitForDisplayed();
    await snapshot("03-handwriting-review");
    await flag.click();
    await $('[role="menuitem"]=bread').click();
    await $("button=Insert into note").click();
    await browser.waitUntil(() => read("Pad.md").includes("Buy milk and bread"), {
      timeoutMsg: "handwriting text not inserted",
    });
    const sent = seen.find((s) => s.path.endsWith("/chat/completions"))!;
    expect(sent.body).toContain("data:image/png;base64,");
  });

  it("converts handwriting with a second provider (Anthropic Messages)", async () => {
    seen.length = 0;
    await useHandwritingProvider("claude", "claude-sonnet-5");
    await cursorAtEnd();
    await slash("handwr");
    await $('[aria-label="Destination"]*=Claude').waitForDisplayed();
    await scribble();
    await $("button*=Convert to text").click();
    const flag = $('button[aria-label="Sam (Hard to read)"]');
    await flag.waitForDisplayed();
    await flag.click();
    await $('[role="menuitem"]=Keep “Sam”').click();
    await $("button=Insert into note").click();
    await browser.waitUntil(() => read("Pad.md").includes("Call Sam at noon"), {
      timeoutMsg: "second provider's text not inserted",
    });
    const sent = seen.find((s) => s.path.endsWith("/messages"))!;
    expect(sent.body).toContain('"type":"image"');
    expect(sent.body).toContain('"media_type":"image/png"');
    expect(read("Pad.md")).toContain("Buy milk and bread");
  });

  it("converts pen strokes on a canvas into a text element", async () => {
    await row("Board.axcanvas").click();
    const canvas = $("canvas.interactive");
    await canvas.waitForDisplayed({ timeout: 20_000 });
    const size = await canvas.getSize();
    await canvas.click({ x: 0, y: 0 });
    await browser.keys("7"); // pen
    await browser
      .action("pointer", { parameters: { pointerType: "mouse" } })
      .move({ origin: canvas, x: -120, y: -40 })
      .down()
      .move({ origin: canvas, x: -60, y: 10, duration: 150 })
      .move({ origin: canvas, x: 0, y: -40, duration: 150 })
      .up()
      .perform();
    void size;
    await browser.waitUntil(
      () => (JSON.parse(read("Board.axcanvas")).elements as { type: string }[]).length > 0,
      { timeoutMsg: "drawing not saved" },
    );
    seen.length = 0;
    await $("button*=Convert to text").click();
    await $('[aria-label="Transcription"]').waitForDisplayed();
    await expect($('[aria-label="Transcription"]')).toHaveText("Call Sam at noon");
    await $("label*=Remove the handwriting").click();
    await $("button=Add to canvas").click();
    await browser.waitUntil(
      () => {
        const els = JSON.parse(read("Board.axcanvas")).elements as {
          type: string;
          text?: string;
          isDeleted?: boolean;
        }[];
        return (
          els.some((e) => e.type === "text" && e.text === "Call Sam at noon") &&
          !els.some((e) => e.type === "freedraw" && !e.isDeleted)
        );
      },
      { timeout: 10_000, timeoutMsg: "canvas text not saved" },
    );
    expect(seen.some((s) => s.body.includes("image/png"))).toBe(true);
    await snapshot("04-canvas-handwriting");
  });

  it("makes an editable Mermaid diagram in a note from a prompt", async () => {
    seen.length = 0;
    await openNote("Plan.md", "Plan");
    await cursorAtEnd();
    await slash("diagram");
    await $('[aria-label="Describe the diagram"]').setValue("flowchart of mitosis");
    await $("button*=Generate").click();
    await $(".dg-preview svg").waitForDisplayed({ timeout: 15_000 });
    await expect($('[aria-label="Mermaid code"]')).toHaveValue(MERMAID);
    await snapshot("05-diagram-preview");
    await $("button=Insert into note").click();
    await browser.waitUntil(() => read("Plan.md").includes("```mermaid\n" + MERMAID + "\n```"), {
      timeoutMsg: "Mermaid block not saved",
    });
    await $(".cm-mermaid svg").waitForDisplayed({ timeout: 15_000 });
    await snapshot("06-diagram-in-note");
    // Editable by hand: clicking the diagram shows its code.
    await $(".cm-mermaid").click();
    await expect($(".cm-content")).toHaveText(expect.stringContaining("A[Prophase]"));
  });

  it("builds a mind map from a note's outline without AI", async () => {
    seen.length = 0;
    await cursorAtEnd();
    await slash("diagram");
    await $('[role="tab"]=From notes (no AI)').click();
    await expect($('[aria-label="Mermaid code"]')).toHaveValue(
      "mindmap\n  n0((Trip))\n    n1[Before]\n      n2[Book flights]\n      n3[Pack]\n    n4[During]\n      n5[Museum]",
    );
    await $("button=Insert into note").click();
    await browser.waitUntil(() => read("Plan.md").includes("```mermaid\nmindmap"));
    expect(seen).toHaveLength(0);
  });

  it("makes a diagram on a canvas as editable shapes and arrows", async () => {
    seen.length = 0;
    await row("Board.axcanvas").click();
    await $("canvas.interactive").waitForDisplayed({ timeout: 20_000 });
    await $("button*=Diagram").click();
    await $('[aria-label="Describe the diagram"]').setValue("stages of mitosis");
    await $("button*=Generate").click();
    await $(".dg-preview svg").waitForDisplayed({ timeout: 15_000 });
    await $("button=Add to canvas").click();
    await browser.waitUntil(
      () => {
        const els = JSON.parse(read("Board.axcanvas")).elements as {
          type: string;
          text?: string;
          startBinding?: unknown;
        }[];
        return (
          els.filter((e) => e.type === "rectangle").length === 3 &&
          els.filter((e) => e.type === "arrow" && e.startBinding).length === 2 &&
          els.some((e) => e.type === "text" && e.text === "Metaphase")
        );
      },
      { timeout: 10_000, timeoutMsg: "diagram shapes not saved to the canvas" },
    );
    expect(seen.some((s) => s.body.includes("JSON graphs"))).toBe(true);
    await snapshot("07-diagram-on-canvas");
  });

  it("keeps 'AI: never' notes away from every AI feature", async () => {
    seen.length = 0;
    await openNote("Private/Diary.md", "Diary");
    await $('[aria-label="Fix writing"]').click();
    await $("button=Fix").click();
    await expect($('.fix-text [role="alert"]')).toHaveText(
      expect.stringMatching(/^Not sent: .*AI: never/),
    );
    await $('[aria-label="Close"]').click();
    await cursorAtEnd();
    await slash("handwr");
    await scribble();
    await $("button*=Convert to text").click();
    await expect($('.hw-dialog [role="alert"]')).toHaveText(
      expect.stringMatching(/^Not sent: .*AI: never/),
    );
    expect(seen).toHaveLength(0);
  });
});
