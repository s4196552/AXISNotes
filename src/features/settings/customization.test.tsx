import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { applyAppearance } from "../../app/appearance";
import { FileTree } from "../filetree";
import { Modals } from "../commands/Modals";
import { allCommands } from "../commands/registry";
import { useUi } from "../commands/ui";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const savedConfig = () => JSON.parse(h.b.files()[".axis/config.json"] ?? "{}");

beforeEach(async () => {
  h.b = createMemoryBackend({
    "School/Bio.md": "",
    "Ideas.md": "",
    ".axis/themes/Nord.css": ":root { --accent: #88c0d0; }",
    ".axis/snippets/wide.css": ".cm-content { max-width: none; }",
    ".axis/snippets/serif.css": "body { font-family: serif; }",
  });
  useConfig.setState({ config: DEFAULT_CONFIG, loaded: true });
  useUi.setState({ modal: null });
  useAppStore.setState({ vault: { root: "/v", name: "V" }, activePath: null, error: null });
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  await act(() => useAppStore.getState().refreshTree());
});

describe("appearance", () => {
  it("applies built-in modes, user themes and snippets", async () => {
    await applyAppearance({ theme: "dark", snippets: [] });
    expect(document.documentElement.dataset.theme).toBe("dark");

    await applyAppearance({ theme: "Nord", snippets: ["wide", "serif"] });
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.getElementById("axis-user-theme")?.textContent).toContain("#88c0d0");
    expect(document.querySelectorAll("style[data-axis-snippet]")).toHaveLength(2);

    await applyAppearance({ theme: "system", snippets: ["serif"] });
    expect(document.getElementById("axis-user-theme")?.textContent).toBe("");
    const left = [...document.querySelectorAll("style[data-axis-snippet]")].map((s) =>
      s.getAttribute("data-axis-snippet"),
    );
    expect(left).toEqual(["serif"]);
  });

  it("toggles between light and dark and saves the config", async () => {
    await act(async () =>
      allCommands()
        .find((c) => c.id === "toggle-theme")!
        .run(),
    );
    await waitFor(() => expect(["light", "dark"]).toContain(useConfig.getState().config.theme));
    const first = useConfig.getState().config.theme;
    await act(async () =>
      allCommands()
        .find((c) => c.id === "toggle-theme")!
        .run(),
    );
    await waitFor(() => expect(useConfig.getState().config.theme).not.toBe(first));
    expect(savedConfig().theme).toBe(useConfig.getState().config.theme);
  });
});

describe("folder icons", () => {
  it("sets an icon from the context menu, follows renames and is removed on trash", async () => {
    render(
      <>
        <FileTree />
        <Modals />
      </>,
    );
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "School" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change icon…" }));
    const dialog = screen.getByRole("dialog", { name: "Icon for School" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "Color #30a46c" }));
    fireEvent.click(within(dialog).getByRole("option", { name: "GraduationCap" }));

    await waitFor(() =>
      expect(savedConfig().folderIcons).toEqual({
        School: { icon: "lucide:GraduationCap", color: "#30a46c" },
      }),
    );
    const row = screen.getByRole("treeitem", { name: "School" });
    expect(row.querySelector(".custom-icon")).not.toBeNull();

    // Emoji icons work too.
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Ideas" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Change icon…" }));
    fireEvent.click(screen.getByRole("tab", { name: "Emoji" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter icons" }), {
      target: { value: "bulb" },
    });
    fireEvent.click(await screen.findByRole("option", { name: "light bulb" }));
    await waitFor(() =>
      expect(useConfig.getState().config.folderIcons["Ideas.md"]?.icon).toBe("💡"),
    );

    // Rename the folder: the icon moves with it.
    fireEvent.click(screen.getByRole("treeitem", { name: "School" }));
    fireEvent.keyDown(screen.getByRole("tree"), { key: "F2" });
    const input = screen.getByRole("textbox", { name: "New name" });
    fireEvent.change(input, { target: { value: "University" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(Object.keys(useConfig.getState().config.folderIcons)).toContain("University"),
    );
    expect(useConfig.getState().config.folderIcons.School).toBeUndefined();

    // Trash it: the icon setting goes too.
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "University" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    await waitFor(() => expect(useConfig.getState().config.folderIcons.University).toBeUndefined());
  });
});

describe("settings", () => {
  it("edits appearance, daily notes and quick commands", async () => {
    render(<Modals />);
    act(() => useUi.getState().open({ kind: "settings" }));
    const dialog = screen.getByRole("dialog", { name: "Settings" });

    const theme = within(dialog).getByRole("combobox", { name: "Theme" });
    await waitFor(() =>
      expect(within(theme).getByRole("option", { name: "Nord" })).toBeInTheDocument(),
    );
    fireEvent.change(theme, { target: { value: "Nord" } });
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: "wide" }));
    await waitFor(() => expect(savedConfig()).toMatchObject({ theme: "Nord", snippets: ["wide"] }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Daily notes" }));
    const folder = within(dialog).getByRole("textbox", { name: "Daily notes folder" });
    fireEvent.change(folder, { target: { value: "Journal" } });
    fireEvent.blur(folder);
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Open daily note on startup" }));
    await waitFor(() =>
      expect(savedConfig().dailyNotes).toMatchObject({ folder: "Journal", openOnStartup: true }),
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Quick commands" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Table" }));
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Custom command name" }), {
      target: { value: "Signature" },
    });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Custom command text" }), {
      target: { value: "— Ada" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add custom command" }));
    await waitFor(() =>
      expect(savedConfig().quickCommands).toMatchObject({
        disabled: ["table"],
        custom: [{ label: "Signature", insert: "— Ada" }],
      }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Close settings" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
