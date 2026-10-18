import {
  Clock,
  File,
  FileText,
  Image,
  ListChecks,
  type LucideIcon,
  Network,
  PenTool,
  Table,
} from "lucide-react";
import type { Loc, TabGroup } from "../../app/tabs";
import { docKind, hiddenExt } from "../../lib/fileKinds";

/** The title a tab shows. */
export function tabTitle(loc: Loc): string {
  if (loc.view === "graph") return "Graph view";
  if (loc.view === "tasks") return "Tasks";
  if (loc.view === "time") return "Time report";
  if (loc.path === null) return "New tab";
  const name = loc.path.slice(loc.path.lastIndexOf("/") + 1);
  const ext = hiddenExt(name);
  return ext ? name.slice(0, -ext.length) : name;
}

/** The icon for what a tab shows (a file kind or a view), or null for an empty tab. */
export function kindIcon(loc: Loc): LucideIcon | null {
  if (loc.view === "graph") return Network;
  if (loc.view === "tasks") return ListChecks;
  if (loc.view === "time") return Clock;
  if (loc.path === null) return null;
  switch (docKind(loc.path)) {
    case "grid":
      return Table;
    case "canvas":
      return PenTool;
    case "image":
      return Image;
    case "other":
      return File;
    default:
      return FileText;
  }
}

/** Id of the panel the active tab shows (the main area). */
export const TAB_PANEL_ID = "tab-panel";

/** A group's name, or its colour for an unnamed group ("Blue group"). */
export function groupLabel(group: TabGroup): string {
  return group.name || `${group.color[0]!.toUpperCase()}${group.color.slice(1)} group`;
}
