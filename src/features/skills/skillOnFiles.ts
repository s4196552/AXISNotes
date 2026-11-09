import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { isNotePath, noteName } from "../../lib/markdown";
import { MAX_FOLDER_NOTES, ruleForPath } from "../ai/folderScope";
import { queueAiBlock } from "../ai/aiBlock";
import { folderOf } from "../drafts/drafts";
import type { Skill } from "./skills";
import { keepSkillFile } from "./skillRun";

// Running a skill on files and folders picked in the file tree (for example a practice
// test from twelve weeks of notes). The run happens in an AI block in a new note saved in
// the picked items' folder (with the AI icon); the block reads the picked notes.

export interface PickedNotes {
  /** Notes to read, in path order. */
  include: string[];
  /** Notes left out because they're marked "AI: never". */
  never: string[];
  /** Notes left out over `MAX_FOLDER_NOTES`. */
  overLimit: number;
}

/** The notes in the picked paths: picked notes, and every note inside picked folders. */
export function pickedNotes(paths: string[]): PickedNotes {
  const notes = useAppStore.getState().notes.map((n) => n.path);
  const rules = useConfig.getState().config.ai.folders;
  const found = new Set<string>();
  for (const p of paths) {
    if (isNotePath(p)) {
      if (notes.includes(p)) found.add(p);
      continue;
    }
    const dir = p.replace(/^\/+|\/+$/g, "");
    for (const n of notes) if (!dir || n.startsWith(`${dir}/`)) found.add(n);
  }
  const sorted = [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const never = sorted.filter((p) => ruleForPath(rules, p) === "never");
  const allowed = sorted.filter((p) => ruleForPath(rules, p) !== "never");
  return {
    include: allowed.slice(0, MAX_FOLDER_NOTES),
    never,
    overLimit: Math.max(0, allowed.length - MAX_FOLDER_NOTES),
  };
}

/** The deepest folder holding every picked item (a picked folder counts as its own). */
export function commonFolder(paths: string[]): string {
  const dirs = paths.map((p) => (isNotePath(p) || /\.[a-z0-9]+$/i.test(p) ? folderOf(p) : p));
  if (!dirs.length) return "";
  let common = dirs[0]!.split("/").filter(Boolean);
  for (const d of dirs.slice(1)) {
    const parts = d.split("/").filter(Boolean);
    let i = 0;
    while (i < common.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
  }
  return common.join("/");
}

/** The skills offered for picked items: Teach me needs one folder as its workspace. */
export const skillsForPicked = (skills: Skill[], paths: string[]) =>
  skills.filter((s) => s.reads !== "folder" || (paths.length === 1 && !isNotePath(paths[0]!)));

/**
 * Run `skill` on the picked items: make a note in their folder and open it with an AI
 * block that reads the picked notes. Returns the note's path, or null if there was
 * nothing the AI may read (the reason is shown as a notice).
 */
export async function runSkillOnPicked(skill: Skill, paths: string[]): Promise<string | null> {
  const { include, never, overLimit } = pickedNotes(paths);
  const notice = (message: string) => useAppStore.getState().notify(message);
  if (!include.length) {
    notice(
      never.length
        ? `The picked notes are all marked "AI: never", so ${skill.title} can't read them.`
        : `There are no notes in what you picked for ${skill.title} to read.`,
    );
    return null;
  }
  const folder = commonFolder(paths);
  const label =
    paths.length === 1 && !isNotePath(paths[0]!)
      ? paths[0]!.slice(paths[0]!.lastIndexOf("/") + 1) || "vault"
      : `${include.length} ${include.length === 1 ? "note" : "notes"}`;
  const left = [
    never.length ? `${never.length} marked "AI: never" left out.` : "",
    overLimit ? `${overLimit} more left out (at most ${MAX_FOLDER_NOTES} notes).` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const content = [
    `# ${skill.title}: ${label}`,
    "",
    `Made from ${include.map((p) => `[[${noteName(p)}]]`).join(", ")}.${left ? ` ${left}` : ""}`,
    "",
    "",
  ].join("\n");
  // Saved straight into the folder (with the AI icon), not as a draft to keep.
  const note = await keepSkillFile(folder, `${skill.title} - ${label}`, content, ".md");
  queueAiBlock(note, { pos: content.length, skill: skill.id, sources: include });
  useAppStore.getState().openFile(note);
  return note;
}
