import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { captureUi, recordCommand } from "./helpers/diagnostics";

// End-to-end tests drive the real AXISNotes desktop build through tauri-driver (WebDriver),
// against a throwaway vault on disk. Runs on Windows and Linux (tauri-driver has no macOS support).
//
// Prereqs: `cargo install tauri-driver`, a native driver matching the system WebView
// (Windows: msedgedriver for WebView2 — set AXIS_MSEDGEDRIVER or place it in
// ~/.axis-e2e/msedgedriver-<version>/), and `pnpm tauri build --debug --no-bundle`.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "axisnotes.exe" : "axisnotes";
const application = path.join(root, "src-tauri", "target", "debug", exe);
/** The web clipper's port in E2E runs (specs read it from AXIS_CLIPPER_PORT). */
const CLIPPER_PORT = 38499;

function findNativeDriver(): string | undefined {
  if (process.env.AXIS_MSEDGEDRIVER) return process.env.AXIS_MSEDGEDRIVER;
  if (process.platform !== "win32") return undefined; // Linux: WebKitWebDriver on PATH
  const base = path.join(os.homedir(), ".axis-e2e");
  const dirs = fs.existsSync(base)
    ? fs
        .readdirSync(base)
        .filter((d) => d.startsWith("msedgedriver-"))
        .sort()
    : [];
  const latest = dirs.at(-1);
  return latest ? path.join(base, latest, "msedgedriver.exe") : undefined;
}

function write(dir: string, rel: string, text: string) {
  const file = path.join(dir, ...rel.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** A folder link: a junction on Windows (no admin rights needed), a symlink elsewhere. */
function linkDir(target: string, link: string) {
  fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
}

/** Seeds per spec file (chosen by name); every spec gets a fresh vault. */
const SEEDS: Record<string, (dir: string) => void> = {
  diagnostics(dir) {
    SEEDS.vault!(dir);
    SEEDS.structured!(dir);
  },
  vault(dir) {
    write(dir, "Welcome.md", "# Welcome\n\nHello from disk\n");
    write(dir, "School/Biology.md", "# Biology\n\n- [ ] read ch. 1\n");
    // Real folders are messy: a link back up the tree and one to a deleted folder must
    // not stop the vault from opening.
    linkDir(dir, path.join(dir, "School", "Back to top"));
    fs.mkdirSync(path.join(dir, "gone"));
    linkDir(path.join(dir, "gone"), path.join(dir, "Broken link"));
    fs.rmdirSync(path.join(dir, "gone"));
  },
  knowledge(dir) {
    write(
      dir,
      "Project Alpha.md",
      "---\nstatus: draft\naliases: [PA]\n---\n# Project Alpha\n\nGoals below.\n\n## Goals\n\nShip it. #work/alpha\n",
    );
    write(
      dir,
      "Meeting.md",
      "# Meeting\n\nDiscussed [[Project Alpha#Goals]] and [[Budget]].\nproject alpha is late.\n#work/beta\n",
    );
    write(
      dir,
      "Research/Cells.md",
      "# Cells\n\nThe mitochondria is the powerhouse of the cell. #biology\n",
    );
  },
  blocks(dir) {
    write(dir, "Groceries.md", "# Groceries\n\n- eggs\n- milk ^m1\n  - oat\n- bread\n");
    write(dir, "Plan.md", "# Plan\n\nThis week:\n\n![[Groceries#^m1]]\n\nMore text.\n");
    write(dir, "Outline.md", "- a\n- b\n  - b1\n- c\n");
  },
  structured(dir) {
    write(
      dir,
      "Budget.axgrid",
      JSON.stringify(
        {
          version: 1,
          rows: 20,
          cols: 6,
          cells: {
            A1: "Item",
            B1: "Cost",
            A2: "Pens",
            B2: "3",
            A3: "Paper",
            B3: "4.5",
            B4: "=SUM(B2:B3)",
          },
          widths: { A: 120 },
          formats: { A1: { bold: true }, B1: { bold: true } },
        },
        null,
        2,
      ) + "\n",
    );
    write(
      dir,
      "Board.axcanvas",
      JSON.stringify(
        {
          type: "excalidraw",
          version: 2,
          source: "axis",
          elements: [],
          appState: { gridModeEnabled: false },
          files: {},
        },
        null,
        2,
      ) + "\n",
    );
    write(dir, "Bio.md", "# Cells\n\nThe mitochondria is the powerhouse.\n");
    write(dir, "Todo.md", "# Todo\n\n- [ ] Water plants 📅 2026-01-02 ⏫\n- [ ] Someday\n");
    write(
      dir,
      "Trip.md",
      "---\nflights: 420\nnights: 3\nrate: 95\ntotal: =flights + nights * rate\n---\n# Trip\n",
    );
  },
  ai(dir) {
    write(dir, "School/Bio.md", "# Bio\n\nMitochondria make ATP.\n");
    write(dir, "Medical/scan.md", "# Scan\n\nPrivate results.\n");
    write(dir, ".axisnotes/config.json", JSON.stringify({ ai: { folders: { Medical: "never" } } }));
  },
  phase5(dir) {
    write(dir, "School/Bio.md", "# Bio\n\nThe mitochondria is teh powerhouse of the cell.\n");
    write(dir, "Essay.md", "# Essay\n\nI has went to the libary yesterday.\n");
    write(dir, "Pad.md", "# Pad\n\nWritten by hand:\n");
    write(dir, "Plan.md", "# Trip\n\n## Before\n- Book flights\n- Pack\n\n## During\n- Museum\n");
    write(dir, "Private/Diary.md", "# Diary\n\nSecret.\n");
    write(dir, ".axisnotes/config.json", JSON.stringify({ ai: { folders: { Private: "never" } } }));
    write(
      dir,
      "Board.axcanvas",
      JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "axis",
        elements: [],
        appState: { gridModeEnabled: false },
        files: {},
      }) + "\n",
    );
  },
  phase6(dir) {
    const png = fs.readFileSync(path.join(root, "src-tauri", "icons", "32x32.png"));
    write(dir, "Notes/Photo.md", "# Photo\n\nOur logo:\n\n![[logo.png]]\n");
    fs.writeFileSync(path.join(dir, "Notes", "logo.png"), png);
    // An Obsidian vault next to the AXISNotes vault, to import from.
    const obsidian = `${dir}-obsidian`;
    write(obsidian, ".obsidian/app.json", JSON.stringify({ attachmentFolderPath: "img" }));
    write(
      obsidian,
      "Ideas.md",
      "# Ideas\n\nThis is ==important==. %%hidden note%%\n\n> [!warning] Careful\n> Mind the gap.\n\nSee [[Plans]].\n",
    );
    write(obsidian, "Plans.md", "# Plans\n\n- [ ] Import my vault\n");
    fs.mkdirSync(path.join(obsidian, "img"), { recursive: true });
    fs.writeFileSync(path.join(obsidian, "img", "pic.png"), png);
    write(
      obsidian,
      "Board.canvas",
      JSON.stringify({
        nodes: [
          { id: "a", type: "text", text: "Big idea", x: 0, y: 0, width: 200, height: 80 },
          { id: "b", type: "file", file: "Plans.md", x: 300, y: 0, width: 240, height: 120 },
        ],
        edges: [{ id: "e", fromNode: "a", toNode: "b" }],
      }),
    );
    process.env.AXIS_E2E_OBSIDIAN = obsidian;
  },
  perf(dir) {
    const words = [
      "cell",
      "energy",
      "project",
      "alpha",
      "history",
      "matrix",
      "river",
      "poem",
      "budget",
      "plan",
    ];
    for (let i = 0; i < 5000; i++) {
      const w1 = words[i % words.length];
      const w2 = words[(i * 7) % words.length];
      write(
        dir,
        `Folder ${i % 50}/Note ${i}.md`,
        `---\nstatus: ${i % 3 ? "draft" : "done"}\n---\n# Note ${i}\n\nAbout ${w1} and ${w2}. See [[Note ${(i + 1) % 5000}]] #area/${w1}\n\n` +
          "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20),
      );
    }
  },
};

