import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// End-to-end tests drive the real AXIS desktop build through tauri-driver (WebDriver),
// against a throwaway vault on disk. Runs on Windows and Linux (tauri-driver has no macOS support).
//
// Prereqs: `cargo install tauri-driver`, a native driver matching the system WebView
// (Windows: msedgedriver for WebView2 — set AXIS_MSEDGEDRIVER or place it in
// ~/.axis-e2e/msedgedriver-<version>/), and `pnpm tauri build --debug --no-bundle`.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.platform === "win32" ? "axis.exe" : "axis";
const application = path.join(root, "src-tauri", "target", "debug", exe);

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

/** Seeds per spec file (chosen by name); every spec gets a fresh vault. */
const SEEDS: Record<string, (dir: string) => void> = {
  vault(dir) {
    write(dir, "Welcome.md", "# Welcome\n\nHello from disk\n");
    write(dir, "School/Biology.md", "# Biology\n\n- [ ] read ch. 1\n");
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
    // Read by the spec (same worker) and by the app launched through tauri-driver.
    process.env.AXIS_E2E_VAULT = vault;
    process.env.AXIS_OPEN_VAULT = vault;
    const native = findNativeDriver();
    const args = native ? ["--native-driver", native] : [];
    const bin = path.join(os.homedir(), ".cargo", "bin", "tauri-driver");
    driver = spawn(fs.existsSync(bin + ".exe") || fs.existsSync(bin) ? bin : "tauri-driver", args, {
      stdio: [null, process.stdout, process.stderr],
      env: process.env,
    });
  },

  afterSession() {
    driver?.kill();
    const vault = process.env.AXIS_E2E_VAULT;
    if (vault?.includes("axis-e2e-")) {
      // The app may still hold files open for a moment after the session ends.
      setTimeout(() => fs.rmSync(vault, { recursive: true, force: true, maxRetries: 5 }), 500);
    }
  },
};
