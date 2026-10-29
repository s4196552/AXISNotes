import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { Settings } from "../settings/Settings";
import { effectiveShortcut, formatHotkey, hotkeyFromEvent, parseHotkey } from "./hotkeys";
import { allCommands, commandForEvent } from "./registry";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { setActiveEditor } from "../editor/activeEditor";

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

describe("formatting shortcuts", () => {
  it("bolds and italicises with Ctrl+B and Ctrl+I in a note, and nowhere else", () => {
    const view = new EditorView({
      parent: document.body,
      state: EditorState.create({ doc: "a ", selection: { anchor: 2 } }),
    });
    setActiveEditor(view, "Note.md");
    const inNote = (k: string, mods: Partial<KeyboardEvent> = {}) => {
      const e = key(k, { ctrlKey: true, ...mods });
      Object.defineProperty(e, "target", { value: view.contentDOM });
      return e;
    };
    expect(commandForEvent(inNote("b"))?.id).toBe("format-bold");
    expect(commandForEvent(inNote("i"))?.id).toBe("format-italic");
    expect(commandForEvent(inNote("s", { shiftKey: true }))?.id).toBe("format-strikethrough");
    expect(commandForEvent(inNote("e"))?.id).toBe("insert-inline-code");
    commandForEvent(inNote("b"))!.run();
    expect(view.state.doc.toString()).toBe("a ****");
    expect(view.state.selection.main.head).toBe(4);
    // Outside a note (a grid, a text field) Ctrl+B is left alone.
    const grid = document.createElement("div");
    document.body.append(grid);
    const outside = key("b", { ctrlKey: true });
    Object.defineProperty(outside, "target", { value: grid });
    expect(commandForEvent(outside)).toBeUndefined();
    setActiveEditor(null);
    view.destroy();
    grid.remove();
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
