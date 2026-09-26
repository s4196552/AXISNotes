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

/** Seed a fresh vault; its path is shared with the specs via AXIS_E2E_VAULT. */
function createVault(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "axis-e2e-"));
  fs.writeFileSync(path.join(dir, "Welcome.md"), "# Welcome\n\nHello from disk\n");
  fs.mkdirSync(path.join(dir, "School"));
  fs.writeFileSync(path.join(dir, "School", "Biology.md"), "# Biology\n\n- [ ] read ch. 1\n");
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
    const vault = createVault();
    // Inherited by the worker (specs) and by the app launched through tauri-driver.
    process.env.AXIS_E2E_VAULT = vault;
    process.env.AXIS_OPEN_VAULT = vault;
  },

  beforeSession() {
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
  },

  onComplete() {
    const vault = process.env.AXIS_E2E_VAULT;
    if (vault?.includes("axis-e2e-")) fs.rmSync(vault, { recursive: true, force: true });
  },
};
