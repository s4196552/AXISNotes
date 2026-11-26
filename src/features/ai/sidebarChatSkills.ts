import { studyBlockOf } from "../skills/skillRun";
import { type Skill, skillSystem, withFormat } from "../skills/skills";
import type { SidebarFormat } from "./sidebarChatOutput";

// The skills the AI chat offers before the first message, like a chat app's suggested
// actions. A skill that answers in text runs right in the chat; one that makes a note with
// study blocks or a set of lesson files runs as it does from the file tree.

/** Shown first, in this order; the rest are under "More skills". */
export const FEATURED_SKILLS = ["summary", "ai-notes", "tutor", "flashcards", "test"] as const;

const ACTION_LABELS: Record<string, string> = {
  summary: "Summarize this note",
  "ai-notes": "Turn into study notes",
  tutor: "Tutor me on this",
  flashcards: "Make flashcards",
  test: "Make a practice test",
  mindmap: "Make a mind map",
  example: "Explain with an example",
  mnemonic: "Make a mnemonic",
  "make-it-stick": "Help me remember this",
  "grill-me": "Grill me on this",
  "teach-the-ai": "Let me teach it back",
  "slide-deck": "Make a slide deck",
  infographic: "Make an infographic",
  handoff: "Write a handoff",
  teach: "Teach me this folder",
};

/** How a skill reads in the chat: an action ("Summarize this note"), else its title. */
export const skillAction = (skill: Skill) => ACTION_LABELS[skill.id] ?? skill.title;

/** The featured skills that exist (a vault may hide or replace them). */
export function featuredSkills(skills: readonly Skill[]): Skill[] {
  const byId = new Map(skills.map((s) => [s.id, s]));
  return FEATURED_SKILLS.flatMap((id) => byId.get(id) ?? []);
}

/** A skill as it runs in the chat: its system message and answer format. */
export interface ChatSkill {
  id: string;
  title: string;
  format: SidebarFormat;
  system: string;
}

/**
 * The skill as a chat run, or null when it needs to run as a note: one that writes files
 * or reads a folder, or a Markdown note built on study blocks the chat can't show.
 */
export function chatSkill(skill: Skill, preferred: SidebarFormat): ChatSkill | null {
  if (skill.output === "files" || skill.reads === "folder") return null;
  const format: SidebarFormat =
    skill.output === "chat"
      ? "markdown"
      : skill.output === "html" || preferred === "html"
        ? "html"
        : "markdown";
  const run = withFormat(skill, format);
  if (run.output === "markdown" && studyBlockOf(run)) return null;
  return { id: skill.id, title: skill.title, format, system: skillSystem(run) };
}
