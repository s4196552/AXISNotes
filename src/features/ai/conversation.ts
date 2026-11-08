import type { AiMessage } from "../../ipc";

// Follow-up questions: a conversation is the earlier exchanges (`turns`) plus the current
// question. Each new request re-sends the attached notes (prompt caching makes that cheap)
// and as many earlier exchanges as fit, newest first.

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** Earlier exchanges sent with a follow-up, at most (estimated tokens). */
export const HISTORY_TOKENS = 8000;

const tokens = (s: string) => Math.ceil([...s].length / 4);

const msg = (role: Turn["role"], text: string): AiMessage => ({
  role,
  content: [{ type: "text", text }],
});

/**
 * The messages for `question` after `turns`: whole exchanges are dropped, oldest first,
 * until the rest fit `budget`. `prefix` (a selection the user included) goes on the first
 * user message that's kept, so the model still sees it.
 */
export function withHistory(
  turns: Turn[],
  question: string,
  prefix = "",
  budget = HISTORY_TOKENS,
): { messages: AiMessage[]; dropped: number } {
  let kept = turns.slice();
  while (kept.length && kept.reduce((n, t) => n + tokens(t.text), 0) > budget) {
    // Drop the oldest exchange: a user turn and the answer to it.
    kept = kept.slice(kept[1]?.role === "assistant" ? 2 : 1);
  }
  const dropped = turns.length - kept.length;
  const all = [...kept, { role: "user" as const, text: question }];
  const firstUser = all.findIndex((t) => t.role === "user");
  return {
    messages: all.map((t, i) => msg(t.role, i === firstUser ? prefix + t.text : t.text)),
    dropped,
  };
}

/** A conversation as Markdown, for a draft. */
export function conversationMarkdown(title: string, turns: Turn[]): string {
  const lines = [`# ${title}`, ""];
  for (const t of turns) lines.push(`**${t.role === "user" ? "Me" : "AI"}:** ${t.text.trim()}`, "");
  return `${lines.join("\n").trim()}\n`;
}

/** The turns so far plus the current question and its answer, if there is one. */
export function allTurns(turns: Turn[], asked: string, answer: string): Turn[] {
  return asked && answer
    ? [...turns, { role: "user", text: asked }, { role: "assistant", text: answer }]
    : turns;
}
