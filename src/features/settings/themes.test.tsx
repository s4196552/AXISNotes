import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  const look = { windowOpacity: 80, windowEffect: "frosted" as const };

  it("makes the window as see-through as asked, with the chosen effect behind it", async () => {
    h.b.canBeTranslucent = () => true;
    const fx = vi.spyOn(h.b, "setWindowEffect");
    await applyTranslucency("axis:translucent", look);
    expect(alpha()).toBe("0.8");
    expect(fx).toHaveBeenLastCalledWith("acrylic");
    for (const [id, os] of [
      ["blur", "blur"],
      ["mica", "mica"],
      ["micaAlt", "tabbed"],
      ["clear", null],
      ["frosted", "acrylic"],
    ] as const) {
      await applyTranslucency("axis:translucent", { ...look, windowEffect: id });
      expect(fx, id).toHaveBeenLastCalledWith(os);
    }
    // Out-of-range opacity is clamped; a solid window needs no effect.
    await applyTranslucency("axis:translucent", { ...look, windowOpacity: 5 });
    expect(alpha()).toBe("0.2");
    await applyTranslucency("axis:translucent", { ...look, windowOpacity: 100 });
    expect(fx).toHaveBeenLastCalledWith(null);
    // An unknown saved effect gets the default; an unchanged one isn't sent again.
    await applyTranslucency("axis:translucent", {
      windowOpacity: 60,
      windowEffect: "sparkly" as never,
    });
    expect(fx).toHaveBeenLastCalledWith("acrylic");
    const calls = fx.mock.calls.length;
    await applyTranslucency("axis:translucent", { ...look, windowOpacity: 55 });
    expect(fx).toHaveBeenCalledTimes(calls);
    // Any other theme: solid, no effect.
    await applyTranslucency("axis:glass", look);
    expect(alpha()).toBe("1");
    expect(fx).toHaveBeenLastCalledWith(null);
  });

  it("sends effect changes one at a time, in order, however fast they come", async () => {
    h.b.canBeTranslucent = () => true;
    await applyTranslucency("axis:glass", look); // start from no effect
    const log: string[] = [];
    vi.spyOn(h.b, "setWindowEffect").mockImplementation(async (fx) => {
      log.push(`start ${fx}`);
      await new Promise((r) => setTimeout(r, 5));
      log.push(`end ${fx}`);
    });
    await Promise.all(
      (["blur", "mica", "micaAlt"] as const).map((id) =>
        applyTranslucency("axis:translucent", { ...look, windowEffect: id }),
      ),
    );
    expect(log).toEqual([
      "start blur",
      "end blur",
      "start mica",
      "end mica",
      "start tabbed",
      "end tabbed",
    ]);
  });

  it("looks Clear while Windows' transparency effects are off, and says why", async () => {
    h.b.canBeTranslucent = () => true;
    const fx = vi.spyOn(h.b, "setWindowEffect");
    // One media query whose answer can change, like Windows' setting being switched.
    let reduced = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (q: string) => ({
      get matches() {
        return reduced && q.includes("reduced-transparency: reduce");
      },
      addEventListener: (_: string, f: () => void) => listeners.add(f),
      removeEventListener: (_: string, f: () => void) => listeners.delete(f),
    }));
    const reduce = (on: boolean) => {
      reduced = on;
      act(() => listeners.forEach((f) => f()));
    };
    try {
      reduce(false);
      await applyTranslucency("axis:translucent", look);
      expect(fx).toHaveBeenLastCalledWith("acrylic");
      reduce(true);
      await applyTranslucency("axis:translucent", look);
      expect(alpha()).toBe("0.8"); // still see-through, with no effect (it'd be solid)
      expect(fx).toHaveBeenLastCalledWith(null);
      render(<Settings section="appearance" onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("radio", { name: "Translucent" }));
      const slider = await screen.findByRole("slider", { name: "Window effect" });
      expect(slider).toBeEnabled(); // still choosable, for when Windows' setting is on
      expect(screen.getByText(/Frosted needs Windows' transparency effects/)).toBeInTheDocument();
      // Clear needs nothing from Windows.
      fireEvent.change(slider, { target: { value: "0" } });
      expect(screen.queryByText(/needs Windows' transparency effects/)).toBeNull();
      fireEvent.change(slider, { target: { value: "3" } });
      expect(screen.getByText(/Mica needs Windows' transparency effects/)).toBeInTheDocument();
      // Turned on in Windows while Settings is open: the hint goes right away.
      reduce(false);
      expect(screen.queryByText(/needs Windows' transparency effects/)).toBeNull();
      expect(screen.getByText(/soft tint of your wallpaper/)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps a 0.3.1 vault's blur choice: off becomes Clear, on becomes Frosted", async () => {
    const load = async (appearance: object) => {
      await h.b.writeFile(".axisnotes/config.json", JSON.stringify({ appearance }));
      await useConfig.getState().load();
      return useConfig.getState().config.appearance.windowEffect;
    };
    expect(await load({ windowBlur: false })).toBe("clear");
    expect(await load({ windowBlur: true })).toBe("frosted");
    expect(await load({})).toBe("frosted");
    expect(await load({ windowBlur: false, windowEffect: "mica" })).toBe("mica");
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

  it("has opacity and effect settings, shown only while it's the theme", async () => {
    h.b.canBeTranslucent = () => true;
    render(<Settings section="appearance" onClose={vi.fn()} />);
    expect(screen.queryByRole("slider", { name: "Window opacity" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Translucent" }));
    const slider = await screen.findByRole("slider", { name: "Window opacity" });
    expect(slider).toHaveValue("80");
    fireEvent.change(slider, { target: { value: "45" } });
    const effect = screen.getByRole("slider", { name: "Window effect" });
    expect(effect).toHaveValue("2");
    expect(effect).toHaveAttribute("aria-valuetext", "Frosted");
    fireEvent.change(effect, { target: { value: "1" } });
    expect(effect).toHaveAttribute("aria-valuetext", "Blur");
    expect(screen.getByText(/soft blur of what's behind/)).toBeInTheDocument();
    // The names under the slider pick an effect too.
    fireEvent.click(screen.getByText("Mica Alt"));
    expect(effect).toHaveValue("4");
    await waitFor(async () => {
      const saved = JSON.parse((await h.b.readFile(".axisnotes/config.json")).content);
      expect(saved.theme).toBe("axis:translucent");
      expect(saved.appearance).toMatchObject({ windowOpacity: 45, windowEffect: "micaAlt" });
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
    expect(screen.getByRole("slider", { name: "Window effect" })).toBeDisabled();
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
