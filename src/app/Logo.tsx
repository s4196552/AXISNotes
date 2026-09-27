import logoUrl from "../assets/logo.svg";

/** The AXIS logo. `src/assets/logo.svg` is the master; the app icons are generated from it
 * with `pnpm tauri icon src/assets/logo.svg`. */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return <img src={logoUrl} width={size} height={size} alt="AXIS" className={className} />;
}
