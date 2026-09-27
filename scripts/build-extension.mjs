// Copies the libraries and icons the browser extension needs into extension/ (they are
// generated, not committed). Then load extension/ unpacked in Chrome/Edge/Firefox.
// It also writes dist-extension/: the same files without tests, which the installers
// bundle so users can load the extension from the app's folder.
import { copyFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ext = join(root, "extension");
const dist = join(root, "dist-extension");
const copy = (from, to) => {
  mkdirSync(dirname(join(ext, to)), { recursive: true });
  copyFileSync(join(root, from), join(ext, to));
};

copy("node_modules/@mozilla/readability/Readability.js", "vendor/Readability.js");
copy("node_modules/turndown/lib/turndown.browser.umd.js", "vendor/turndown.js");
copy(
  "node_modules/turndown-plugin-gfm/dist/turndown-plugin-gfm.js",
  "vendor/turndown-plugin-gfm.js",
);
copy("src-tauri/icons/32x32.png", "icons/32.png");
copy("src-tauri/icons/128x128.png", "icons/128.png");

rmSync(dist, { recursive: true, force: true });
cpSync(ext, dist, { recursive: true, filter: (src) => !/\.test\.[jt]s$/.test(src) });
console.log("extension/ is ready to load unpacked; dist-extension/ is ready to bundle");
