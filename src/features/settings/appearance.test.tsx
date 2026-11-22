import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import {
  applyCursor,
  applyTypography,
  FOLD_ARROWS,
  foldArrowVars,
  fontStack,
  HEADING_COLORS,
  headingColorVars,
} from "../../app/appearance";
import { installZoom, stepZoom, useAreaZoom, useAreaZoomProps, useZoom } from "../../app/zoom";
import { useAppStore } from "../../app/store";
import { commandForEvent } from "../commands/registry";
import { Settings } from "./Settings";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend, zooms: [] as number[] }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy(
    {},
    {
      get: (_t, key) =>
        key === "setZoom"
          ? async (z: number) => void h.zooms.push(z)
          : h.b[key as keyof MemoryBackend],
    },
  );
  return { ...mod, backend };
});

const key = (k: string, target?: Element) => {
  const e = new KeyboardEvent("keydown", { key: k, ctrlKey: true, bubbles: true });
  if (target) Object.defineProperty(e, "target", { value: target });
  return e;
};

beforeEach(async () => {
  localStorage.clear();
  h.zooms.length = 0;
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
  useZoom.setState({ zoom: 1 });
  useAreaZoom.setState({ areas: {} });
  document.documentElement.removeAttribute("style");
});

describe("zoom", () => {
  it("steps through the zoom levels and stops at the ends", () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(1.2, 1)).toBe(1.25); // an odd value snaps to the next step
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(0.5, -1)).toBe(0.5);
  });

  it("zooms with Ctrl + = / − / 0, remembers it, but not inside the canvas", () => {
    commandForEvent(key("="))!.run();
    commandForEvent(key("="))!.run();
    expect(useZoom.getState().zoom).toBe(1.25);
    expect(localStorage.getItem("axisnotes.zoom")).toBe("1.25");
    commandForEvent(key("-"))!.run();
    expect(useZoom.getState().zoom).toBe(1.1);
    commandForEvent(key("0"))!.run();
    expect(useZoom.getState().zoom).toBe(1);
    expect(h.zooms).toEqual([1.1, 1.25, 1.1, 1]);

    const canvas = document.createElement("div");
    canvas.className = "excalidraw";
    const inside = document.createElement("div");
    canvas.appendChild(inside);
    expect(commandForEvent(key("=", inside))).toBeUndefined();
  });

  it("zooms with the number-pad +, and on the welcome screen with Ctrl + mouse wheel", () => {
    const stop = installZoom();
    expect(h.zooms).toEqual([1]); // the saved zoom is applied at start
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true }));
    expect(useZoom.getState().zoom).toBe(1.1);
    // On the welcome screen (no vault), the wheel and Ctrl + − / 0 zoom it all, without
    // the command shortcuts.
    useAppStore.setState({ vault: null });
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true }));
    expect(useZoom.getState().zoom).toBe(1.25);
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 })); // no Ctrl: scrolling
    expect(useZoom.getState().zoom).toBe(1.25);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true }));
    expect(useZoom.getState().zoom).toBe(1.1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "0", ctrlKey: true }));
    expect(useZoom.getState().zoom).toBe(1);
    // With a vault open they're left to the (remappable) commands.
    useAppStore.setState({ vault: { root: "/v", name: "v" } });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "-", ctrlKey: true }));
    expect(useZoom.getState().zoom).toBe(1);
    stop();
  });

  it("zooms a side panel's content, not the panel itself", () => {
    let props: ReturnType<typeof useAreaZoomProps> | undefined;
    let main: ReturnType<typeof useAreaZoomProps> | undefined;
    function Probe() {
      props = useAreaZoomProps("left", { content: true });
      main = useAreaZoomProps("main");
      return null;
    }
    render(<Probe />);
    expect(props).toEqual({ "data-zoom-area": "left", style: undefined });
    act(() => useAreaZoom.getState().setArea("left", 1.5));
    act(() => useAreaZoom.getState().setArea("main", 1.25));
    // The panel keeps its size; CSS zooms its content by --area-zoom.
    expect(props!.style).toEqual({ "--area-zoom": 1.5 });
    expect(main!.style).toEqual({ zoom: 1.25, "--area-zoom": 1.25 });
  });

  it("zooms only the part of the window under the pointer with Ctrl + mouse wheel", () => {
    function Part({ area }: { area: "left" | "main" }) {
      return (
        <div {...useAreaZoomProps(area)}>
          <p>{area} text</p>
        </div>
      );
    }
    render(
      <>
        <Part area="left" />
        <Part area="main" />
        <p>status bar</p>
      </>,
    );
    const stop = installZoom();
    const wheel = (el: Element, deltaY: number) => {
      const e = new WheelEvent("wheel", { deltaY, ctrlKey: true, bubbles: true, cancelable: true });
      act(() => void el.dispatchEvent(e));
      return e.defaultPrevented;
    };
    const main = screen.getByText("main text");
    expect(wheel(main, -100)).toBe(true);
    wheel(main, -100);
    expect(main.parentElement!.style.getPropertyValue("--area-zoom")).toBe("1.25");
    const zoomOf = (el: HTMLElement) => el.parentElement!.style.getPropertyValue("--area-zoom");
    expect(zoomOf(screen.getByText("left text"))).toBe("");
    expect(useZoom.getState().zoom).toBe(1); // the rest of the app stays as it was
    expect(useAppStore.getState().notice).toBe("Main view 125% (Ctrl + 0 resets)");
    expect(JSON.parse(localStorage.getItem("axisnotes.areaZoom")!)).toEqual({ main: 1.25 });

    wheel(screen.getByText("left text"), 100);
    expect(useAreaZoom.getState().areas).toEqual({ main: 1.25, left: 0.9 });
    // Outside those parts nothing zooms, but the browser's page zoom is still kept away.
    expect(wheel(screen.getByText("status bar"), -100)).toBe(true);
    expect(useZoom.getState().zoom).toBe(1);

    // Ctrl + 0 puts everything back.
    act(() => commandForEvent(key("0"))!.run());
    expect(useAreaZoom.getState().areas).toEqual({});
    expect(zoomOf(main)).toBe("");
    stop();
  });
});

