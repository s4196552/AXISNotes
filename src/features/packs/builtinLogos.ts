import original from "../../assets/logo.svg";
import risograph from "../../assets/logos/risograph.png";
import neon from "../../assets/logos/neon.png";

/** Stable references to bundled assets, independent of a device's vault path. */
export const BUILTIN_LOGOS = [
  { path: "builtin:axis-original.svg", title: "AXIS Original", url: original },
  { path: "builtin:axis-risograph.png", title: "AXIS Risograph", url: risograph },
  { path: "builtin:axis-neon.png", title: "AXIS Neon", url: neon },
];

export const builtinLogoUrl = (path: string): string | undefined =>
  BUILTIN_LOGOS.find((logo) => logo.path === path)?.url;

/** User images stay inside the vault; arbitrary URLs are never loaded from config. */
export const isLogoPath = (path: string) =>
  Boolean(path) &&
  !/[:\\?#]/.test(path) &&
  !path.startsWith("/") &&
  path.split("/").every((part) => part && part !== "." && part !== "..") &&
  /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(path);
