import { createElement } from "react";
import type { FolderIcon } from "../../app/config";
import { lucideFor } from "./iconSet";

/** Render a custom folder/note icon: a Lucide icon or an emoji, optionally colored. */
export function EntryIcon({ icon, size = 15 }: { icon: FolderIcon; size?: number }) {
  const lucide = lucideFor(icon.icon);
  if (lucide) {
    // Looked up from the static icon table, not created during render.
    return createElement(lucide, {
      size,
      className: "filetree-icon custom-icon",
      style: icon.color ? { color: icon.color } : undefined,
      "aria-hidden": true,
    });
  }
  return (
    <span
      className="filetree-icon custom-icon emoji-icon"
      style={{ fontSize: size - 1, ...(icon.color ? { color: icon.color } : {}) }}
      aria-hidden
    >
      {icon.icon}
    </span>
  );
}
