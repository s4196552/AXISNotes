import fs from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
// Usage: node scripts/measure-module-bundle.mjs [build-directory] [baseline-build-directory]
// Build using Vite --manifest first. This measures bytes, not runtime memory/latency.
function measure(directory) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(directory, ".vite", "manifest.json"), "utf8"),
  );
  const initial = new Set();
  function visit(key) {
    if (initial.has(key)) return;
    initial.add(key);
    for (const dep of manifest[key]?.imports ?? []) visit(dep);
  }
  for (const [key, entry] of Object.entries(manifest)) if (entry.isEntry) visit(key);
  const files = [...initial]
    .map((key) => manifest[key].file)
    .filter((file) => file.endsWith(".js"));
  let bytes = 0,
    gzipBytes = 0;
  for (const file of files) {
    const data = fs.readFileSync(path.join(directory, file));
    bytes += data.length;
    gzipBytes += gzipSync(data).length;
  }
  const optional = [
    "GraphView",
    "TimeRuntime",
    "TimerControls",
    "mermaidBlocks",
    "AiSettings",
    "HandwritingDialog",
    "DiagramMaker",
  ];
  const features = Object.fromEntries(
    optional.map((name) => [
      name,
      Object.entries(manifest)
        .filter(([key]) => key.includes(name))
        .map(([key, entry]) => ({ source: key, initial: initial.has(key), file: entry.file })),
    ]),
  );
  return { initialJavaScript: { bytes, gzipBytes, files }, features };
}
const current = measure(path.resolve(process.argv[2] ?? "dist"));
const baseline = process.argv[3] ? measure(path.resolve(process.argv[3])) : undefined;
console.log(
  JSON.stringify(
    {
      current,
      ...(baseline
        ? {
            baseline,
            deltaBytes: current.initialJavaScript.bytes - baseline.initialJavaScript.bytes,
            deltaGzipBytes:
              current.initialJavaScript.gzipBytes - baseline.initialJavaScript.gzipBytes,
          }
        : {}),
    },
    null,
    2,
  ),
);
