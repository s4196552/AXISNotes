import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, NO_APP_COLORS, useConfig } from "../../app/config";
import {
  APP_COLOR_PRESETS,
  appColorsCss,
  applyAppColors,
  autoText,
  contrast,
  MIN_CONTRAST,
  MUTED_CONTRAST,
  mutedText,
  normalHex,
} from "../../app/appColors";
import { Settings } from "./Settings";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  document.getElementById("axis-app-colors")?.remove();
});

/** The declarations of the rule for `selector` in `css`. */
function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) return {};
  const body = css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
  return Object.fromEntries(
    body
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => [d.slice(0, d.indexOf(":")).trim(), d.slice(d.indexOf(":") + 1).trim()]),
  );
}
const MAIN = ":root:root .content";
const SIDE = ":root:root :is(.sidebar, .statusbar)";

describe("app colour presets", () => {
  it("are twelve, with their own names and four valid colours each", () => {
    expect(APP_COLOR_PRESETS).toHaveLength(12);
    expect(new Set(APP_COLOR_PRESETS.map((p) => p.label)).size).toBe(12);
    for (const p of APP_COLOR_PRESETS)
      for (const v of Object.values(p.colors)) expect(normalHex(v), p.label).toBe(v);
  });

  it("all have readable text: at least 4.5:1 on each background", () => {
    for (const { label, colors: c } of APP_COLOR_PRESETS) {
      expect(contrast(c.sidebarBg, c.sidebarFg), `${label} sidebar`).toBeGreaterThanOrEqual(
        MIN_CONTRAST,
      );
      expect(contrast(c.mainBg, c.mainFg), `${label} main`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
  });

  it("keep the sampled backgrounds of the first and last", () => {
    expect(APP_COLOR_PRESETS[0]!.colors).toMatchObject({ sidebarBg: "#00212b", mainBg: "#002b36" });
    expect(APP_COLOR_PRESETS[11]!.colors).toMatchObject({
      sidebarBg: "#001c40",
      mainBg: "#002451",
    });
  });
});

describe("app colour styles", () => {
  it("change nothing while no colour is set", () => {
    expect(appColorsCss("light", NO_APP_COLORS)).toBe("");
    applyAppColors("light", NO_APP_COLORS);
    expect(document.getElementById("axis-app-colors")).toBeNull();
  });

  it("colour each surface, with its text, borders and hovers from its own two colours", () => {
    const css = appColorsCss("light", APP_COLOR_PRESETS[1]!.colors); // Paper: light
    const main = block(css, MAIN);
    expect(main).toMatchObject({
      "--bg": "#ffffff",
      "--fg": "#1f1f1f",
      background: "var(--bg)",
      color: "var(--fg)",
      "color-scheme": "light",
    });
    for (const t of ["--fg-muted", "--border", "--bg-hover", "--bg-active", "--bg-sidebar"])
      expect(main[t], t).toMatch(/^#[0-9a-f]{6}$/);
    expect(block(css, SIDE)).toMatchObject({ "--bg-sidebar": "#f3f3f3", "--fg": "#383838" });
    expect(block(css, ":root:root:root")).toEqual({ "--app-backdrop": "#f3f3f3" });

    const dark = appColorsCss("light", APP_COLOR_PRESETS[5]!.colors); // Charcoal
    expect(block(dark, MAIN)["color-scheme"]).toBe("dark");
  });

  it("fade muted text no further than 3.5:1, for every preset surface", () => {
    for (const { label, colors: c } of APP_COLOR_PRESETS) {
      for (const [bg, fg] of [
        [c.sidebarBg, c.sidebarFg],
        [c.mainBg, c.mainFg],
      ] as const) {
        const m = mutedText(fg, bg);
        expect(contrast(m, bg), `${label} ${bg}`).toBeGreaterThanOrEqual(MUTED_CONTRAST);
        expect(contrast(m, bg)).toBeLessThanOrEqual(contrast(fg, bg)); // still muted
      }
    }
    // Text already fainter than that is left as it is.
    expect(mutedText("#bbbbbb", "#ffffff")).toBe("#bbbbbb");
  });

  it("work out text for a background whose text isn't chosen", () => {
    expect(autoText("#ffffff")).toBe("#1a1a1a");
    expect(autoText("#002b36")).toBe("#f2f2f2");
    const css = appColorsCss("dark", { ...NO_APP_COLORS, mainBg: "#fdf6e3" });
    expect(block(css, MAIN)).toMatchObject({ "--bg": "#fdf6e3", "--fg": "#1a1a1a" });
    // The sidebars keep the theme's.
    expect(block(css, SIDE)).toEqual({});
  });

  it("headings follow each surface's text, unless a heading colour preset is chosen", () => {
    const colors = APP_COLOR_PRESETS[2]!.colors;
    const css = appColorsCss("dark", colors);
    for (const sel of [MAIN, SIDE])
      for (let n = 1; n <= 6; n++) expect(block(css, sel)[`--heading-${n}`]).toBe("var(--heading)");
    expect(block(appColorsCss("dark", colors, "rainbow"), MAIN)["--heading-1"]).toBeUndefined();
  });

  it("text alone keeps the theme's background", () => {
    const css = appColorsCss("dark", { ...NO_APP_COLORS, sidebarFg: "#ffcc00" });
    expect(block(css, SIDE)).toMatchObject({ "--fg": "#ffcc00", color: "var(--fg)" });
    expect(block(css, SIDE)["--bg-sidebar"]).toBeUndefined();
    expect(css).not.toContain(":root:root:root");
  });

  it("ignore anything that isn't a colour, and stay off for Translucent", () => {
    expect(appColorsCss("light", { ...NO_APP_COLORS, mainBg: "red; } body { x" })).toBe("");
    expect(appColorsCss("axis:translucent", APP_COLOR_PRESETS[0]!.colors)).toBe("");
  });

  it("go last in <head>, so they follow the theme, and come off with the colours", () => {
    const later = document.createElement("style");
    applyAppColors("light", APP_COLOR_PRESETS[0]!.colors);
    document.head.appendChild(later);
    applyAppColors("light", APP_COLOR_PRESETS[2]!.colors);
    const el = document.getElementById("axis-app-colors")!;
    expect(document.head.lastElementChild).toBe(el);
    expect(el.textContent).toContain("#fdf6e3");
    applyAppColors("light", NO_APP_COLORS);
    expect(document.getElementById("axis-app-colors")).toBeNull();
    later.remove();
  });
});

describe("Settings → Appearance → App colours", () => {
  const saved = async () =>
    JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).appearance.appColors;

  it("a preset sets all four colours; each can be edited; the reset clears them", async () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    const presets = screen.getByRole("radiogroup", { name: "App colour presets" });
    expect(within(presets).getAllByRole("radio")).toHaveLength(12);
    expect(screen.getByRole("button", { name: "Use theme colours" })).toBeDisabled();

    fireEvent.click(within(presets).getByRole("radio", { name: "Cream" }));
    await waitFor(async () => expect(await saved()).toEqual(APP_COLOR_PRESETS[2]!.colors));
    expect(within(presets).getByRole("radio", { name: "Cream" })).toBeChecked();
    expect(screen.getByLabelText("Main text")).toHaveValue("#586e75");

    fireEvent.input(screen.getByLabelText("Main text"), { target: { value: "#000000" } });
    await waitFor(async () => expect((await saved()).mainFg).toBe("#000000"));
    // No longer exactly a preset.
    expect(within(presets).getByRole("radio", { name: "Cream" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Reset main text" }));
    await waitFor(async () => expect((await saved()).mainFg).toBe(""));
    expect([...document.querySelectorAll(".app-color-value")].map((e) => e.textContent)).toEqual([
      "#eee8d5",
      "#52676e",
      "#fdf6e3",
      "Auto",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Use theme colours" }));
    await waitFor(async () => expect(await saved()).toEqual(NO_APP_COLORS));
    const values = [...document.querySelectorAll(".app-color-value")].map((e) => e.textContent);
    expect(values).toEqual(["Theme", "Theme", "Theme", "Theme"]);
  });

  it("warns, without blocking, when chosen text is below 4.5:1", async () => {
    useConfig.setState({
      config: {
        ...structuredClone(DEFAULT_CONFIG),
        appearance: {
          ...DEFAULT_CONFIG.appearance,
          appColors: { ...NO_APP_COLORS, mainBg: "#ffffff", mainFg: "#bbbbbb" },
        },
      },
    });
    render(<Settings section="appearance" onClose={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent(/Main text is low contrast \(1\.9:1\)/);
    fireEvent.input(screen.getByLabelText("Main text"), { target: { value: "#333333" } });
    await waitFor(() => expect(screen.queryByText(/low contrast/)).toBeNull());
  });

  it("a vault without the setting loads with no colours, and bad values are ignored", async () => {
    await h.b.writeFile(
      ".axisnotes/config.json",
      JSON.stringify({ appearance: { appColors: { mainBg: 5, sidebarBg: "#123456" } } }),
    );
    await useConfig.getState().load();
    expect(useConfig.getState().config.appearance.appColors).toEqual({
      ...NO_APP_COLORS,
      sidebarBg: "#123456",
    });
  });
});