describe("text size, fonts and editor width", () => {
  it("applies them as CSS variables", () => {
    const style = document.documentElement.style;
    applyTypography({
      noteFontSize: 20,
      noteFont: 'Ge"orgia',
      uiFont: "Verdana",
      editorWidth: "full",
      foldArrow: "plus",
      headingColors: "rainbow",
      letterSpacing: 0.05,
      lineHeight: 1.8,
    });
    expect(style.getPropertyValue("--note-font-size")).toBe("20px");
    expect(style.getPropertyValue("--note-letter-spacing")).toBe("0.05em");
    expect(style.getPropertyValue("--note-line-height")).toBe("1.8");
    expect(style.getPropertyValue("--editor-width")).toBe("none");
    // Plus and minus: a different open icon, and no turn.
    expect(style.getPropertyValue("--fold-closed")).toBe(FOLD_ARROWS.plus.closed);
    expect(style.getPropertyValue("--fold-open")).toBe(FOLD_ARROWS.plus.open);
    expect(style.getPropertyValue("--fold-turn")).toBe("0deg");
    // Rainbow: each level its own colour, lighter in dark themes.
    expect(style.getPropertyValue("--heading-1")).toBe("light-dark(#d73a49, #e06c75)");
    expect(style.getPropertyValue("--heading-6")).toBe("light-dark(#6f42c1, #c678dd)");
    expect(style.getPropertyValue("--font-note")).toBe('"Georgia", var(--font-ui)');
    expect(style.getPropertyValue("--font-ui")).toMatch(/^"Verdana", "Segoe UI"/);
    // Back to the defaults; sizes stay in range.
    applyTypography({
      noteFontSize: 99,
      noteFont: "",
      uiFont: "",
      editorWidth: "medium",
      foldArrow: "triangle",
      headingColors: "theme",
      letterSpacing: 9,
      lineHeight: 1.5,
    });
    expect(style.getPropertyValue("--note-font-size")).toBe("32px");
    // Spacing stays in range; the default line height leaves the theme's own.
    expect(style.getPropertyValue("--note-letter-spacing")).toBe("0.2em");
    expect(style.getPropertyValue("--note-line-height")).toBe("");
    expect(style.getPropertyValue("--editor-width")).toBe("760px");
    expect(style.getPropertyValue("--fold-open")).toBe(FOLD_ARROWS.triangle.closed);
    expect(style.getPropertyValue("--fold-turn")).toBe("90deg");
    // The theme's own heading colour again: no level overrides left on the document.
    expect(style.getPropertyValue("--heading-1")).toBe("");
    expect(style.getPropertyValue("--font-ui")).toBe("");
    expect(fontStack("", "serif")).toBe("serif");
  });

  it("are set in Settings → Appearance and saved in the vault's config", async () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Editor width" }), {
      target: { value: "wide" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Zoom" }), {
      target: { value: "1.5" },
    });
    expect(useZoom.getState().zoom).toBe(1.5);
    // Fonts and text size are on the Typography tab.
    expect(screen.queryByRole("slider", { name: "Note text size" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Typography" }));
    fireEvent.change(screen.getByRole("slider", { name: "Note text size" }), {
      target: { value: "19" },
    });
    expect(screen.getByText("19 px")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Letter spacing" }), {
      target: { value: "0.03" },
    });
    expect(screen.getByText("+0.03 em")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("slider", { name: "Line height" }), {
      target: { value: "1.75" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Bionic Reading" }));
    const noteFont = screen.getByRole("combobox", { name: "Note font" });
    await waitFor(() => expect(noteFont).toHaveTextContent("Georgia"));
    fireEvent.change(noteFont, { target: { value: "Georgia" } });
    await waitFor(async () =>
      expect(JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).appearance).toEqual(
        {
          ...DEFAULT_CONFIG.appearance,
          noteFontSize: 19,
          noteFont: "Georgia",
          editorWidth: "wide",
          letterSpacing: 0.03,
          lineHeight: 1.75,
          bionicReading: true,
        },
      ),
    );
  });

  it("picks a fold arrow style, previewed closed and open, and saves it", async () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "Fold arrows" });
    const options = within(group).getAllByRole("radio");
    expect(options.map((o) => o.getAttribute("aria-label"))).toEqual(
      Object.values(FOLD_ARROWS).map((a) => a.label),
    );
    expect(within(group).getByRole("radio", { name: "Triangle" })).toBeChecked();
    fireEvent.click(within(group).getByRole("radio", { name: "Chevron" }));
    expect(within(group).getByRole("radio", { name: "Chevron" })).toBeChecked();
    await waitFor(async () =>
      expect(
        JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).appearance.foldArrow,
      ).toBe("chevron"),
    );
    // An unknown style from a hand-edited config falls back to the triangle.
    expect(foldArrowVars("nope" as never)["--fold-closed"]).toBe(FOLD_ARROWS.triangle.closed);
  });

  it("picks a heading color preset, previewed with its colors, and saves it", async () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    const group = screen.getByRole("radiogroup", { name: "Heading colors" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((o) => o.getAttribute("aria-label")),
    ).toEqual(Object.values(HEADING_COLORS).map((c) => c.label));
    expect(within(group).getByRole("radio", { name: "Theme default" })).toBeChecked();
    const ocean = within(group).getByRole("radio", { name: "Ocean" });
    expect(ocean.closest("label")!.style.getPropertyValue("--heading-1")).toBe(
      "light-dark(#0b5394, #7cc4ff)",
    );
    fireEvent.click(ocean);
    expect(ocean).toBeChecked();
    await waitFor(async () =>
      expect(
        JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).appearance.headingColors,
      ).toBe("ocean"),
    );
    // Accent follows the theme's accent; an unknown preset is the theme's colour.
    expect(headingColorVars("accent")!["--heading-2"]).toBe("var(--accent)");
    expect(headingColorVars("nope" as never)).toBeNull();
  });

  it("keeps a font chosen on another computer, marked as not installed", async () => {
    useConfig.setState({
      config: {
        ...DEFAULT_CONFIG,
        appearance: { ...DEFAULT_CONFIG.appearance, uiFont: "Rare Sans" },
      },
    });
    render(<Settings section="typography" onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Interface font" })).toHaveValue("Rare Sans");
    expect(screen.getByText("Rare Sans (not installed)")).toBeInTheDocument();
  });

  it("imports a font into the vault and offers it under “In this vault”", async () => {
    h.b.pickFont = async () => "C:\\Downloads\\Atkinson Hyperlegible.woff2";
    render(<Settings section="typography" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Import font…" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added Atkinson Hyperlegible");
    await expect(
      h.b.readFile("Attachments/Fonts/Atkinson Hyperlegible.woff2"),
    ).resolves.toBeTruthy();
    const noteFont = screen.getByRole("combobox", { name: "Note font" });
    const group = within(noteFont).getAllByRole("group")[0]!;
    expect(group).toHaveAttribute("label", "In this vault");
    expect(
      within(group).getByRole("option", { name: "Atkinson Hyperlegible" }),
    ).toBeInTheDocument();
    // Anything else is refused.
    h.b.pickFont = async () => "C:\\Downloads\\tool.exe";
    fireEvent.click(screen.getByRole("button", { name: "Import font…" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("not a font file"));
  });
});

describe("settings sections", () => {
  it("shows an icon beside every section name", () => {
    render(<Settings onClose={vi.fn()} />);
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const buttons = nav.querySelectorAll("button");
    expect(buttons.length).toBe(11);
    for (const b of buttons) {
      expect(b.querySelector("svg[aria-hidden='true']")).not.toBeNull();
      expect(b.textContent).not.toBe("");
    }
    expect(screen.getByRole("button", { name: "Appearance" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("groups related sections on one page, with tabs between them", () => {
    render(<Settings onClose={vi.fn()} />);
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const tabsOf = (page: string) => {
      fireEvent.click(within(nav).getByRole("button", { name: page }));
      return within(screen.getByRole("tablist", { name: page }))
        .getAllByRole("tab")
        .map((t) => t.textContent);
    };
    expect(tabsOf("Appearance")).toEqual([
      "Theme & layout",
      "Typography",
      "Cursor",
      "Ribbon",
      "Icon & image packs",
    ]);
    expect(tabsOf("Commands & shortcuts")).toEqual(["Quick commands", "Keyboard shortcuts"]);
    expect(tabsOf("AI")).toEqual(["Providers & models", "Skills", "Agent", "Claude"]);
    // A page with one section has no tabs.
    fireEvent.click(within(nav).getByRole("button", { name: "Spelling" }));
    expect(screen.queryByRole("tablist")).toBeNull();
    for (const gone of ["Colors", "Icon & image packs", "Keyboard shortcuts", "Agent", "Claude"])
      expect(within(nav).queryByRole("button", { name: gone })).toBeNull();
  });

  it("opens a grouped section on its page and tab, and moves between tabs with arrows", () => {
    render(<Settings section="claude" onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: "AI" })).toBeInTheDocument();
    const claude = screen.getByRole("tab", { name: "Claude" });
    expect(claude).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", claude.id);
    expect(
      within(screen.getByRole("navigation", { name: "Settings sections" })).getByRole("button", {
        name: "AI",
      }),
    ).toHaveAttribute("aria-current", "page");
    // Right from the last tab wraps to the first; left goes back.
    fireEvent.keyDown(claude, { key: "ArrowRight" });
    const providers = screen.getByRole("tab", { name: "Providers & models" });
    expect(providers).toHaveAttribute("aria-selected", "true");
    expect(providers).toHaveFocus();
    fireEvent.keyDown(providers, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Claude" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("text cursor (T-250)", () => {
  it("applies shape, thickness, color and blinking to the document", () => {
    const root = document.documentElement;
    applyCursor({ shape: "underline", width: 4, color: "#ff8800", blink: false });
    expect(root.style.getPropertyValue("--caret-width")).toBe("4px");
    expect(root.style.getPropertyValue("--caret-color")).toBe("#ff8800");
    expect(root.dataset.caretShape).toBe("underline");
    expect(root.dataset.caretBlink).toBe("off");
    // Out-of-range or hand-edited values fall back safely.
    applyCursor({ shape: "zigzag" as never, width: 99, color: "red; x: y", blink: true });
    expect(root.style.getPropertyValue("--caret-width")).toBe("8px");
    expect(root.style.getPropertyValue("--caret-color")).toBe("");
    expect(root.dataset.caretShape).toBeUndefined();
    expect(root.dataset.caretBlink).toBeUndefined();
    applyCursor(DEFAULT_CONFIG.appearance.cursor);
    expect(root.style.getPropertyValue("--caret-width")).toBe("");
  });

  it("is set on Appearance → Cursor and saved in the vault's config", async () => {
    render(<Settings section="cursor" onClose={vi.fn()} />);
    expect(screen.getByRole("tab", { name: "Cursor" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Block" }));
    expect(screen.getByRole("slider", { name: "Cursor thickness" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Bar" }));
    fireEvent.change(screen.getByRole("slider", { name: "Cursor thickness" }), {
      target: { value: "3" },
    });
    expect(screen.getByText("3 px")).toBeInTheDocument();
    fireEvent.input(screen.getByLabelText("Cursor color"), { target: { value: "#00aa55" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Cursor blinks" }));
    await waitFor(async () =>
      expect(
        JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).appearance.cursor,
      ).toEqual({ shape: "bar", width: 3, color: "#00aa55", blink: false }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use theme accent" }));
    expect(useConfig.getState().config.appearance.cursor.color).toBe("");
    // Reset to defaults puts the whole cursor back, then has nothing left to reset.
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    expect(useConfig.getState().config.appearance.cursor).toEqual(DEFAULT_CONFIG.appearance.cursor);
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeDisabled();
  });
});

describe("reset to defaults (T-253)", () => {
  it("puts Typography back but leaves other appearance settings alone", () => {
    useConfig.setState({
      config: {
        ...DEFAULT_CONFIG,
        appearance: {
          ...DEFAULT_CONFIG.appearance,
          noteFont: "Georgia",
          uiFont: "Verdana",
          noteFontSize: 20,
          letterSpacing: 0.05,
          lineHeight: 2,
          bionicReading: true,
          editorWidth: "wide",
          cursor: { shape: "block", width: 1, color: "", blink: false },
        },
      },
    });
    render(<Settings section="typography" onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Reset to defaults" }));
    const a = useConfig.getState().config.appearance;
    expect(a).toMatchObject({
      noteFont: "",
      uiFont: "",
      noteFontSize: DEFAULT_CONFIG.appearance.noteFontSize,
      letterSpacing: 0,
      lineHeight: 1.5,
      bionicReading: false,
    });
    expect(a.editorWidth).toBe("wide");
    expect(a.cursor.shape).toBe("block");
    expect(screen.getByRole("button", { name: "Reset to defaults" })).toBeDisabled();
  });
});
