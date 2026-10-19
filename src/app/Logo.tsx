import logoUrl from "../assets/logo.svg";

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
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt={decorative ? "" : "AXISNotes"}
      className={className ? `app-logo ${className}` : "app-logo"}
    />
  );
}
