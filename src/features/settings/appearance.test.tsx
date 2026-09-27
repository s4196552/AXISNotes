import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { applyTypography, fontStack } from "../../app/appearance";
import { installZoom, stepZoom, useZoom } from "../../app/zoom";
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

  it("zooms with Ctrl + mouse wheel and the number-pad +", () => {
    const stop = installZoom();
    expect(h.zooms).toEqual([1]); // the saved zoom is applied at start
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, ctrlKey: true }));
    expect(useZoom.getState().zoom).toBe(1.1);
    window.dispatchEvent(new WheelEvent("wheel", { deltaY: 100 })); // no Ctrl: scrolling
    expect(useZoom.getState().zoom).toBe(1.1);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "+", ctrlKey: true }));
    expect(useZoom.getState().zoom).toBe(1.25);
    // On the welcome screen (no vault), Ctrl + − / 0 work without the command shortcuts.
    useAppStore.setState({ vault: null });
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
});

describe("text size, fonts and editor width", () => {
  it("applies them as CSS variables", () => {
    const style = document.documentElement.style;
    applyTypography({
      noteFontSize: 20,
      noteFont: 'Ge"orgia',
      uiFont: "Verdana",
      editorWidth: "full",
    });
    expect(style.getPropertyValue("--note-font-size")).toBe("20px");
    expect(style.getPropertyValue("--editor-width")).toBe("none");
    expect(style.getPropertyValue("--font-note")).toBe('"Georgia", var(--font-ui)');
    expect(style.getPropertyValue("--font-ui")).toMatch(/^"Verdana", "Segoe UI"/);
    // Back to the defaults; sizes stay in range.
    applyTypography({ noteFontSize: 99, noteFont: "", uiFont: "", editorWidth: "medium" });
    expect(style.getPropertyValue("--note-font-size")).toBe("32px");
    expect(style.getPropertyValue("--editor-width")).toBe("760px");
    expect(style.getPropertyValue("--font-ui")).toBe("");
    expect(fontStack("", "serif")).toBe("serif");
  });

  it("are set in Settings → Appearance and saved in the vault's config", async () => {
    render(<Settings section="appearance" onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("slider", { name: "Note text size" }), {
      target: { value: "19" },
    });
    expect(screen.getByText("19 px")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Editor width" }), {
      target: { value: "wide" },
    });
    const noteFont = screen.getByRole("combobox", { name: "Note font" });
    await waitFor(() => expect(noteFont).toHaveTextContent("Georgia"));
    fireEvent.change(noteFont, { target: { value: "Georgia" } });
    fireEvent.change(screen.getByRole("combobox", { name: "Zoom" }), {
      target: { value: "1.5" },
    });
    expect(useZoom.getState().zoom).toBe(1.5);
    await waitFor(async () =>
      expect(JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).appearance).toEqual(
        { noteFontSize: 19, noteFont: "Georgia", uiFont: "", editorWidth: "wide" },
      ),
    );
  });

  it("keeps a font chosen on another computer, marked as not installed", async () => {
    useConfig.setState({
      config: {
        ...DEFAULT_CONFIG,
        appearance: { ...DEFAULT_CONFIG.appearance, uiFont: "Rare Sans" },
      },
    });
    render(<Settings section="appearance" onClose={vi.fn()} />);
    expect(screen.getByRole("combobox", { name: "Interface font" })).toHaveValue("Rare Sans");
    expect(screen.getByText("Rare Sans (not installed)")).toBeInTheDocument();
  });
});
