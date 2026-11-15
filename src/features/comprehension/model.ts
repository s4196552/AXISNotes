import { maskCode, noteName, splitFrontmatter } from "../../lib/markdown";

// The comprehension heatmap (T-261): how well the user understands a topic, one square per
// unit of the material (a note, or a section of one). Pure functions over the levels file,
// `.axisnotes/comprehension.json` (format in docs/DECISIONS.md), and over note text.

/** The five levels, worst to best; a unit with no data has none (gray). */
export const LEVELS = [
  { level: 1, id: "bad", label: "Bad" },
  { level: 2, id: "weak", label: "Weak" },
  { level: 3, id: "fair", label: "Fair" },
  { level: 4, id: "good", label: "Good" },
  { level: 5, id: "best", label: "Best" },
] as const;
export type Level = 1 | 2 | 3 | 4 | 5;
export const isLevel = (v: unknown): v is Level =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
export const levelLabel = (l: Level | null) => (l ? LEVELS[l - 1]!.label : "No data yet");

/** Where a result came from. */
export type ResultFrom = "test" | "flashcards" | "teach";
export const FROM_LABELS: Record<ResultFrom, string> = {
  test: "Practice test",
  flashcards: "Flash cards",
  teach: "Teach me",
};

/** One study result for a unit: a share right (0–1), with how many questions when known. */
export interface StudyResult {
  /** ISO time. */
  at: string;
  from: ResultFrom;
  score: number;
  right?: number;
  total?: number;
}

export interface UnitRecord {
  /** Set by the user; wins over results until cleared. */
  manual?: Level;
  /** Newest last, at most `MAX_RESULTS`. */
  results?: StudyResult[];
}

/** Notes, or each note's sections (its top headings). */
export type UnitMode = "notes" | "sections";

export interface Topic {
  id: string;
  title: string;
  /** Vault paths of notes and folders (folders include every note inside). */
  sources: string[];
  unit: UnitMode;
}

export interface ComprehensionFile {
  version: 1;
  topics: Topic[];
  /** By unit key: `path` for a note, `path#Heading` for a section. */
  units: Record<string, UnitRecord>;
}

export const COMPREHENSION_PATH = ".axisnotes/comprehension.json";
export const MAX_RESULTS = 20;
/** How many recent results a unit's level comes from. */
const RECENT = 3;

export const emptyFile = (): ComprehensionFile => ({ version: 1, topics: [], units: {} });

export const unitKey = (path: string, heading?: string | null) =>
  heading ? `${path}#${heading}` : path;

/** A unit key's note path and heading. */
export function splitKey(key: string): { path: string; heading: string | null } {
  const i = key.indexOf(".md#");
  if (i === -1) return { path: key, heading: null };
  return { path: key.slice(0, i + 3), heading: key.slice(i + 4) || null };
}

const str = (v: unknown): v is string => typeof v === "string";

/** Read the levels file, keeping only what's well formed (it's hand-editable). */
export function parseFile(text: string): ComprehensionFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text || "{}");
  } catch {
    return emptyFile();
  }
  const out = emptyFile();
  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.topics))
    for (const t of r.topics as Record<string, unknown>[]) {
      if (!t || !str(t.id) || !str(t.title)) continue;
      out.topics.push({
        id: t.id,
        title: t.title,
        sources: Array.isArray(t.sources) ? t.sources.filter(str) : [],
        unit: t.unit === "notes" ? "notes" : "sections",
      });
    }
  if (r.units && typeof r.units === "object")
    for (const [key, v] of Object.entries(r.units as Record<string, unknown>)) {
      if (!v || typeof v !== "object") continue;
      const u = v as Record<string, unknown>;
      const rec: UnitRecord = {};
      if (isLevel(u.manual)) rec.manual = u.manual;
      if (Array.isArray(u.results)) {
        const results = (u.results as Record<string, unknown>[])
          .filter(
            (x) =>
              x &&
              str(x.at) &&
              (x.from === "test" || x.from === "flashcards" || x.from === "teach") &&
              typeof x.score === "number" &&
              x.score >= 0 &&
              x.score <= 1,
          )
          .map((x) => {
            const res: StudyResult = {
              at: x.at as string,
              from: x.from as ResultFrom,
              score: x.score as number,
            };
            if (typeof x.right === "number") res.right = x.right;
            if (typeof x.total === "number") res.total = x.total;
            return res;
          });
        if (results.length) rec.results = results.slice(-MAX_RESULTS);
      }
      if (rec.manual || rec.results) out.units[key] = rec;
    }
  return out;
}

export const serialize = (f: ComprehensionFile) => `${JSON.stringify(f, null, 2)}\n`;

