// Study blocks in notes (T-267): ```flashcards, ```quiz and ```mindmap fences whose
// bodies are short plain-text formats (docs/proposals/html-in-notes.md §4). The note keeps
// only this text. The parsers turn it into plain data; the cards build their DOM from
// that data with React text, never HTML. Nothing here schedules reviews: spaced
// repetition and review history belong to AXIS Deck.

export type StudyKind = "flashcards" | "quiz" | "mindmap";

export const STUDY_KINDS: readonly StudyKind[] = ["flashcards", "quiz", "mindmap"];

/** The block kind a fence's info string names, if it's a study block. */
export function studyKind(info: string): StudyKind | null {
  const lang = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return (STUDY_KINDS as readonly string[]).includes(lang) ? (lang as StudyKind) : null;
}

/** Bigger blocks show a "too large" card with the source still editable. */
export const MAX_BODY = 200_000;
export const MAX_ITEMS = 1000;

export interface Header {
  title: string | null;
  shuffle: boolean;
  reverse: boolean;
  /** Every `key: value` line of the header, lower-cased keys (unknown ones are kept). */
  fields: Record<string, string>;
}

export interface Flashcard {
  front: string;
  back: string;
  /** 1-based line of the card's `Q:` in the block body. */
  line: number;
}

export interface FlashcardsBlock {
  kind: "flashcards";
  header: Header;
  cards: Flashcard[];
}

export interface QuizOption {
  text: string;
  correct: boolean;
}

export interface QuizQuestion {
  text: string;
  /** Multiple choice: one or more options marked `[x]`. Empty for short answer. */
  options: QuizOption[];
  /** Short answer: accepted answers, compared ignoring case and spacing. */
  answers: string[];
  explanation: string;
  line: number;
}

export interface QuizBlock {
  kind: "quiz";
  header: Header;
  questions: QuizQuestion[];
}

export interface MindNode {
  id: string;
  label: string;
  children: MindNode[];
}

export interface MindmapBlock {
  kind: "mindmap";
  header: Header;
  root: MindNode;
  count: number;
}

export type StudyBlock = FlashcardsBlock | QuizBlock | MindmapBlock;

export type ParseResult<T> = { ok: true; block: T } | { ok: false; line: number; error: string };

const fail = (line: number, error: string) => ({ ok: false as const, line, error });

const yes = (v: string | undefined) => !!v && /^(true|yes|on|1)$/i.test(v.trim());

const HEADER_LINE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;

/**
 * The optional header: `key: value` lines at the top, up to the first blank line or the
 * first line that isn't one. `stop` names keys that start the body instead (`Q`, `A`).
 */
function readHeader(lines: string[], stop: (key: string) => boolean): [Header, number] {
  const fields: Record<string, string> = {};
  let i = 0;
  while (i < lines.length && !lines[i]!.trim()) i++;
  for (; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim()) break;
    const m = HEADER_LINE.exec(line.trim());
    if (!m || stop(m[1]!.toLowerCase())) break;
    fields[m[1]!.toLowerCase()] = m[2]!.trim();
  }
  const title = fields.title?.trim() || null;
  return [{ title, shuffle: yes(fields.shuffle), reverse: yes(fields.reverse), fields }, i];
}

const tooBig = (body: string) =>
  body.length > MAX_BODY
    ? fail(1, "This block is too large to show. Split it into smaller blocks.")
    : null;

const QA = /^(Q|A)\s*:\s?(.*)$/i;

/** Parse a ```flashcards body. */
export function parseFlashcards(body: string): ParseResult<FlashcardsBlock> {
  const big = tooBig(body);
  if (big) return big;
  const lines = body.split(/\r?\n/);
  const [header, start] = readHeader(lines, (k) => k === "q" || k === "a");
  const cards: Flashcard[] = [];
  let card: { front: string[]; back: string[] | null; line: number } | null = null;

  const finish = (): ReturnType<typeof fail> | null => {
    if (!card) return null;
    if (!card.back)
      return fail(card.line, "This card has a question but no answer. Add an A: line.");
    const front = card.front.join("\n").trim();
    const back = card.back.join("\n").trim();
    if (!front) return fail(card.line, "This card's question is empty.");
    if (!back) return fail(card.line, "This card's answer is empty.");
    cards.push({ front, back, line: card.line });
    card = null;
    return null;
  };

  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]!;
    const n = i + 1;
    if (!raw.trim()) {
      const err = finish();
      if (err) return err;
      continue;
    }
    const m = QA.exec(raw.trim());
    if (m && m[1]!.toUpperCase() === "Q") {
      const err = finish();
      if (err) return err;
      card = { front: [m[2]!], back: null, line: n };
    } else if (m) {
      if (!card) return fail(n, "This answer has no question. Start each card with a Q: line.");
      if (card.back) return fail(n, "This card already has an answer.");
      card.back = [m[2]!];
    } else if (card) {
      (card.back ?? card.front).push(raw.trim());
    } else {
      return fail(n, "This line isn't part of a card. Start each card with Q: and A: lines.");
    }
    if (cards.length > MAX_ITEMS) return fail(n, `A block can hold up to ${MAX_ITEMS} cards.`);
  }
  const err = finish();
  if (err) return err;
  if (!cards.length) return fail(1, "This block has no cards yet. Add Q: and A: lines.");
  return { ok: true, block: { kind: "flashcards", header, cards } };
}

const OPTION = /^[-*+]\s+\[([ xX])\]\s*(.*)$/;

