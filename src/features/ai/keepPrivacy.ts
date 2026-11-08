import type { AiRule } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { markText, noteMark, stricter } from "../../lib/aiAccess";
import { editNote } from "../files/editNote";
import { ruleForPath } from "./folderScope";

// AI output keeps the privacy of what it was made from. A new file gets the answer's rule
// as its own mark (`markText`); text added to an existing note raises that note's mark
// when the note's own rule is looser. The Rust layer reads the mark on every request.

const LABEL: Record<AiRule, string> = {
  any: "any AI",
  local: "local models only",
  never: "never",
};

/** The rule a note is held to now: its folder's or its own mark, whichever is stricter. */
export function effectiveRule(path: string, text: string): AiRule {
  const folders = useConfig.getState().config.ai.folders;
  return stricter(ruleForPath(folders, path), noteMark(path, text) ?? "any");
}

/**
 * After adding an answer with rule `rule` to the note at `path`: if the note is held to a
 * looser rule, mark it. Returns whether it was marked.
 */
export async function raiseNoteRule(path: string, rule: AiRule): Promise<boolean> {
  if (rule === "any") return false;
  let raised = false;
  await editNote(path, (text) => {
    const now = effectiveRule(path, text);
    // Already at least as strict: nothing to do.
    if (stricter(now, rule) === now) return null;
    raised = true;
    return markText(path, text, rule);
  });
  if (raised)
    useAppStore
      .getState()
      .notify(
        `This note now has “ai-access: ${rule}” (AI: ${LABEL[rule]}) because it contains AI output from notes with that rule. Remove the property to undo.`,
      );
  return raised;
}