function createVault(specFile: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-e2e-"));
  const kind = Object.keys(SEEDS).find((k) => path.basename(specFile).startsWith(k)) ?? "vault";
  SEEDS[kind]!(dir);
  return dir;
}

let driver: ChildProcess | undefined;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.e2e.ts"],
  maxInstances: 1,
  hostname: "127.0.0.1",
  port: 4444,
  capabilities: [
    {
      // tauri-driver launches the app; no browser is involved.
      "tauri:options": { application },
    } as WebdriverIO.Capabilities,
  ],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: { ui: "bdd", timeout: 60_000 },
  waitforTimeout: 8_000,

  onPrepare() {
    if (!fs.existsSync(application)) {
      throw new Error(`Build the app first: pnpm tauri build --debug --no-bundle (${application})`);
    }
  },

  beforeSession(_config, _caps, specs) {
    const vault = createVault(specs[0] ?? "");
    process.env.AXIS_E2E_CAPTURE_NONCE = randomUUID();
    write(
      vault,
      ".axis-e2e-fixture.json",
      JSON.stringify({ nonce: process.env.AXIS_E2E_CAPTURE_NONCE }),
    );
    // Read by the spec (same worker) and by the app launched through tauri-driver.
    process.env.AXIS_E2E_VAULT = vault;
    process.env.AXIS_OPEN_VAULT = vault;
    // AI settings, model registry and request log go to a throwaway folder, and keys stay
    // in memory, so tests never touch the user's settings or keychain.
    process.env.AXIS_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "axis-e2e-config-"));
    process.env.AXIS_AI_MEMORY_KEYS = "1";
    // Its own port, so a running copy of AXISNotes on the default port doesn't get in the way.
    process.env.AXIS_CLIPPER_PORT = String(CLIPPER_PORT);
    const native = findNativeDriver();
    const args = native ? ["--native-driver", native] : [];
    const bin = path.join(os.homedir(), ".cargo", "bin", "tauri-driver");
    driver = spawn(fs.existsSync(bin + ".exe") || fs.existsSync(bin) ? bin : "tauri-driver", args, {
      stdio: [null, process.stdout, process.stderr],
      env: process.env,
    });
  },

  afterCommand(command, args, result) {
    recordCommand(command, args, result);
  },

  async afterTest(test, _context, { passed }) {
    if (!passed) {
      try {
        await captureUi(`${test.parent}-${test.title}`);
      } catch (error) {
        console.warn(`E2E diagnostic capture failed: ${String(error).slice(0, 300)}`);
      }
    }
  },
  afterSession() {
    driver?.kill();
    const config = process.env.AXIS_CONFIG_DIR;
    if (config?.includes("axis-e2e-config-")) {
      setTimeout(() => fs.rmSync(config, { recursive: true, force: true, maxRetries: 5 }), 500);
    }
    for (const dir of [process.env.AXIS_E2E_VAULT, process.env.AXIS_E2E_OBSIDIAN]) {
      if (dir?.includes("axis-e2e-")) {
        // The app may still hold files open for a moment after the session ends.
        setTimeout(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }), 500);
      }
    }
    delete process.env.AXIS_E2E_OBSIDIAN;
  },
};
