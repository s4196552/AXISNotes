import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Import, Handwriting, Getting Started and Settings use the Ask AI dialog's header, footer
// and icon-button classes. Those rules must be global (app.css, loaded at start), not in
// ai.css, which only loads with an AI feature.
const shared = [
  ".ai-icon",
  ".ai-error",
  ".spin",
  ".ask-ai",
  ".ask-ai-header",
  ".ask-ai-footer",
  ".ask-ai-spacer",
  ".ask-ai-body",
];

const selectors = (path: string) =>
  readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .flatMap((rule) => (rule.split("{")[0] ?? "").split(","))
    .map((s) => s.trim());

describe("shared dialog styles", () => {
  it("live in the global stylesheet", () => {
    const app = selectors("src/styles/app.css");
    for (const s of shared) expect(app).toContain(s);
  });

  it("are not left behind in the lazily loaded AI stylesheet", () => {
    const ai = selectors("src/features/ai/ai.css");
    for (const s of shared) expect(ai).not.toContain(s);
  });
});
