import { BookOpen, FileText, Gem, NotebookPen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ImportKind } from "../../ipc";

// The apps notes can be imported from, and how the import dialog describes them.

/** How the user picks an export: a folder, or a file with these extensions. */
export type Pick =
  { label: string; folder: true } | { label: string; folder?: false; ext: string[] };

export interface Source {
  kind: ImportKind;
  name: string;
  icon: LucideIcon;
  /** One sentence on how to get the export out of the app. */
  how: string;
  picks: Pick[];
}

export const SOURCES: Source[] = [
  {
    kind: "notion",
    name: "Notion",
    icon: BookOpen,
    how: "In Notion, choose ••• → Export on a page (or Settings → Export all workspace content), pick “Markdown & CSV” with subpages, and choose the downloaded .zip.",
    picks: [
      { label: "Choose .zip…", ext: ["zip"] },
      { label: "Unzipped folder…", folder: true },
    ],
  },
  {
    kind: "obsidian",
    name: "Obsidian",
    icon: Gem,
    how: "Choose your vault folder: notes, attachments, canvases and its template and daily-note settings come across, and links and embeds keep working.",
    picks: [{ label: "Choose vault folder…", folder: true }],
  },
  {
    kind: "evernote",
    name: "Evernote",
    icon: NotebookPen,
    how: "In Evernote, right-click a notebook → Export notebook… as ENEX, then choose the .enex file (or a folder of them, one notebook each).",
    picks: [
      { label: "Choose .enex…", ext: ["enex"] },
      { label: "Folder of .enex…", folder: true },
    ],
  },
  {
    kind: "markdown",
    name: "Markdown or HTML",
    icon: FileText,
    how: "A folder or .zip of .md, .txt or .html files, as Bear, Logseq, Roam, Typora, Joplin, Simplenote and most other apps export them.",
    picks: [
      { label: "Choose folder…", folder: true },
      { label: "Choose .zip…", ext: ["zip"] },
    ],
  },
];

export const sourceOf = (kind: ImportKind) => SOURCES.find((s) => s.kind === kind)!;
export const articleFor = (kind: ImportKind) =>
  kind === "obsidian" || kind === "evernote" ? "an" : "a";

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "3 notes, 1 attachment and 2 databases" (counts of zero left out, except notes). */
export function countsText(c: {
  notes: number;
  attachments: number;
  tables: number;
  canvases: number;
}): string {
  const parts = [
    plural(c.notes, "note"),
    c.attachments ? plural(c.attachments, "attachment") : "",
    c.tables ? plural(c.tables, "database") : "",
    c.canvases ? plural(c.canvases, "canvas", "canvases") : "",
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]!;
}
