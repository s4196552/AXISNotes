import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import {
  applyAppearance,
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
  h.b = createMemoryBackend({ ".axisnotes/themes/Nord.css": ":root { --bg: #2e3440; }" });
  await h.b.openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  delete document.documentElement.dataset.theme;
});

describe("built-in themes", () => {
  it("set data-theme for every built-in except Match system; a user theme loads its CSS", async () => {
    for (const theme of ["darker", "minimal", "glass", "contrast", "retro", "dark"]) {
      await applyAppearance({ theme, snippets: [] });
      expect(document.documentElement.dataset.theme).toBe(theme);
    }
    await applyAppearance({ theme: "system", snippets: [] });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    await applyAppearance({ theme: "Nord", snippets: [] });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.getElementById("axis-user-theme")?.textContent).toContain("#2e3440");
  });

  it("know whether they're light or dark (toggle theme, canvas, diagrams)", () => {
    expect(effectiveMode("darker")).toBe("dark");
    expect(effectiveMode("contrast")).toBe("dark");
    expect(effectiveMode("minimal")).toBe("light");
    expect(effectiveMode("retro")).toBe("light");
    // Glass follows the OS, like Match system (jsdom reports light).
    expect(effectiveMode("glass")).toBe(effectiveMode("system"));
  });

  it("tell listeners when the theme changes, until they unsubscribe", async () => {
    const listener = vi.fn();
    const stop = onThemeChange(listener);
    await applyAppearance({ theme: "retro", snippets: [] });
    expect(listener).toHaveBeenCalledTimes(1);
    stop();
    await applyAppearance({ theme: "glass", snippets: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("each define the full set of color tokens, for the app and for preview tiles", () => {
    const css = readFileSync("src/styles/themes.css", "utf8");
    const tokens = ["--bg", "--bg-sidebar", "--bg-elevated", "--bg-hover", "--bg-active", "--fg"];
    const more = ["--fg-muted", "--border", "--accent", "--accent-fg", "--danger", "--code-bg"];
    for (const theme of ["darker", "minimal", "glass", "contrast", "retro"]) {
      const block = new RegExp(
        String.raw`:root\[data-theme="${theme}"\],\s*\[data-theme-preview="${theme}"\]\s*\{([^}]*)\}`,
      ).exec(css)?.[1];
      expect(block, theme).toBeDefined();
      for (const t of [...tokens, ...more, "--selection"])
        expect(block, `${theme} ${t}`).toContain(`${t}:`);
    }
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
        "glass",
      ),
    );
    expect(within(group).getByRole("radio", { name: "Glass" })).toBeChecked();
  });
});
