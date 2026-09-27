import fs from "node:fs";
import path from "node:path";
import { $, browser, expect } from "@wdio/globals";
import { Key } from "webdriverio";
// The browser extension's delivery code, run here against the real app.
import { deliver, flush, newClip, pair, queued } from "../../extension/lib/queue.js";

// Phase 6 on the real app: image embeds served from the vault; importing an Obsidian
// vault (notes, attachments, a JSON Canvas); the web clipper, paired and fed by the
// extension's own queue code, including a clip queued while AXIS couldn't be reached;
// Getting started; and a remapped keyboard shortcut.

const vault = process.env.AXIS_E2E_VAULT!;
const obsidian = process.env.AXIS_E2E_OBSIDIAN!;
const port = Number(process.env.AXIS_CLIPPER_PORT);
const QA_DIR = path.resolve(process.cwd(), ".agents", "qa", "phase-6");
const onDisk = (rel: string) => path.join(vault, ...rel.split("/"));
const read = (rel: string) => fs.readFileSync(onDisk(rel), "utf8");
const row = (rel: string) => $(`[data-path="${rel}"]`);

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

async function until(check: () => boolean | Promise<boolean>, message: string) {
  await browser.waitUntil(check, { timeout: 8000, timeoutMsg: message });
}

/** Wait until an <img> matching `selector` has loaded real pixels. */
async function imageLoaded(selector: string) {
  await until(
    () =>
      browser.execute((s: string) => {
        const img = document.querySelector<HTMLImageElement>(s);
        return Boolean(img?.complete && img.naturalWidth > 0);
      }, selector),
    `image ${selector} did not load`,
  );
}

async function command(label: string) {
  await browser.keys([Key.Ctrl, "p"]);
  await $('[role="combobox"][aria-label="Command palette"]').waitForDisplayed();
  await browser.keys(label);
  await browser.keys(Key.Enter);
}

async function openSettings(section: string) {
  await command("Open settings");
  const dialog = $('[role="dialog"][aria-label="Settings"]');
  await dialog.waitForDisplayed();
  await dialog.$("nav").$(`button=${section}`).click();
  return dialog;
}

async function closeDialog() {
  await browser.keys(Key.Escape);
}

/** Extension storage, kept in memory. */
function memoryStorage() {
  const data = new Map<string, unknown>();
  return {
    get: async (k: string) => data.get(k),
    set: async (k: string, v: unknown) => void data.set(k, v),
  };
}

