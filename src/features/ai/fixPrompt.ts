import type { AiRunRequest } from "../../ipc";
import { text } from "./runAi";

// Prompt and reply handling for "Fix writing" and "Edit with AI" (a free-text instruction).

export type FixMode = "grammar" | "clarity" | "custom";

const INSTRUCTIONS: Record<Exclude<FixMode, "custom">, string> = {
  grammar: "Fix spelling, grammar and punctuation only. Do not reword sentences that are correct.",
  clarity:
    "Fix spelling, grammar and punctuation, and lightly improve clarity and flow. Keep the meaning, tone, voice and length close to the original.",
};

export function fixRequest(
  original: string,
  mode: FixMode,
  path: string,
  instruction = "",
): AiRunRequest {
  if (mode === "custom")
    return {
      // A rewrite can be substantial: the general model, not the quick-fix one.
      task: "chat",
      effort: "balanced",
      sources: [path],
      messages: [
        text(
          "system",
          "You edit Markdown notes as the user asks. Apply the instruction to the text and reply " +
            "with only the full edited text: no preamble, no explanation, no quotes, no code " +
            "fences. Keep everything the instruction doesn't ask to change exactly as it is, " +
            "including [[wikilinks]], #tags, ^block-ids, links, code and math. Keep the original " +
            "language unless asked to translate.",
        ),
        text("user", `Instruction: ${instruction.trim()}\n\nText:\n${original}`),
      ],
    };
  return {
    task: "textFixes",
    effort: "quick",
    sources: [path],
    messages: [
      text(
        "system",
        `You are a careful copy editor for Markdown notes. ${INSTRUCTIONS[mode]} ` +
          "Keep every Markdown construct exactly as it is: line breaks, headings, list markers, " +
          "links, [[wikilinks]], #tags, ^block-ids, code, math and HTML. Keep the original language. " +
          "Reply with only the corrected text: no preamble, no explanation, no quotes, no code fences.",
      ),
      text("user", original),
    ],
  };
}

/** The model's reply as a replacement for `original` (fences removed, edges kept). */
export function cleanReply(reply: string, original: string): string {
  let body = reply;
  const fence = /^\s*```[\w-]*\n([\s\S]*?)\n?```\s*$/.exec(body);
  if (fence && !original.trimStart().startsWith("```")) body = fence[1]!;
  const lead = /^\s*/.exec(original)![0];
  const trail = /\s*$/.exec(original)![0];
  return lead + body.trim() + trail;
}