/** Parse a ```quiz body. */
export function parseQuiz(body: string): ParseResult<QuizBlock> {
  const big = tooBig(body);
  if (big) return big;
  const lines = body.split(/\r?\n/);
  const [header, start] = readHeader(lines, (k) => k === "q");
  const questions: QuizQuestion[] = [];
  let q: (QuizQuestion & { textLines: string[]; why: string[] }) | null = null;

  const finish = (): ReturnType<typeof fail> | null => {
    if (!q) return null;
    const text = q.textLines.join("\n").trim();
    if (!text) return fail(q.line, "This question is empty.");
    if (q.options.length && q.answers.length)
      return fail(
        q.line,
        "A question has either options (- [ ] lines) or answers (= lines), not both.",
      );
    if (!q.options.length && !q.answers.length)
      return fail(
        q.line,
        "This question has no options or answers. Add - [ ] / - [x] lines or = lines.",
      );
    if (q.options.length === 1)
      return fail(q.line, "A multiple-choice question needs at least two options.");
    if (q.options.length && !q.options.some((o) => o.correct))
      return fail(q.line, "Mark the correct option with - [x].");
    questions.push({
      text,
      options: q.options,
      answers: q.answers,
      explanation: q.why.join("\n").trim(),
      line: q.line,
    });
    q = null;
    return null;
  };

  for (let i = start; i < lines.length; i++) {
    const t = lines[i]!.trim();
    const n = i + 1;
    if (!t) continue;
    const head = /^Q\s*:\s?(.*)$/i.exec(t);
    if (head) {
      const err = finish();
      if (err) return err;
      q = {
        text: "",
        textLines: [head[1]!],
        options: [],
        answers: [],
        explanation: "",
        why: [],
        line: n,
      };
      if (questions.length >= MAX_ITEMS)
        return fail(n, `A block can hold up to ${MAX_ITEMS} questions.`);
      continue;
    }
    if (!q)
      return fail(n, "This line isn't part of a question. Start each question with a Q: line.");
    const opt = OPTION.exec(t);
    if (opt) {
      if (!opt[2]!.trim()) return fail(n, "This option is empty.");
      q.options.push({ text: opt[2]!.trim(), correct: opt[1] !== " " });
    } else if (t.startsWith("=")) {
      const a = t.slice(1).trim();
      if (!a) return fail(n, "This answer is empty.");
      q.answers.push(a);
    } else if (t.startsWith(">")) {
      q.why.push(t.slice(1).trim());
    } else if (!q.options.length && !q.answers.length && !q.why.length) {
      q.textLines.push(t);
    } else {
      return fail(n, "Options start with - [ ] or - [x], answers with =, and explanations with >.");
    }
  }
  const err = finish();
  if (err) return err;
  if (!questions.length) return fail(1, "This quiz has no questions yet. Add a Q: line.");
  return { ok: true, block: { kind: "quiz", header, questions } };
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;

/** Parse a ```mindmap body: an optional `title:` and a nested Markdown list. */
export function parseMindmap(body: string): ParseResult<MindmapBlock> {
  const big = tooBig(body);
  if (big) return big;
  const lines = body.split(/\r?\n/);
  const [header, start] = readHeader(lines, () => false);
  const top: MindNode[] = [];
  // Open items with the indent of their marker.
  const stack: { indent: number; node: MindNode }[] = [];
  let count = 0;
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i]!.replace(/\t/g, "    ");
    const n = i + 1;
    if (!raw.trim()) continue;
    const m = LIST_ITEM.exec(raw);
    if (!m)
      return fail(n, "Each line of a mind map is a list item (- Idea), indented under its parent.");
    const label = m[2]!.trim();
    if (!label) return fail(n, "This item is empty.");
    if (++count > MAX_ITEMS) return fail(n, `A mind map can hold up to ${MAX_ITEMS} items.`);
    const indent = m[1]!.length;
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    const node: MindNode = { id: `n${n}`, label, children: [] };
    (stack.at(-1)?.node.children ?? top).push(node);
    stack.push({ indent, node });
  }
  if (!top.length)
    return fail(1, "This mind map has no items yet. Add a list: - Idea, with indented sub-ideas.");
  let root: MindNode;
  if (header.title) root = { id: "root", label: header.title, children: top };
  else if (top.length === 1) root = top[0]!;
  else root = { id: "root", label: "Mind map", children: top };
  return { ok: true, block: { kind: "mindmap", header, root, count } };
}

export function parseStudyBlock(kind: StudyKind, body: string): ParseResult<StudyBlock> {
  if (kind === "flashcards") return parseFlashcards(body);
  if (kind === "quiz") return parseQuiz(body);
  return parseMindmap(body);
}

/** Whether a short answer matches one of the accepted answers (case and spacing ignored). */
export function matchesAnswer(given: string, accepted: readonly string[]): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const g = norm(given);
  return !!g && accepted.some((a) => norm(a) === g);
}

/** A mind map as a Mermaid `mindmap` block's body (labels kept to plain words). */
export function toMermaidMindmap(root: MindNode): string {
  const clean = (s: string) =>
    s
      .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, t: string, a?: string) => a ?? t)
      .replace(/[[\](){}"`*_:#]/g, "")
      .replace(/\s+/g, " ")
      .trim() || "item";
  const out = ["mindmap"];
  const walk = (node: MindNode, depth: number) => {
    out.push(
      `${"  ".repeat(depth)}${depth === 1 ? `root((${clean(node.label)}))` : clean(node.label)}`,
    );
    for (const c of node.children) walk(c, depth + 1);
  };
  walk(root, 1);
  return out.join("\n");
}

/** Fisher–Yates shuffle of indexes 0..n-1. */
export function shuffled(n: number, random: () => number = Math.random): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