describe("Phase 6: web clipper, import and polish on the real app", () => {
  it("shows images embedded in a note", async () => {
    await row("Notes").click();
    await row("Notes/Photo.md").click();
    await expect($(".editor-title")).toHaveText("Photo");
    await $(".cm-image-embed img").waitForExist();
    await imageLoaded(".cm-image-embed img");
    // Images open on their own too.
    await row("Notes/logo.png").click();
    await imageLoaded("main.content img");
    await snapshot("01-image-embed");
  });

  it("imports an Obsidian vault, converting its canvas", async () => {
    const preview = await invoke<{ obsidian: boolean; name: string }>("inspect_import", {
      source: obsidian,
    });
    expect(preview.obsidian).toBe(true);
    const report = await invoke<{ notes: number; attachments: number; canvases: number }>(
      "import_obsidian",
      { source: obsidian, target: "Old Vault" },
    );
    expect(report).toMatchObject({ notes: 2, attachments: 1, canvases: 1 });
    expect(read("Old Vault/Ideas.md")).toContain("==important==");
    expect(fs.existsSync(onDisk("Old Vault/img/pic.png"))).toBe(true);
    const canvas = JSON.parse(read("Old Vault/Board.axcanvas")) as {
      elements: { type: string; text?: string }[];
    };
    expect(canvas.elements.some((e) => e.type === "arrow")).toBe(true);

    // Obsidian syntax is styled in the editor.
    await row("Old Vault").waitForExist();
    await row("Old Vault").click();
    await row("Old Vault/Ideas.md").click();
    await expect($(".editor-title")).toHaveText("Ideas");
    await expect($(".cm-lp-highlight")).toHaveText("important");
    await expect($(".cm-callout-warning")).toExist();
    await snapshot("02-imported-note");

    // The converted canvas opens with its note card.
    await row("Old Vault/Board.axcanvas").click();
    await $(".excalidraw").waitForExist({ timeout: 15000 });
    await snapshot("03-imported-canvas");
  });

  it("pairs the extension and saves clips, including one queued while AXIS was away", async () => {
    const storage = memoryStorage();
    // AXIS can't be reached (wrong port): the clip waits in the extension's queue.
    const early = newClip("page", {
      title: "Queued page",
      url: "https://example.com/queued",
      markdown: "Saved while **offline**.",
    });
    expect(await deliver(early, { fetch, storage, port: 1, token: "old" })).toBe("retry");
    expect(await queued(storage)).toHaveLength(1);

    // Pair with the code shown in Settings → Web clipper.
    const dialog = await openSettings("Web clipper");
    await expect(dialog.$('[role="status"]')).toHaveText(
      expect.stringContaining(`Listening on 127.0.0.1:${port}`),
    );
    await dialog.$("button=Pair a browser").click();
    const code = await dialog.$('[aria-label="Code"]').getText();
    expect(code).toMatch(/^\d{6}$/);
    const paired = (await pair(code, "E2E browser", { fetch, storage, port })) as {
      token?: string;
    };
    expect(paired.token).toBeTruthy();
    await expect(dialog.$('[aria-label="Paired browsers"]')).toHaveText(
      expect.stringContaining("E2E browser"),
    );
    await snapshot("04-clipper-paired");
    await closeDialog();

    const env = { fetch, storage, port, token: paired.token };
    // The queued clip goes through, and is saved once even if sent again.
    expect(await flush(env)).toMatchObject({ sent: 1, left: 0 });
    expect(await deliver(early, env)).toBe("sent");
    const png = fs.readFileSync(onDisk("Notes/logo.png")).toString("base64");
    expect(
      await deliver(
        newClip("screenshot", {
          title: "Shot",
          url: "https://example.com/shot",
          image: `data:image/png;base64,${png}`,
        }),
        env,
      ),
    ).toBe("sent");

    const notes = fs.readdirSync(onDisk("Clippings")).filter((f) => f.endsWith(".md"));
    expect(notes.filter((f) => f.startsWith("Queued page"))).toHaveLength(1);
    const queuedNote = notes.find((f) => f.startsWith("Queued page"))!;
    expect(read(`Clippings/${queuedNote}`)).toContain("Saved while **offline**.");
    await expect($(".notice")).toHaveText(expect.stringContaining("Clipped “Shot”"));

    // The screenshot note shows its image.
    const shot = notes.find((f) => f.startsWith("Shot"))!;
    await row("Clippings").click();
    await row(`Clippings/${shot}`).click();
    await imageLoaded(".cm-image-embed img");
    await snapshot("05-clipped-screenshot");
  });

  it("Getting started shows the paired browser", async () => {
    await command("Getting started with AXIS");
    const dialog = $('[role="dialog"][aria-label="Getting started"]');
    await dialog.waitForDisplayed();
    await expect(dialog.$("button=Manage")).toExist(); // the web clipper step is done
    await snapshot("06-getting-started");
    await closeDialog();
  });

  it("remaps a keyboard shortcut and uses it", async () => {
    const dialog = await openSettings("Keyboard shortcuts");
    await dialog.$('input[aria-label="Filter commands"]').setValue("Open settings");
    await dialog.$('button[aria-label="Shortcut for Open settings"]').click();
    await browser.keys([Key.Ctrl, Key.Shift, "y"]);
    await expect(dialog.$('button[aria-label="Shortcut for Open settings"]')).toHaveText(
      "Ctrl+Shift+Y",
    );
    await until(
      () => read(".axis/config.json").includes('"settings": "Ctrl+Shift+Y"'),
      "shortcut not saved to .axis/config.json",
    );
    await snapshot("07-shortcut-remapped");
    await closeDialog();
    await dialog.waitForExist({ reverse: true });

    await browser.keys([Key.Ctrl, Key.Shift, "y"]);
    await $('[role="dialog"][aria-label="Settings"]').waitForDisplayed();
    await closeDialog();
  });
});