/** The level a share right maps to. */
export function levelForScore(score: number): Level {
  if (score < 0.35) return 1;
  if (score < 0.55) return 2;
  if (score < 0.75) return 3;
  if (score < 0.9) return 4;
  return 5;
}

/** A Teach me level as a score, so it averages with test results. */
export const scoreForLevel = (l: Level) => [0.2, 0.45, 0.65, 0.82, 0.95][l - 1]!;

/** A unit's level: the user's own, else the average of its recent results, else none. */
export function levelOf(rec: UnitRecord | undefined): Level | null {
  if (!rec) return null;
  if (rec.manual) return rec.manual;
  const recent = rec.results?.slice(-RECENT);
  if (!recent?.length) return null;
  return levelForScore(recent.reduce((s, r) => s + r.score, 0) / recent.length);
}

// ---- Units from notes ----

export interface Heading {
  level: number;
  text: string;
  /** 1-based line. */
  line: number;
}

/** ATX headings outside frontmatter and code blocks. */
export function headingsOf(text: string): Heading[] {
  const fm = splitFrontmatter(text).length;
  // Blank out the frontmatter and code, keeping line breaks so line numbers still match.
  const body = maskCode(text.slice(0, fm).replace(/[^\n]/g, " ") + text.slice(fm));
  const out: Heading[] = [];
  body.split(/\r?\n/).forEach((line, i) => {
    const m = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (m) out.push({ level: m[1]!.length, text: m[2]!.trim(), line: i + 1 });
  });
  return out;
}

/**
 * A note's sections: its top level of headings, skipping a single H1 that titles the note
 * (then its H2s are the sections). Empty when the note has no headings to split by.
 */
export function sectionsOf(text: string): Heading[] {
  let hs = headingsOf(text);
  // A lone top heading titles the note ("# Biology", "## Module 3: …"): the level below it
  // holds the sections, and with nothing below it the whole note is one square.
  for (;;) {
    if (!hs.length) return [];
    const level = Math.min(...hs.map((h) => h.level));
    if (hs.filter((h) => h.level === level).length > 1) break;
    hs = hs.filter((h) => h.level > level);
  }
  const top = Math.min(...hs.map((h) => h.level));
  const seen = new Set<string>();
  // Repeated heading text would share a key; keep the first.
  return hs.filter((h) => h.level === top && !seen.has(h.text) && seen.add(h.text));
}

export interface Unit {
  key: string;
  path: string;
  heading: string | null;
  /** What the square says on hover. */
  name: string;
}

/** A note's column: its name, a short label, and its squares. */
export interface Column {
  path: string;
  name: string;
  label: string;
  units: Unit[];
}

/** A short column label: a leading code like "M10" or "Week 3", else the first word. */
export function shortLabel(name: string): string {
  const code = /^([A-Za-z]{1,4}[ -]?\d{1,3})\b/.exec(name);
  if (code) return code[1]!.replace(/\s+/g, "");
  const word = name.split(/[\s_-]+/)[0] ?? name;
  return word.length > 5 ? word.slice(0, 4) : word;
}

/** The notes a topic covers: picked notes, and every note in picked folders, in order. */
export function notesInSources(sources: string[], notes: string[]): string[] {
  const found = new Set<string>();
  for (const s of sources) {
    const dir = s.replace(/^\/+|\/+$/g, "");
    if (notes.includes(dir)) found.add(dir);
    else for (const n of notes) if (!dir || n.startsWith(`${dir}/`)) found.add(n);
  }
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** One column per note; in section mode each section is a square (else the note). */
export function buildColumns(notes: { path: string; text: string }[], mode: UnitMode): Column[] {
  return notes.map(({ path, text }) => {
    const name = noteName(path);
    const sections = mode === "sections" ? sectionsOf(text) : [];
    const units: Unit[] = sections.length
      ? sections.map((h) => ({
          key: unitKey(path, h.text),
          path,
          heading: h.text,
          name: `${name} › ${h.text}`,
        }))
      : [{ key: unitKey(path), path, heading: null, name }];
    return { path, name, label: shortLabel(name), units };
  });
}

/**
 * A unit's level: its own; else for a section, its note's (results that only named the
 * note); else for a whole note, the average of its sections'. `inherited` says where a
 * level that isn't the unit's own came from.
 */
export function unitLevel(
  file: ComprehensionFile,
  u: Unit,
): { level: Level | null; inherited: "note" | "sections" | null; rec?: UnitRecord } {
  const own = file.units[u.key];
  const level = levelOf(own);
  if (level) return { level, inherited: null, rec: own };
  if (u.heading) {
    const note = file.units[u.path];
    const l = levelOf(note);
    return l ? { level: l, inherited: "note", rec: note } : { level: null, inherited: null };
  }
  const prefix = `${u.path}#`;
  const parts = Object.entries(file.units)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, r]) => levelOf(r))
    .filter((l): l is Level => l !== null);
  if (!parts.length) return { level: null, inherited: null, rec: own };
  const avg = Math.round(parts.reduce((s, l) => s + l, 0) / parts.length) as Level;
  return { level: avg, inherited: "sections", rec: own };
}

