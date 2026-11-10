import logoUrl from "../assets/logo.svg";
import { useState } from "react";
import { backend } from "../ipc";
import { useConfig } from "./config";
import { builtinLogoUrl, isLogoPath } from "../features/packs/builtinLogos";

/** The AXISNotes logo. `src/assets/logo.svg` is the master; the app icons are generated from it
 * with `pnpm tauri icon src/assets/logo.svg`. `decorative` hides it from screen readers where
 * text next to it already says what it is. */
export function Logo({
  size = 32,
  className,
  decorative = false,
}: {
  size?: number;
  className?: string;
  decorative?: boolean;
}) {
  const selected = useConfig((s) => s.config.appearance.logo);
  const url = builtinLogoUrl(selected) ?? (isLogoPath(selected) ? backend.fileUrl(selected) : null);
  const [failed, setFailed] = useState<string | null>(null);
  const source = url && url !== failed ? url : logoUrl;
  return (
    <img
      src={source}
      onError={() => url && setFailed(url)}
      style={{ objectFit: "contain" }}
      width={size}
      height={size}
      alt={decorative ? "" : "AXISNotes"}
      className={className ? `app-logo ${className}` : "app-logo"}
    />
  );
}
