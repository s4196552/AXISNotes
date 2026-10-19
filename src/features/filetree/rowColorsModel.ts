import { type EntryColors, isHexColor } from "../../app/config";
import { ICON_COLORS } from "../icons/iconSet";

/** Background presets: the icon hues at 25% opacity, so text stays readable on them. */
export const ROW_BACKGROUNDS = ICON_COLORS.map((c) => (c ? `${c}40` : ""));
export const ROW_TEXT_COLORS = ICON_COLORS;

/** The row's colours from the config, ignoring anything that isn't a hex colour. */
export function rowColors(raw: EntryColors | undefined): EntryColors | undefined {
  if (!raw) return undefined;
  const out: EntryColors = {};
  if (isHexColor(raw.background)) out.background = raw.background;
  if (isHexColor(raw.text)) out.text = raw.text;
  return out.background || out.text ? out : undefined;
}

/** Inline style and classes that give a row its own colours. */
export function rowColorProps(colors: EntryColors | undefined) {
  if (!colors) return { className: "", style: {} };
  const style: Record<string, string> = {};
  const classes: string[] = [];
  if (colors.background) {
    style["--row-bg"] = colors.background;
    classes.push("has-bg");
  }
  if (colors.text) {
    style["--row-fg"] = colors.text;
    classes.push("has-fg");
  }
  return { className: classes.join(" "), style };
}