export interface Stats {
  total: number;
  /** Units with a level. */
  covered: number;
  /** Levels 4 and 5. */
  mastered: number;
  /** Units per level, index 0 = level 1. */
  counts: [number, number, number, number, number];
}

export function statsOf(levels: (Level | null)[]): Stats {
  const counts: Stats["counts"] = [0, 0, 0, 0, 0];
  let covered = 0;
  for (const l of levels) {
    if (!l) continue;
    covered++;
    counts[l - 1] = counts[l - 1]! + 1;
  }
  return { total: levels.length, covered, mastered: counts[3] + counts[4], counts };
}

export const percent = (part: number, whole: number) =>
  whole ? Math.round((part / whole) * 100) : 0;

// ---- Changing the file ----

/** Set (or with null clear) the user's own level for a unit. */
export function setManual(f: ComprehensionFile, key: string, level: Level | null) {
  const rec = { ...f.units[key] };
  if (level) rec.manual = level;
  else delete rec.manual;
  const units = { ...f.units };
  if (rec.manual || rec.results?.length) units[key] = rec;
  else delete units[key];
  return { ...f, units };
}

/** A result as a study page or Teach me reports it, for one unit. */
export interface ReportedResult {
  key: string;
  right?: number;
  total?: number;
  /** Teach me's level, when it gives one instead of a score. */
  level?: Level;
}

/** Add results (each unit's reported items summed into one result). */
export function addResults(
  f: ComprehensionFile,
  reported: ReportedResult[],
  from: ResultFrom,
  at: string,
): ComprehensionFile {
  const byKey = new Map<string, { right: number; total: number; levels: Level[] }>();
  for (const r of reported) {
    const e = byKey.get(r.key) ?? { right: 0, total: 0, levels: [] };
    if (r.level) e.levels.push(r.level);
    else if (r.total && r.total > 0) {
      e.right += Math.max(0, Math.min(r.right ?? 0, r.total));
      e.total += r.total;
    }
    byKey.set(r.key, e);
  }
  const units = { ...f.units };
  for (const [key, e] of byKey) {
    let result: StudyResult | null = null;
    if (e.total) result = { at, from, score: e.right / e.total, right: e.right, total: e.total };
    else if (e.levels.length) {
      const avg = e.levels.reduce((s, l) => s + scoreForLevel(l), 0) / e.levels.length;
      result = { at, from, score: avg };
    }
    if (!result) continue;
    const rec = { ...units[key] };
    rec.results = [...(rec.results ?? []), result].slice(-MAX_RESULTS);
    units[key] = rec;
  }
  return { ...f, units };
}

/** A new topic id. */
export const newTopicId = () =>
  `topic-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** Add sources to a topic, without repeats or ones a picked folder already covers. */
export function withSources(topic: Topic, add: string[]): Topic {
  const sources = [...topic.sources];
  for (const s of add.map((p) => p.replace(/^\/+|\/+$/g, ""))) {
    if (sources.includes(s)) continue;
    if (sources.some((d) => !d.endsWith(".md") && s.startsWith(`${d}/`))) continue;
    sources.push(s);
  }
  return { ...topic, sources };
}

// ---- The block in a note ----

/** A heatmap block's info string: ```heatmap */
export const BLOCK_LANG = "heatmap";

/**
 * A ```heatmap block's body: `title:`, `unit: notes|sections` and one `source:` line per
 * note or folder. Unknown lines are ignored.
 */
export function parseBlock(body: string): Omit<Topic, "id"> {
  let title = "";
  let unit: UnitMode = "sections";
  const sources: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*([a-z]+)\s*:\s*(.*?)\s*$/i.exec(line);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const value = m[2]!.replace(/^\[\[|\]\]$/g, "");
    if (key === "title") title = value;
    else if (key === "unit") unit = /^notes?$/i.test(value) ? "notes" : "sections";
    else if ((key === "source" || key === "sources") && value) sources.push(value);
  }
  return { title, unit, sources };
}

/** A topic as a ```heatmap block for a note. */
export function blockText(t: Omit<Topic, "id">): string {
  const lines = [`title: ${t.title}`, `unit: ${t.unit}`, ...t.sources.map((s) => `source: ${s}`)];
  return ["```" + BLOCK_LANG, ...lines, "```"].join("\n");
}
