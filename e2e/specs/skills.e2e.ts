import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { $, $$, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";

const skills = [
  { id: "mnemonic", title: "Mnemonic", format: "Markdown" },
  { id: "make-it-stick", title: "Make it stick", format: "Markdown" },
  { id: "example", title: "Example", format: "Markdown" },
  { id: "slide-deck", title: "Slide Deck", format: "HTML" },
  { id: "infographic", title: "Infographic", format: "HTML" },
];
const source = "# Study\n\nMitochondria make ATP.\n";
const vault = process.env.AXIS_E2E_VAULT!;
const qa = path.resolve(".agents/qa/T-222");
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

async function openMenu() {
  await $(".cm-content").click();
  await browser.keys([Key.Ctrl, "/"]);
  await browser.keys(Key.Ctrl);
  await $(".cm-tooltip-autocomplete").waitForDisplayed();
}

describe("Categorized built-in AI skills (T-222)", () => {
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

  it("keeps one Skills tab with all fifteen skills in the human's category order", async () => {
    await openMenu();
    await $('.cm-commandTab[data-section="Skills"]').click();
    await expect($('.cm-commandTab[data-section="Skills"]')).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(await $$('.cm-commandTab[data-section="Skills"]').length).toBe(1);
    const groups = [
      ["Notes & summaries", ["AI notes", "Summary"]],
      ["Learn & understand", ["Tutor", "Teach me", "Teach the AI", "Example"]],
      ["Practice & remember", ["Practice test", "Flash cards", "Mnemonic", "Make it stick"]],
      ["Visualize & present", ["Mind map", "Infographic", "Slide Deck"]],
      ["Plan & collaborate", ["Grill me", "Handoff"]],
    ] as const;
    const shown = await browser.execute(() =>
      [...document.querySelectorAll<HTMLElement>("completion-section[data-skill-category]")].map(
        (heading): [string, string[]] => {
          const titles: string[] = [];
          for (
            let row = heading.nextElementSibling;
            row?.tagName === "LI";
            row = row.nextElementSibling
          ) {
            titles.push(row.querySelector(".cm-completionLabel")?.textContent ?? "");
          }
          return [heading.textContent ?? "", titles];
        },
      ),
    );
    expect(shown.slice(0, groups.length)).toEqual(groups);
    // Since T-257 the bundled Matt Pocock collection follows the built-in categories, its
    // look-alike titles named after him so they don't hide AXIS's own skills.
    expect(shown.slice(groups.length).map(([name]) => name)).toEqual(["Matt Pocock"]);
    const [, collection] = shown[groups.length]!;
    expect(collection.length).toBeGreaterThan(20);
    expect(collection).toEqual(expect.arrayContaining(["Grill Me (Matt Pocock)", "TDD"]));
    for (const [index, [category, titles]] of groups.entries()) {
      await $(`completion-section[data-skill-category="${category}"]`).scrollIntoView({
        block: "start",
      });
      for (const title of titles) {
        const label = await $(".cm-tooltip-autocomplete").$(`span=${title}`);
        await expect(label.$("..").$(".cm-commandIcon svg")).toExist();
      }
      await browser.saveScreenshot(path.join(qa, `skills-category-${index + 1}.png`));
    }
    await browser.keys(Key.Escape);
  });

  for (const skill of skills) {
    it(`runs ${skill.title} in both formats without changing the source note`, async () => {
      await openMenu();
      await browser.keys(skill.title);
      // Other commands match a skill's name too (T-257's collection, T-267's study
      // blocks), so pick the skill itself.
      await $(".cm-tooltip-autocomplete").$(`.cm-completionLabel=${skill.title}`).click();
      const block = $('[role="group"][aria-label="AI block"]');
      await expect(block.$(".ai-skill")).toHaveText(
        expect.stringContaining(`Skill: ${skill.title}`),
      );
      await expect(block.$(`button=${skill.format}`)).toHaveAttribute("aria-pressed", "true");

      for (const format of [skill.format, skill.format === "HTML" ? "Markdown" : "HTML"]) {
        answer =
          format === "HTML"
            ? `<!doctype html><html><head><title>${skill.title}</title></head><body><h1>${skill.title}</h1><p>Mitochondria make ATP.</p></body></html>`
            : `# ${skill.title}\n\nMitochondria make ATP.`;
        await block.$(`button=${format}`).click();
        const count = requests.length;
        await block.$("button=Run").click();
        if (format === "HTML") {
          const output = path.join(vault, `Welcome - ${skill.title}.html`);
          await block.$("button=Open page").waitForDisplayed();
          await browser.waitUntil(() => fs.existsSync(output));
          expect(fs.readFileSync(output, "utf8")).toContain("Mitochondria make ATP.");
        } else {
          await block.$("button=Insert").waitForDisplayed();
          await expect(block.$('[aria-label="Answer"]')).toHaveText(
            expect.stringContaining(skill.title),
          );
        }
        expect(requests.length).toBe(count + 1);
        expect(requests.at(-1)).toContain(`# Skill: ${skill.title}`);
        expect(requests.at(-1)).toContain("Mitochondria make ATP.");
        expect(fs.readFileSync(path.join(vault, "Welcome.md"), "utf8")).toBe(source);
      }
      await browser.saveScreenshot(path.join(qa, `${skill.id}.png`));
      await block.$('[aria-label="Close AI block"]').click();
    });
  }
});
