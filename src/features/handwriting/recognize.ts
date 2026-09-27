import type { AiRunRequest, AiRunResult } from "../../ipc";
import { parseAnswer, type Schema } from "../../lib/aiJson";
import { normalizeWord, proseWords } from "../../lib/spelling";
import { type Speller } from "../spellcheck/engine";
import { type AiRun, askValidated, text } from "../ai/runAi";

// Handwriting to text: the strokes are rendered to an image and sent to the vision model
// chosen for the "handwriting" task. The model returns the text plus the words it is
// unsure about (hard to read, or misspelled by the writer) with alternatives. The local
// spellchecker then flags anything else that isn't a dictionary word.

export interface Image {
  mime: "image/png" | "image/jpeg";
  /** Base64, no `data:` prefix. */
  data: string;
}

export interface UncertainWord {
  word: string;
  /** Which occurrence of `word` in the text (1 = first). */
  occurrence?: number;
  alternatives: string[];
  reason: "unclear" | "misspelled";
}

export interface Recognition {
  text: string;
  uncertain: UncertainWord[];
}

export const RECOGNITION_SCHEMA: Schema = {
  type: "object",
  props: {
    text: { type: "string" },
    uncertain: {
      type: "array",
      optional: true,
      items: {
        type: "object",
        props: {
          word: { type: "string" },
          occurrence: { type: "number", optional: true },
          alternatives: { type: "array", items: { type: "string" } },
          reason: { type: "string", enum: ["unclear", "misspelled"] },
        },
      },
    },
  },
};

const INSTRUCTIONS = `Transcribe the handwriting in the image exactly as written.
Reply with only a JSON object of this shape:
{"text": "<the transcription>", "uncertain": [{"word": "<word as it appears in text>", "occurrence": 1, "alternatives": ["<other likely readings or the correct spelling>"], "reason": "unclear" | "misspelled"}]}
Rules:
- Keep the writer's line breaks. Write lists as Markdown lists ("- item") and keep numbering.
- If a word is hard to read, put your best reading in "text" and list it in "uncertain" with reason "unclear" and up to 3 alternatives.
- If the writer misspelled a word, keep their spelling in "text" and list it with reason "misspelled" and the correct spelling first in "alternatives".
- "occurrence" says which occurrence of the word in "text" is meant (1 = first).
- Do not add commentary. If there is no handwriting, reply {"text": "", "uncertain": []}.`;

export function handwritingRequest(image: Image, sources: string[] = []): AiRunRequest {
  return {
    task: "handwriting",
    json: true,
    effort: "quick",
    sources,
    messages: [
      text("system", "You are a precise handwriting transcriber. Answer in JSON."),
      {
        role: "user",
        content: [
          { type: "image", mime: image.mime, data: image.data },
          { type: "text", text: INSTRUCTIONS },
        ],
      },
    ],
  };
}

export async function recognize(
  image: Image,
  opts: { sources?: string[]; run?: AiRun; onRetry?(problems: string[]): void } = {},
): Promise<{ recognition: Recognition; result: AiRunResult; attempts: number }> {
  const r = await askValidated(
    handwritingRequest(image, opts.sources),
    (answer) => {
      const raw = parseAnswer<Recognition>(answer, RECOGNITION_SCHEMA);
      return { text: raw.text, uncertain: raw.uncertain ?? [] };
    },
    { run: opts.run, onRetry: opts.onRetry },
  );
  return { recognition: r.value, result: r.result, attempts: r.attempts };
}

// ---- Flagged words ----

export type Piece =
  | { kind: "text"; text: string }
  | {
      kind: "flag";
      id: number;
      word: string;
      alternatives: string[];
      reason: "unclear" | "misspelled" | "spelling";
    };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Position of the `n`-th whole-word occurrence of `word` in `text` (1-based). */
function findWord(text: string, word: string, n: number): number {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escape(word)}(?![\\p{L}\\p{N}])`, "gu");
  let i = 0;
  for (const m of text.matchAll(re)) if (++i === n) return m.index;
  return -1;
}

/**
 * Split the transcription into plain text and flagged words: the model's uncertain
 * words first, then words the local dictionary doesn't know.
 */
export async function flagWords(rec: Recognition, speller?: Speller): Promise<Piece[]> {
  type Flag = {
    from: number;
    to: number;
    word: string;
    alternatives: string[];
    reason: "unclear" | "misspelled" | "spelling";
  };
  const flags: Flag[] = [];
  const taken = (from: number, to: number) => flags.some((f) => from < f.to && to > f.from);
  for (const u of rec.uncertain) {
    const word = u.word.trim();
    if (!word) continue;
    const at = findWord(rec.text, word, Math.max(1, Math.round(u.occurrence ?? 1)));
    if (at < 0 || taken(at, at + word.length)) continue;
    flags.push({
      from: at,
      to: at + word.length,
      word,
      alternatives: u.alternatives.filter((a) => a && a !== word).slice(0, 5),
      reason: u.reason,
    });
  }
  if (speller) {
    const words: { from: number; to: number; word: string }[] = [];
    let offset = 0;
    for (const line of rec.text.split("\n")) {
      words.push(...proseWords(line, offset));
      offset += line.length + 1;
    }
    const candidates = words.filter((w) => !taken(w.from, w.to));
    const ok = await speller
      .check(candidates.map((w) => normalizeWord(w.word)))
      .catch(() => candidates.map(() => true));
    const wrong = candidates.filter((_, i) => ok[i] === false).slice(0, 30);
    const suggestions = await Promise.all(
      wrong.map((w) => speller.suggest(normalizeWord(w.word)).catch(() => [])),
    );
    wrong.forEach((w, i) =>
      flags.push({ ...w, alternatives: suggestions[i]!.slice(0, 5), reason: "spelling" }),
    );
  }
  flags.sort((a, b) => a.from - b.from);
  const out: Piece[] = [];
  let pos = 0;
  flags.forEach((f, id) => {
    if (f.from > pos) out.push({ kind: "text", text: rec.text.slice(pos, f.from) });
    out.push({ kind: "flag", id, word: f.word, alternatives: f.alternatives, reason: f.reason });
    pos = f.to;
  });
  if (pos < rec.text.length) out.push({ kind: "text", text: rec.text.slice(pos) });
  return out;
}

/** The final text, with each flagged word replaced by its chosen value (or kept). */
export function joinPieces(pieces: Piece[], chosen: ReadonlyMap<number, string>): string {
  return pieces.map((p) => (p.kind === "text" ? p.text : (chosen.get(p.id) ?? p.word))).join("");
}
