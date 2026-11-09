import {
  Brain,
  ChartPie,
  ClipboardCheck,
  GraduationCap,
  Handshake,
  Layers,
  Lightbulb,
  type LucideIcon,
  MessagesSquare,
  Network,
  Presentation,
  Repeat2,
  WandSparkles,
} from "lucide-react";

export { skillList } from "./skills";

const ICONS: Record<string, LucideIcon> = {
  mindmap: Network,
  test: ClipboardCheck,
  flashcards: Layers,
  mnemonic: Brain,
  "make-it-stick": Repeat2,
  example: Lightbulb,
  "slide-deck": Presentation,
  infographic: ChartPie,
  "grill-me": MessagesSquare,
  handoff: Handshake,
  teach: GraduationCap,
};

/** The icon for a skill in the command menu (a wand for the user's own skills). */
export const skillIcon = (id: string): LucideIcon => ICONS[id] ?? WandSparkles;
