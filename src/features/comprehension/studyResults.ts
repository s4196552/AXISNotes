import { type RefObject, useEffect } from "react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { stricter } from "../../lib/aiAccess";
import { ruleForPath } from "../ai/folderScope";
import {
  addResults,
  FROM_LABELS,
  isLevel,
  type Level,
  type ReportedResult,
  type ResultFrom,
  unitKey,
} from "./model";
import { useComprehension } from "./store";

// Study results reaching the heatmap (T-261). A Practice test or Flash cards page posts
// `{ axisnotesStudy: { kind, items: [{ source, correct }] } }` to the app when the learner
// finishes (see builtinSkills.ts); Teach me returns `comprehension` with its lesson files.
// Each item names the note (and heading) it tests, as "path#Heading". Only notes in the
// vault that AI may read are taken: a page can't report on a note it was never given.

/** The skills whose pages report results (their pages carry `SOURCES_META`). */
export const STUDY_SKILLS: ReadonlySet<string> = new Set(["test", "flashcards"]);

/** The meta tag a saved study page carries with the notes it was made from. */
export const SOURCES_META = "axisnotes-sources";

const escapeAttr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Add the notes a page was made from to its <head>, so its results can be checked. */
export function withStudySources(html: string, sources: string[]): string {
  if (!sources.length || html.includes(`name="${SOURCES_META}"`)) return html;
  const tag = `<meta name="${SOURCES_META}" content="${escapeAttr(JSON.stringify(sources))}">`;
  const head = /<head[^>]*>/i.exec(html);
  if (head)
    return (
      html.slice(0, head.index + head[0].length) + tag + html.slice(head.index + head[0].length)
    );
  return tag + html;
}

/** The notes a saved page says it was made from, or null. */
export function studySourcesOf(html: string): string[] | null {
  const m = new RegExp(`<meta name="${SOURCES_META}" content="([^"]*)"`, "i").exec(html);
  if (!m) return null;
  try {
    const v: unknown = JSON.parse(
      m[1]!
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&"),
    );
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : null;
  } catch {
    return null;
  }
}

export interface StudyMessage {
  kind: "test" | "flashcards";
  items: { source: string; correct: boolean }[];
}

const MAX_ITEMS = 300;

/** A page's message, if it is a well-formed study result. */
export function parseStudyMessage(data: unknown): StudyMessage | null {
  if (!data || typeof data !== "object" || !("axisnotesStudy" in data)) return null;
  const m = (data as { axisnotesStudy: unknown }).axisnotesStudy;
  if (!m || typeof m !== "object") return null;
  const { kind, items } = m as { kind?: unknown; items?: unknown };
  if ((kind !== "test" && kind !== "flashcards") || !Array.isArray(items)) return null;
  const out = items
    .slice(0, MAX_ITEMS)
    .filter(
      (i): i is { source: string; correct: boolean } =>
        !!i &&
        typeof (i as { source?: unknown }).source === "string" &&
        typeof (i as { correct?: unknown }).correct === "boolean",
    )
    .map((i) => ({ source: i.source.slice(0, 500), correct: i.correct }));
  return out.length ? { kind, items: out } : null;
}

/** The notes AI may read (a page's or lesson's results can only be about these). */
function readable(): (path: string) => boolean {
  const refs = useAppStore.getState().notes;
  const marks = new Map(refs.map((n) => [n.path, n.aiAccess ?? "any"] as const));
  const rules = useConfig.getState().config.ai.folders;
  return (p) => marks.has(p) && stricter(ruleForPath(rules, p), marks.get(p)!) !== "never";
}

/**
 * Turn a reported source ("path#Heading", "path" or a note name) into a unit key: a note
 * in the vault that AI may read and, when `allowed` is given, among those notes. A source
 * that names nothing known goes to the only allowed note, if there's just one.
 */
export function resolveSource(
  source: string,
  notes: string[],
  canRead: (path: string) => boolean,
  allowed: string[] | null,
): string | null {
  const s = source.trim().replace(/^\/+/, "");
  const md = s.toLowerCase().indexOf(".md#");
  const hash = md !== -1 ? md + 3 : s.indexOf("#");
  let path = hash === -1 ? s : s.slice(0, hash);
  let heading: string | null = hash === -1 ? null : s.slice(hash + 1);
  if (!/\.md$/i.test(path)) path += ".md";
  if (!notes.includes(path)) {
    // A bare name: the one note with that name.
    const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
    const named = notes.filter((n) => n.slice(n.lastIndexOf("/") + 1).toLowerCase() === name);
    path = named.length === 1 ? named[0]! : "";
  }
  const ok = (p: string) => !!p && canRead(p) && (!allowed || allowed.includes(p));
  if (!ok(path)) {
    const only = allowed?.filter((p) => notes.includes(p) && canRead(p)) ?? [];
    if (only.length !== 1) return null;
    path = only[0]!;
    heading = null;
  }
  return unitKey(path, heading?.trim() || null);
}

/** Record a study page's results; returns how many units they covered. */
export async function recordStudy(msg: StudyMessage, pageSources: string[] | null) {
  const notes = useAppStore.getState().notes.map((n) => n.path);
  const canRead = readable();
  const reported: ReportedResult[] = [];
  for (const item of msg.items) {
    const key = resolveSource(item.source, notes, canRead, pageSources);
    if (key) reported.push({ key, right: item.correct ? 1 : 0, total: 1 });
  }
  return save(reported, msg.kind);
}

/** Teach me's `comprehension` list: levels for the notes the lesson read. */
export async function recordTeach(
  marks: { source: string; level: Level }[] | undefined,
  attached: string[],
) {
  if (!marks?.length) return 0;
  const notes = useAppStore.getState().notes.map((n) => n.path);
  const canRead = readable();
  const reported: ReportedResult[] = [];
  for (const m of marks) {
    const key = resolveSource(m.source, notes, canRead, attached);
    if (key && isLevel(m.level)) reported.push({ key, level: m.level });
  }
  return save(reported, "teach");
}

async function save(reported: ReportedResult[], from: ResultFrom): Promise<number> {
  if (!reported.length) return 0;
  const units = new Set(reported.map((r) => r.key)).size;
  await useComprehension
    .getState()
    .change((f) => addResults(f, reported, from, new Date().toISOString()));
  useAppStore
    .getState()
    .notify(
      `${FROM_LABELS[from]} results saved to the comprehension heatmap (${units} ${units === 1 ? "item" : "items"}).`,
    );
  return units;
}

/**
 * Take study results from a page's frame. Only while the frame has focus (the learner is
 * using it), and the same results twice in a row count once.
 */
export function useStudyResults(frame: RefObject<HTMLIFrameElement | null>, page: string | null) {
  useEffect(() => {
    if (!page) return;
    let last = "";
    const onMessage = (e: MessageEvent) => {
      const f = frame.current;
      if (!f || e.source !== f.contentWindow || document.activeElement !== f) return;
      const msg = parseStudyMessage(e.data);
      if (!msg) return;
      const sig = JSON.stringify(msg);
      if (sig === last) return;
      last = sig;
      void backend
        .readFile(page)
        .then(
          (file) => studySourcesOf(file.content),
          () => null,
        )
        .then((sources) => recordStudy(msg, sources))
        .catch((err: unknown) =>
          useAppStore
            .getState()
            .notify(
              `Couldn't save study results: ${err instanceof Error ? err.message : String(err)}`,
            ),
        );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [frame, page]);
}
