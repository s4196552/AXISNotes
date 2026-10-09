import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import {
  applyAppearance,
  applyTranslucency,
  BUILTIN_THEMES,
  effectiveMode,
  onThemeChange,
  THEME_INFO,
} from "../../app/appearance";
import { Settings } from "./Settings";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axisnotes/themes/Nord.css": ":root { --bg: #2e3440; }",
    ".axisnotes/themes/retro.css": ":root { --bg: #123456; }",
  });
  await h.b.openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  delete document.documentElement.dataset.theme;
});

describe("built-in themes", () => {
  it("set data-theme for every built-in except Match system; a user theme loads its CSS", async () => {
    for (const name of ["darker", "minimal", "glass", "translucent", "contrast", "retro"]) {
      await applyAppearance({ theme: `axis:${name}`, snippets: [] });
      expect(document.documentElement.dataset.theme).toBe(name);
    }
    await applyAppearance({ theme: "dark", snippets: [] });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await applyAppearance({ theme: "system", snippets: [] });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await applyAppearance({ theme: "Nord", snippets: [] });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.getElementById("axis-user-theme")?.textContent).toContain("#2e3440");
  });

  it("never take over a user theme that has the same name (saved before they existed)", async () => {
    await applyAppearance({ theme: "retro", snippets: [] });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.getElementById("axis-user-theme")?.textContent).toContain("#123456");
    await applyAppearance({ theme: "axis:retro", snippets: [] });
    expect(document.documentElement.dataset.theme).toBe("retro");
    expect(document.getElementById("axis-user-theme")?.textContent).toBe("");
  });

  it("keep Glass's blur off panes and dialogs, so their fixed menus aren't moved or clipped", () => {
    // `backdrop-filter` makes an element the containing block of fixed-position children.
    const css = readFileSync("src/styles/themes.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      // Nor a stacking context per pane, which would let the next pane cover a menu.
      if (/\.(sidebar|content|modal)(?!-)/.test(rule[1]!))
        expect(rule[2]).not.toMatch(/isolation:/);
      if (!/backdrop-filter:\s*var\(--glass-blur\)/.test(rule[2]!)) continue;
      for (const sel of rule[1]!.split(/,(?![^(]*\))/)) {
        if (/\.(sidebar|content|modal)(?!-)/.test(sel)) expect(sel.trim()).toMatch(/::before$/);
      }
    }
  });

  it("know whether they're light or dark (toggle theme, canvas, diagrams)", () => {
    expect(effectiveMode("axis:darker")).toBe("dark");
    expect(effectiveMode("axis:contrast")).toBe("dark");
    expect(effectiveMode("axis:minimal")).toBe("light");
    expect(effectiveMode("axis:retro")).toBe("light");
    // Glass and Translucent follow the OS, like Match system (jsdom reports light).
    expect(effectiveMode("axis:glass")).toBe(effectiveMode("system"));
    expect(effectiveMode("axis:translucent")).toBe(effectiveMode("system"));
  });

  it("tell listeners when the theme changes, until they unsubscribe", async () => {
    const listener = vi.fn();
    const stop = onThemeChange(listener);
    await applyAppearance({ theme: "axis:retro", snippets: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    await applyAppearance({ theme: "axis:glass", snippets: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("each define the full set of color tokens, for the app and for preview tiles", () => {
    const css = readFileSync("src/styles/themes.css", "utf8");
    const tokens = ["--bg", "--bg-sidebar", "--bg-elevated", "--bg-hover", "--bg-active", "--fg"];
    const more = ["--fg-muted", "--border", "--accent", "--accent-fg", "--danger", "--code-bg"];
    for (const theme of ["darker", "minimal", "glass", "translucent", "contrast", "retro"]) {
      const block = new RegExp(
        String.raw`:root\[data-theme="${theme}"\],\s*\[data-theme-preview="${theme}"\]\s*\{([^}]*)\}`,
      ).exec(css)?.[1];
      expect(block, theme).toBeDefined();
      for (const t of [...tokens, ...more, "--selection"])
        expect(block, `${theme} ${t}`).toContain(`${t}:`);
    }
  });
});

describe("Translucent", () => {
  const alpha = () => document.documentElement.style.getPropertyValue("--tl-alpha");
  const look = { windowOpacity: 80, windowBlur: true };

  it("makes the window as see-through as asked, and blurs the desktop only when wanted", async () => {
    h.b.canBeTranslucent = () => true;
    const blur = vi.spyOn(h.b, "setWindowBlur");
    await applyTranslucency("axis:translucent", look);
    expect(alpha()).toBe("0.8");
    expect(blur).toHaveBeenLastCalledWith(true);
    // Out-of-range opacity is clamped; a solid window needs no blur.
    await applyTranslucency("axis:translucent", { ...look, windowOpacity: 5 });
    expect(alpha()).toBe("0.2");
    await applyTranslucency("axis:translucent", { ...look, windowOpacity: 100 });
    expect(blur).toHaveBeenLastCalledWith(false);
    await applyTranslucency("axis:translucent", { windowOpacity: 60, windowBlur: false });
    expect(alpha()).toBe("0.6");
    expect(blur).toHaveBeenLastCalledWith(false);
    // Unchanged blur isn't sent to the window again (a slider sends many changes).
    const calls = blur.mock.calls.length;
    await applyTranslucency("axis:translucent", { windowOpacity: 55, windowBlur: false });
    expect(blur).toHaveBeenCalledTimes(calls);
    // Any other theme: solid, no blur.
    await applyTranslucency("axis:translucent", look);
    await applyTranslucency("axis:glass", look);
    expect(alpha()).toBe("1");
    expect(blur).toHaveBeenLastCalledWith(false);
  });

  it("skips the blur while Windows' transparency effects are off (it'd be solid grey)", async () => {
    h.b.canBeTranslucent = () => true;
    const blur = vi.spyOn(h.b, "setWindowBlur");
    const reduce = (on: boolean) =>
      vi.stubGlobal("matchMedia", (q: string) => ({
        matches: on && q.includes("reduced-transparency: reduce"),
        addEventListener() {},
        removeEventListener() {},
      }));
    try {
      reduce(false);
      await applyTranslucency("axis:translucent", look);
      expect(blur).toHaveBeenLastCalledWith(true);
      reduce(true);
      await applyTranslucency("axis:translucent", look);
      expect(alpha()).toBe("0.8"); // still see-through, just not blurred
      expect(blur).toHaveBeenLastCalledWith(false);
      render(<Settings section="appearance" onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("radio", { name: "Translucent" }));
      expect(
        await screen.findByRole("checkbox", { name: "Blur behind the window" }),
      ).toBeDisabled();
      expect(screen.getByText(/transparency effects/)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("stays solid where the window can't be see-through", async () => {
    h.b.canBeTranslucent = () => false;
    await applyTranslucency("axis:translucent", look);
    expect(alpha()).toBe("1");
  });

  it("only its backdrop carries the opacity, and the page behind is cleared", () => {
    const css = readFileSync("src/styles/themes.css", "utf8");
    const block =
      /:root\[data-theme="translucent"\],\s*\[data-theme-preview="translucent"\]\s*\{([^}]*)\}/.exec(
        css,
      )![1]!;
    expect(block).toMatch(/--app-backdrop: rgba\([^)]*var\(--tl-alpha/);
    expect(block.match(/--tl-alpha/g)).toHaveLength(1);
    expect(css).toMatch(/:root\[data-theme="translucent"\] \{\s*background: transparent;/);
  });

  it("gets its solid start-up page from a stylesheet, never inline in index.html", () => {
    // Tauri hashes inline <style>/<script> into the CSP, which switches off 'unsafe-inline'
    // and blocks CodeMirror's injected styles (trailing spaces then vanish as you type).
    expect(readFileSync("index.html", "utf8")).not.toMatch(/<style|<script(?![^>]*\bsrc=)/);
    expect(readFileSync("src/styles/app.css", "utf8")).toMatch(/^html \{\s*background: #/m);
  });

  it("has opacity and blur settings, shown only while it's the theme", async () => {
    h.b.canBeTranslucent = () => true;
    render(<Settings section="appearance" onClose={vi.fn()} />);
    expect(screen.queryByRole("slider", { name: "Window opacity" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Translucent" }));
    const slider = await screen.findByRole("slider", { name: "Window opacity" });
    expect(slider).toHaveValue("80");
    fireEvent.change(slider, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Blur behind the window" }));
    await waitFor(async () => {
      const saved = JSON.parse((await h.b.readFile(".axisnotes/config.json")).content);
      expect(saved.theme).toBe("axis:translucent");
      expect(saved.appearance).toMatchObject({ windowOpacity: 45, windowBlur: false });
    });
    expect(screen.getByText("45%")).toBeInTheDocument();
  });

  it("explains, and disables its settings, where it can't be see-through", async () => {
    h.b.canBeTranslucent = () => false;
    useConfig.setState({
      config: { ...structuredClone(DEFAULT_CONFIG), theme: "axis:translucent" },
    });
    render(<Settings section="appearance" onClose={vi.fn()} />);
    expect(screen.getByRole("slider", { name: "Window opacity" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Blur behind the window" })).toBeDisabled();
    expect(screen.getByText(/need Windows/)).toBeInTheDocument();
  });
});

describe("Settings → Appearance → Theme", () => {
  it("shows every theme as a tile with a preview, then user themes, and saves the choice", async () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "Theme" });
    for (const t of BUILTIN_THEMES) {
      const radio = within(group).getByRole("radio", { name: THEME_INFO[t].label });
      expect(radio).toHaveAccessibleDescription(THEME_INFO[t].note);
    }
    expect(within(group).getByRole("radio", { name: "Match system" })).toBeChecked();
    // Each built-in tile previews itself with its own tokens.
    expect(group.querySelector('[data-theme-preview="retro"]')).not.toBeNull();
    expect(
      group.querySelectorAll('[data-theme-preview="light"], [data-theme-preview="dark"]'),
    ).toHaveLength(4); // Light, Dark, and both halves of Match system

    fireEvent.click(await within(group).findByRole("radio", { name: "Nord" }));
    fireEvent.click(within(group).getByRole("radio", { name: "Glass" }));
    await waitFor(async () =>
      expect(JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).theme).toBe(
        "axis:glass",
      ),
    );
    expect(within(group).getByRole("radio", { name: "Glass" })).toBeChecked();
  });
});
