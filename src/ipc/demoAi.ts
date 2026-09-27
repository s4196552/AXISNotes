import type { AiRunRequest } from "./types";

// Canned answers for the browser preview (`pnpm dev`), where no AI provider is called:
// enough to click through the AI features. The desktop app never uses these.

const lastUserText = (req: AiRunRequest) =>
  [...req.messages]
    .reverse()
    .find((m) => m.role === "user")
    ?.content.flatMap((p) => (p.type === "text" ? [p.text] : []))
    .join("\n") ?? "";

const FIXES: [RegExp, string][] = [
  [/\bteh\b/g, "the"],
  [/\brecieve/g, "receive"],
  [/\bsentance/g, "sentence"],
  [/\bmispeled\b/g, "misspelled"],
  [/\bi\b/g, "I"],
  [/ {2,}/g, " "],
];

export function demoAnswer(req: AiRunRequest): string | null {
  switch (req.task) {
    case "handwriting":
      return JSON.stringify({
        text: "Browser preview: handwritting is read by your AI provider in the desktop app.",
        uncertain: [
          { word: "handwritting", alternatives: ["handwriting"], reason: "misspelled" },
          { word: "preview", alternatives: ["review", "previews"], reason: "unclear" },
        ],
      });
    case "textFixes":
      return FIXES.reduce((t, [re, to]) => t.replace(re, to), lastUserText(req));
    default:
      return null;
  }
}
