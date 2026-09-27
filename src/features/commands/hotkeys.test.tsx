import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { Settings } from "../settings/Settings";
import { effectiveShortcut, formatHotkey, hotkeyFromEvent, parseHotkey } from "./hotkeys";
import { allCommands, commandForEvent } from "./registry";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  new KeyboardEvent("keydown", { key: k, ...mods });

beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  useConfig.setState({ config: { ...DEFAULT_CONFIG, hotkeys: {} } });
});

describe("hotkey text", () => {
  it("parses and formats", () => {
    expect(parseHotkey("Ctrl+Shift+K")).toEqual({ key: "k", mod: true, shift: true });
    expect(parseHotkey("cmd+alt+F2")).toEqual({ key: "F2", mod: true, alt: true });
    expect(parseHotkey("")).toBeNull();
    expect(parseHotkey("Ctrl+A+B")).toBeNull();
    expect(formatHotkey({ key: ",", mod: true })).toBe("Ctrl+,");
    expect(hotkeyFromEvent(key("k", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+K");
    expect(hotkeyFromEvent(key("Shift", { shiftKey: true }))).toBeNull();
    expect(hotkeyFromEvent(key(" ", { altKey: true }))).toBe("Alt+Space");
  });

  it("uses overrides, including removing a shortcut", () => {
    const def = { key: "p", mod: true };
    expect(effectiveShortcut("x", def, {})).toBe(def);
    expect(effectiveShortcut("x", def, { x: "Alt+P" })).toEqual({ key: "p", alt: true });
    expect(effectiveShortcut("x", def, { x: "" })).toBeUndefined();
  });

  it("dispatches key presses to the remapped command", () => {
    expect(commandForEvent(key("p", { ctrlKey: true }))?.id).toBe("palette");
    useConfig.setState({
      config: { ...useConfig.getState().config, hotkeys: { palette: "Ctrl+Shift+Y" } },
    });
    expect(commandForEvent(key("p", { ctrlKey: true }))).toBeUndefined();
    expect(commandForEvent(key("Y", { ctrlKey: true, shiftKey: true }))?.id).toBe("palette");
  });
});

describe("Settings → Keyboard shortcuts", () => {
  it("records a new shortcut, taking it from the command that had it", async () => {
    render(<Settings section="hotkeys" onClose={vi.fn()} />);
    const quick = screen.getByRole("button", { name: "Shortcut for Open command palette" });
    expect(quick).toHaveTextContent("Ctrl+P");
    const settingsCmd = allCommands().find((c) => c.id === "settings")!;
    fireEvent.click(screen.getByRole("button", { name: `Shortcut for ${settingsCmd.label}` }));
    fireEvent.keyDown(screen.getByRole("button", { name: "Press keys…" }), {
      key: "p",
      ctrlKey: true,
    });
    await waitFor(() =>
      expect(useConfig.getState().config.hotkeys).toEqual({ settings: "Ctrl+P", palette: "" }),
    );
    expect(
      screen.getByRole("button", { name: "Shortcut for Open command palette" }),
    ).toHaveTextContent("None");
    fireEvent.click(
      screen.getByRole("button", { name: "Reset shortcut for Open command palette" }),
    );
    // Back to Ctrl+P, which "Open settings" gives up.
    await waitFor(() => expect(useConfig.getState().config.hotkeys).toEqual({ settings: "" }));
    // Saved in the vault's config file.
    expect(JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).hotkeys).toEqual({
      settings: "",
    });
  });
});
