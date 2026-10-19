import { createElement, type ReactNode, useEffect, useState } from "react";
import type { FolderIcon } from "../../app/config";
import { PackImage } from "../packs/PackParts";
import { imageIconPath, isLucide, loadAllIcons, lucideFor } from "./iconSet";

/**
 * Render a custom folder/note icon: a Lucide icon, an image from the vault or an emoji,
 * optionally colored. `fallback` shows while a non-curated Lucide icon loads, or if the
 * icon can't be shown (an unknown Lucide name, a missing image).
 */
export function EntryIcon({
  icon,
  size = 15,
  fallback = null,
}: {
  icon: FolderIcon;
  size?: number;
  fallback?: ReactNode;
}) {
  const lucide = useLucide(icon.icon);
  const image = imageIconPath(icon.icon);
  if (image !== null) {
    // A colour turns the image into a silhouette in that colour (for icon packs).
    return (
      <PackImage
        className="filetree-icon custom-icon image-icon"
        path={image}
        size={size}
        color={icon.color}
        fallback={fallback}
      />
    );
  }
  if (lucide) {
    // Looked up from the static icon tables, not created during render.
    return createElement(lucide, {
      size,
      className: "filetree-icon custom-icon",
      style: icon.color ? { color: icon.color } : undefined,
      "aria-hidden": true,
    });
  }
  if (isLucide(icon.icon)) return fallback;
  return (
    <span
      className="filetree-icon custom-icon emoji-icon"
      style={{
        fontSize: size - 1,
        ...(size > 15 ? { width: size, height: size } : {}),
        ...(icon.color ? { color: icon.color } : {}),
      }}
      aria-hidden
    >
      {icon.icon}
    </span>
  );
}

/** The Lucide component for `icon`, loading the full set when it isn't a curated one. */
function useLucide(icon: string) {
  const [, setLoaded] = useState(0);
  const found = lucideFor(icon);
  const missing = isLucide(icon) && !found;
  useEffect(() => {
    if (!missing) return;
    let cancelled = false;
    loadAllIcons().then(
      () => !cancelled && setLoaded((n) => n + 1),
      () => {}, // stays blank; the picker shows the load error
    );
    return () => {
      cancelled = true;
    };
  }, [missing]);
  return found;
}
