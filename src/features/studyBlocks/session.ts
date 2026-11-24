import { useCallback, useState } from "react";
import { useAppStore } from "../../app/store";
import { sectionsOf } from "../comprehension/model";
import { recordStudy } from "../comprehension/studyResults";
import type { StudyCardHost } from "./studyBlocks";

// Progress stays while the note is open, even when the card scrolls out of view (and
// CodeMirror drops it) or the block is edited elsewhere. It is never saved.
const sessions = new Map<string, unknown>();
const MAX_SESSIONS = 60;

export function useSession<T>(host: StudyCardHost, initial: () => T): [T, (next: T) => void] {
  const key = `${host.kind}\n${host.path}\n${host.body}`;
  const [value, setValue] = useState<T>(() =>
    sessions.has(key) ? (sessions.get(key) as T) : initial(),
  );
  const set = useCallback(
    (next: T) => {
      sessions.delete(key);
      sessions.set(key, next);
      if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value!);
      setValue(next);
    },
    [key],
  );
  return [value, set];
}

/** Forget every card's progress (tests). */
export const clearSessions = () => sessions.clear();

/** The heatmap unit a block belongs to: its note, and the section heading it's under. */
export function sourceOf(host: StudyCardHost): string {
  const where = host.where();
  if (!where) return host.path;
  const above = sectionsOf(where.text).filter((h) => h.line < where.line);
  const heading = above.at(-1)?.text;
  return heading ? `${host.path}#${heading}` : host.path;
}

/** Send one finished round to the comprehension heatmap (one item per card or question). */
export function report(host: StudyCardHost, kind: "test" | "flashcards", correct: boolean[]) {
  if (!correct.length || !host.path) return;
  const source = sourceOf(host);
  void recordStudy({ kind, items: correct.map((c) => ({ source, correct: c })) }, [
    host.path,
  ]).catch((err: unknown) =>
    useAppStore
      .getState()
      .notify(`Couldn't save study results: ${err instanceof Error ? err.message : String(err)}`),
  );
}
