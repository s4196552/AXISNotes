import { describe, expect, it } from "vitest";
import { type AxisConfig, DEFAULT_CONFIG, mergeConfig } from "./config";
import { BUILTIN_THEMES, HEADING_COLORS } from "./appearance";
import { APP_COLOR_PRESETS } from "./appColors";
import {
  activeStyle,
  applyStyle,
  BUILTIN_STYLES,
  captureStyle,
  sanitizeStyle,
  sanitizeStyles,
  STYLE_KEYS,
} from "./styles";

// T-277: Styles set the whole look (theme, fonts, typography and colors) in one click.

const base = (): AxisConfig => structuredClone(DEFAULT_CONFIG);
const byId = (id: string) => BUILTIN_STYLES.find((s) => s.id === id)!;

describe("Styles", () => {
  it("apply their theme and look and change nothing else", () => {
    const before: AxisConfig = {
      ...base(),
      favorites: ["Bio/Cells.md"],
      hotkeys: { "app:settings": "Ctrl+," },
      appearance: { ...base().appearance, boxy: true, editorWidth: "wide", noteFont: "Arial" },
    };
    const after = applyStyle(before, byId("paper"));
    expect(after.theme).toBe("light");
    expect(after.appearance).toMatchObject({
      noteFont: "Georgia",
      // Left out by the Style: back to the default, so a Style always looks the same.
      uiFont: "",
      noteFontSize: 16,
      lineHeight: 1.7,
      headingColors: "amber",
      appColors: APP_COLOR_PRESETS.find((p) => p.id === "cream")!.colors,
      // Not part of a Style.
      boxy: true,
      editorWidth: "wide",
    });
    expect(after.favorites).toEqual(before.favorites);
    expect(after.hotkeys).toEqual(before.hotkeys);
    expect(after.sidebars).toEqual(before.sidebars);
  });

  it("can save the current look and give exactly it back", () => {
    const mine = applyStyle(base(), byId("midnight"));
    mine.appearance.textColors = {
      ...mine.appearance.textColors,
      main: { on: true, light: "#112233", dark: "#ddeeff" },
    };
    mine.appearance.letterSpacing = 0.03;
    const saved = captureStyle(mine, "  Mine  ");
    expect(saved.name).toBe("Mine");
    expect(Object.keys(saved.look).sort()).toEqual([...STYLE_KEYS].sort());
    const restored = applyStyle(applyStyle(base(), byId("paper")), saved);
    for (const k of STYLE_KEYS) expect(restored.appearance[k]).toEqual(mine.appearance[k]);
    expect(restored.theme).toBe("dark");
    // The saved copy doesn't change when the settings do.
    mine.appearance.textColors.main.light = "#000000";
    expect(saved.look.textColors!.main.light).toBe("#112233");
  });

  it("know which Style is in use", () => {
    expect(activeStyle(base(), BUILTIN_STYLES)).toBe(byId("default"));
    const paper = applyStyle(base(), byId("paper"));
    expect(activeStyle(paper, BUILTIN_STYLES)).toBe(byId("paper"));
    // Colors match whatever their case; any change means no Style is in use.
    paper.appearance.appColors = {
      ...paper.appearance.appColors,
      mainBg: paper.appearance.appColors.mainBg.toUpperCase(),
    };
    expect(activeStyle(paper, BUILTIN_STYLES)).toBe(byId("paper"));
    paper.appearance.lineHeight = 1.75;
    expect(activeStyle(paper, BUILTIN_STYLES)).toBeUndefined();
    const other = applyStyle(base(), byId("paper"));
    other.theme = "dark";
    expect(activeStyle(other, BUILTIN_STYLES)).toBeUndefined();
  });

  it("built-in Styles use the app's own themes, color presets and heading colors", () => {
    expect(new Set(BUILTIN_STYLES.map((s) => s.id)).size).toBe(BUILTIN_STYLES.length);
    expect(new Set(BUILTIN_STYLES.map((s) => s.name)).size).toBe(BUILTIN_STYLES.length);
    for (const s of BUILTIN_STYLES) {
      expect(BUILTIN_THEMES as readonly string[]).toContain(s.theme);
      if (s.look.headingColors) expect(HEADING_COLORS).toHaveProperty(s.look.headingColors);
      if (s.look.appColors)
        expect(APP_COLOR_PRESETS.map((p) => p.colors)).toContainEqual(s.look.appColors);
      // A built-in is already clean.
      expect(sanitizeStyle(s)).toEqual({ name: s.name, theme: s.theme, look: s.look });
    }
  });

  it("clean up hand-edited saved Styles", () => {
    expect(sanitizeStyle(null)).toBeNull();
    expect(sanitizeStyle({ name: " ", theme: "dark" })).toBeNull();
    expect(sanitizeStyle({ name: "x" })).toBeNull();
    expect(
      sanitizeStyle({
        name: " Odd ",
        theme: "axis:retro",
        look: {
          noteFont: "Georgia",
          uiFont: 3,
          noteFontSize: 99,
          letterSpacing: -1,
          lineHeight: "tall",
          headingColors: "neon",
          textColors: { main: { on: true, light: "red;}body{x:y", dark: "#abc" }, bold: "x" },
          appColors: { mainBg: "#123456", mainFg: "url(x)" },
          boxy: true,
        },
      }),
    ).toEqual({
      name: "Odd",
      theme: "light",
      look: {
        noteFont: "Georgia",
        noteFontSize: 32,
        letterSpacing: -0.05,
        headingColors: "theme",
        textColors: {
          main: { on: true, light: "", dark: "#abc" },
          bold: { on: false, light: "", dark: "" },
          italic: { on: false, light: "", dark: "" },
          strike: { on: false, light: "", dark: "" },
          math: { on: false, light: "", dark: "" },
        },
        appColors: { sidebarBg: "", sidebarFg: "", mainBg: "#123456", mainFg: "" },
      },
    });
    expect(
      sanitizeStyles([
        { name: "A", theme: "light" },
        { name: "a", theme: "dark" },
        "junk",
        { name: "B", theme: "dark" },
      ]).map((s) => s.name),
    ).toEqual(["A", "B"]);
    expect(sanitizeStyles("nope")).toEqual([]);
  });

  it("are kept in the vault config and cleaned when it loads", () => {
    expect(DEFAULT_CONFIG.styles).toEqual([]);
    expect(mergeConfig({}).styles).toEqual([]);
    expect(
      mergeConfig({ styles: [{ name: "Mine", theme: "dark", look: {} }, { theme: "x" }] }).styles,
    ).toEqual([{ name: "Mine", theme: "dark", look: {} }]);
  });
});
