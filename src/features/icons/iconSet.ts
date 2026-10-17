import {
  Archive,
  Book,
  BookOpen,
  Bookmark,
  Briefcase,
  Calculator,
  Calendar,
  Camera,
  Cloud,
  Code,
  DollarSign,
  Dumbbell,
  FileText,
  Flag,
  FlaskConical,
  Folder,
  Globe,
  GraduationCap,
  Heart,
  HeartPulse,
  Home,
  Image,
  Inbox,
  Leaf,
  Lightbulb,
  Lock,
  type LucideIcon,
  Moon,
  Music,
  Palette,
  PenTool,
  Plane,
  Rocket,
  Shield,
  ShoppingCart,
  Star,
  Sun,
  Target,
  User,
  Users,
  Utensils,
} from "lucide-react";

// A curated icon set for folders and notes (importing every Lucide icon would bloat the
// bundle). Stored in config as `lucide:<Name>`; anything else is treated as an emoji.

export const ICONS: Record<string, LucideIcon> = {
  Folder,
  Book,
  BookOpen,
  GraduationCap,
  Briefcase,
  Home,
  Heart,
  HeartPulse,
  Shield,
  Lock,
  Star,
  Lightbulb,
  Rocket,
  Target,
  Flag,
  Bookmark,
  FileText,
  Code,
  FlaskConical,
  Calculator,
  PenTool,
  Palette,
  Music,
  Camera,
  Image,
  Plane,
  Globe,
  Calendar,
  Archive,
  Inbox,
  DollarSign,
  ShoppingCart,
  Users,
  User,
  Dumbbell,
  Utensils,
  Leaf,
  Sun,
  Moon,
  Cloud,
};

export const ICON_COLORS = [
  "",
  "#e5484d",
  "#f76b15",
  "#ffc53d",
  "#30a46c",
  "#12a594",
  "#0090ff",
  "#6e56cf",
  "#d6409f",
  "#8d8d8d",
];

export const isLucide = (icon: string) => icon.startsWith("lucide:");

let allIcons: Record<string, LucideIcon> | null = null;
let loading: Promise<Record<string, LucideIcon>> | null = null;

/** The full Lucide set, loaded once on first use. A failed load can be retried. */
export function loadAllIcons(): Promise<Record<string, LucideIcon>> {
  if (allIcons) return Promise.resolve(allIcons);
  loading ??= import("./lucideAll").then(
    (m) => (allIcons = m.icons as Record<string, LucideIcon>),
    (e: unknown) => {
      loading = null;
      throw e;
    },
  );
  return loading;
}

/** The full set if it has already loaded, else null. */
export const loadedIcons = () => allIcons;

/**
 * The component for a stored `lucide:<Name>` value: a curated icon at once, any other
 * Lucide icon once the full set has loaded (see `loadAllIcons`), else null.
 */
export function lucideFor(icon: string): LucideIcon | null {
  if (!isLucide(icon)) return null;
  const name = icon.slice(7);
  return ICONS[name] ?? allIcons?.[name] ?? null;
}

/** `FlaskConical` → `flask conical`, for matching typed words against icon names. */
export const iconWords = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z]{2,})(\d)/g, "$1 $2") // Grid2x2 → Grid 2x2, keeping "2x2" whole
    .toLowerCase();

/** Whether every typed word starts a word of the icon's name (`fla con` finds FlaskConical). */
export function matchesIcon(name: string, query: string): boolean {
  const q = query
    .trim()
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (q.length === 0) return true;
  const words = iconWords(name).split(" ");
  return q.every((t) => words.some((w) => w.startsWith(t)));
}
