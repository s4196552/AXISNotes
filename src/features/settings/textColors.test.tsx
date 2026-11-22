import { readFileSync } from "node:fs";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, mergeConfig, useConfig } from "../../app/config";
import { applyTextColors, textColorVars } from "../../app/appearance";
import { AnswerText } from "../ai/AnswerText";
import { InlineText } from "../tasks/InlineText";
import { Settings } from "./Settings";

// T-260: optional colours for bold, italic and strikethrough text.

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
  document.documentElement.removeAttribute("style");
});

const off = { on: false, light: "", dark: "" };

describe("bold, italic and strikethrough colours (T-260)", () => {
  it("are off by default, so text keeps the theme's colour", () => {
    expect(DEFAULT_CONFIG.appearance.textColors).toEqual({ bold: off, italic: off, strike: off });
    expect(textColorVars(DEFAULT_CONFIG.appearance.textColors)).toEqual({});
    // Older configs without the setting get the defaults.
    expect(mergeConfig({ appearance: {} }).appearance.textColors.bold).toEqual(off);
  });

  it("use the picked colours per mode, or the theme's token for a mode left unset", () => {
    expect(
      textColorVars({
        bold: { on: true, light: "#aa0000", dark: "#ff8888" },
        italic: { on: true, light: "", dark: "" },
        strike: { on: true, light: "#123456", dark: "" },
      }),
    ).toEqual({
      "--text-bold": "light-dark(#aa0000, #ff8888)",
      "--text-italic": "var(--text-italic-theme)",
      "--text-strike": "light-dark(#123456, var(--text-strike-theme))",
    });
    // Same colour in both modes needs no light-dark().
    expect(textColorVars({ bold: { on: true, light: "#00aa00", dark: "#00aa00" } })).toEqual({
      "--text-bold": "#00aa00",
    });
  });

  it("only lets plain hex colours reach CSS", () => {
    expect(textColorVars({ bold: { on: true, light: "red; x: url(evil)", dark: "#zzz" } })).toEqual(
      { "--text-bold": "var(--text-bold-theme)" },
    );
  });

  it("are set on the document and cleared when turned off", () => {
    const style = document.documentElement.style;
    applyTextColors({
      ...DEFAULT_CONFIG.appearance.textColors,
      italic: { on: true, light: "#0000ff", dark: "" },
    });
    expect(style.getPropertyValue("--text-italic")).toBe(
      "light-dark(#0000ff, var(--text-italic-theme))",
    );
    expect(style.getPropertyValue("--text-bold")).toBe("");
    applyTextColors(DEFAULT_CONFIG.appearance.textColors);
    expect(style.getPropertyValue("--text-italic")).toBe("");
  });

  it("colour notes and AI answers through theme tokens, without touching the Markdown", () => {
    const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const themes = strip("src/styles/themes.css");
    for (const k of ["bold", "italic", "strike"])
      expect(themes).toMatch(new RegExp(`--text-${k}-theme:`));
    const editor = strip("src/features/editor/editor.css");
    expect(editor).toMatch(/\.cm-lp-strong \{[^}]*color: var\(--text-bold, inherit\)/);
    expect(editor).toMatch(/\.cm-lp-em \{[^}]*color: var\(--text-italic, inherit\)/);
    expect(editor).toMatch(/\.cm-lp-strike \{[^}]*color: var\(--text-strike, inherit\)/);
    const ai = strip("src/features/ai/ai.css");
    expect(ai).toMatch(/\.answer-text strong \{[^}]*var\(--text-bold, inherit\)/);
    expect(ai).toMatch(/\.answer-text em \{[^}]*var\(--text-italic, inherit\)/);
    expect(ai).toMatch(/\.answer-text s \{[^}]*var\(--text-strike, inherit\)/);
    // AI answers render real <strong>/<em>/<s>, which those rules colour.
    const { container } = render(<AnswerText text="**b** *i* ~~s~~" from="n.md" />);
    expect(container.querySelector(".answer-text strong")).toHaveTextContent("b");
    expect(container.querySelector(".answer-text em")).toHaveTextContent("i");
    expect(container.querySelector(".answer-text s")).toHaveTextContent("s");
  });

  it("colour note text outside the editor too: tasks, dashboard and study cards (T-271)", () => {
    const strip = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const app = strip("src/styles/app.css");
    expect(app).toMatch(/\.inline-bold \{[^}]*color: var\(--text-bold, inherit\)/);
    expect(app).toMatch(/\.inline-italic \{[^}]*color: var\(--text-italic, inherit\)/);
    expect(app).toMatch(/\.inline-strike \{[^}]*color: var\(--text-strike, inherit\)/);
    // The task view, dashboard and study cards all draw note text with InlineText.
    for (const f of [
      "src/features/tasks/TasksView.tsx",
      "src/features/dashboard/Dashboard.tsx",
      "src/features/studyBlocks/shared.tsx",
    ])
      expect(readFileSync(f, "utf8"), f).toMatch(/<InlineText\b/);
    const { container } = render(<InlineText text="**b** *i* ~~s~~ plain" from="n.md" />);
    expect(container.querySelector("strong.inline-bold")).toHaveTextContent("b");
    expect(container.querySelector("em.inline-italic")).toHaveTextContent("i");
    expect(container.querySelector("s.inline-strike")).toHaveTextContent("s");
  });

  it("are set in Settings → Appearance with a picker per mode and a reset", async () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    const light = screen.getByLabelText("Bold colour in light themes");
    expect(light).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Colour bold text" }));
    expect(light).toBeEnabled();
    expect(screen.getByRole("button", { name: "Reset bold colour" })).toBeDisabled();
    fireEvent.input(light, { target: { value: "#cc0000" } });
    fireEvent.input(screen.getByLabelText("Bold colour in dark themes"), {
      target: { value: "#ff9999" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Colour strikethrough text" }));
    await waitFor(async () =>
      expect(
        JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).appearance.textColors,
      ).toEqual({
        bold: { on: true, light: "#cc0000", dark: "#ff9999" },
        italic: off,
        strike: { on: true, light: "", dark: "" },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset bold colour" }));
    expect(useConfig.getState().config.appearance.textColors.bold).toEqual({
      on: true,
      light: "",
      dark: "",
    });
  });
});
