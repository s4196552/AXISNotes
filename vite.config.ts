/// <reference types="vitest/config" />
import { cpSync, createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// Excalidraw loads its fonts from `window.EXCALIDRAW_ASSET_PATH` (else a CDN). AXIS must
// work offline, so the fonts are served from the app itself under this path.
const EXCALIDRAW_ASSETS = "excalidraw-assets";
const EXCALIDRAW_FONTS = resolve("node_modules/@excalidraw/excalidraw/dist/prod/fonts");

function excalidrawAssets(): Plugin {
  const prefix = `/${EXCALIDRAW_ASSETS}/fonts/`;
  return {
    name: "axis-excalidraw-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?")[0] ?? "";
        if (!url.startsWith(prefix)) return next();
        const file = normalize(
          join(EXCALIDRAW_FONTS, decodeURIComponent(url.slice(prefix.length))),
        );
        if (!file.startsWith(EXCALIDRAW_FONTS) || !existsSync(file) || !statSync(file).isFile())
          return next();
        res.setHeader("Content-Type", "font/woff2");
        createReadStream(file).pipe(res);
      });
    },
    writeBundle(options) {
      const out = options.dir ?? resolve("dist");
      cpSync(EXCALIDRAW_FONTS, join(out, EXCALIDRAW_ASSETS, "fonts"), { recursive: true });
    },
  };
}

// Tauri expects a fixed dev port and must not have the terminal cleared.
export default defineConfig({
  plugins: [react(), excalidrawAssets()],
  resolve: {
    // dictionary-en only exports a Node entry point; the app loads its files as assets.
    alias: { "dictionary-en-files": resolve("node_modules/dictionary-en") },
  },
  define: {
    __AXIS_VERSION__: JSON.stringify(
      (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version,
    ),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022" },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "extension/**/*.test.js"],
    // Component tests drive real CodeMirror in jsdom; allow for slow, busy machines.
    testTimeout: 20_000,
  },
});
