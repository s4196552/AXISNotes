import {
  ClipboardCheck,
  GraduationCap,
  Handshake,
  Layers,
  type LucideIcon,
  MessagesSquare,
  Network,
  WandSparkles,
} from "lucide-react";

export { skillList } from "./skills";

const ICONS: Record<string, LucideIcon> = {
  mindmap: Network,
  test: ClipboardCheck,
  flashcards: Layers,
  "grill-me": MessagesSquare,
  handoff: Handshake,
  teach: GraduationCap,
};

/** The icon for a skill in the command menu (a wand for the user's own skills). */
export const skillIcon = (id: string): LucideIcon => ICONS[id] ?? WandSparkles;
