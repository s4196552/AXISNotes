import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend, SAMPLE_SOURCE } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { splitFrontmatter } from "../../lib/markdown";
import { useUi } from "../commands/ui";
import { Editor } from "../editor/Editor";
import { EntryIcon } from "../icons/EntryIcon";
import { IconPicker } from "../icons/IconPicker";
import { isPackPath, matchesPackFile, packCount, packFileLabel, usePacks } from "./packs";
import { PacksSettings } from "./PacksSettings";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"></svg>';

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    "Trip.md": "# Trip\n\nNotes",
    // A downloaded pack sitting in the vault (tests can't pick folders on disk).
    "Downloads/Feather/svg/star.svg": SVG,
    "Downloads/Feather/svg/moon-crescent.svg": SVG,
    "Downloads/Feather/png/16/star.png": "png",
    "Downloads/Feather/readme.md": "# Feather",
    "Downloads/Feather/.hidden/ghost.svg": SVG,
  });
  await h.b.openVault("/memory");
  useConfig.setState({ config: DEFAULT_CONFIG, loaded: true });
  useUi.setState({ modal: null });
  usePacks.setState({ packs: [], loaded: false, error: "" });
  useAppStore.setState({ error: null, activePath: "Trip.md", pendingTarget: null });
  await useAppStore.getState().refreshTree();
});

describe("pack helpers", () => {
  it("recognises pack paths and labels pack files", () => {
    expect(isPackPath(".axisnotes/packs/icons/Feather/star.svg")).toBe(true);
    expect(isPackPath(".axisnotes/packs/icons/../../secret.png")).toBe(false);
    expect(isPackPath("attachments/star.svg")).toBe(false);
    expect(packFileLabel(".axisnotes/packs/icons/F/rocket-ship_2.svg")).toBe("rocket ship 2");
    expect(matchesPackFile(".axisnotes/packs/icons/F/rocket-ship.svg", "ship")).toBe(true);
    expect(matchesPackFile(".axisnotes/packs/icons/F/rocket-ship.svg", "moon")).toBe(false);
    const pack = { kind: "icons" as const, name: "F", dir: "", files: ["a"], monochrome: false };
    expect(packCount(pack)).toBe("1 icon");
    expect(packCount({ ...pack, kind: "images", files: ["a", "b"] })).toBe("2 images");
  });

  it("imports a folder flat, keeping SVGs, out of the file tree", async () => {
    const pack = await h.b.importPack("icons", "Downloads/Feather");
    expect(pack).toEqual({
      kind: "icons",
      name: "Feather",
      dir: ".axisnotes/packs/icons/Feather",
      files: [
        ".axisnotes/packs/icons/Feather/moon-crescent.svg",
        ".axisnotes/packs/icons/Feather/star.svg",
      ],
      // Its SVGs name no colours, so they draw in one.
      monochrome: true,
    });
    expect((await h.b.importPack("icons", "Downloads/Feather")).name).toBe("Feather 2");
    const tree = JSON.stringify(await h.b.listTree());
    expect(tree).not.toContain(".axisnotes");
    await h.b.removePack("icons", "Feather 2");
    expect((await h.b.listPacks()).map((p) => p.name)).toEqual(["Feather"]);
    await expect(h.b.importPack("images", "Trip.md")).rejects.toMatchObject({ code: "NotFound" });
  });
});

describe("icon packs in the icon picker", () => {
  it("adds a pack and picks one of its icons, in a colour", async () => {
    render(<IconPicker path="Trip.md" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Icon for Trip.md" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Packs" }));
    expect(await within(dialog).findByText(/No icon packs yet/)).toBeInTheDocument();

    // The browser preview's picker returns a sample pack.
    fireEvent.click(within(dialog).getByRole("button", { name: /From folder/ }));
    const grid = await within(dialog).findByRole("listbox", { name: "Icons in Sample icons" });
    expect(within(grid).getAllByRole("option")).toHaveLength(6);
    expect(within(dialog).getByRole("status")).toHaveTextContent("Added “Sample icons” (6 icons).");

    // Search narrows by file name.
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Filter icons" }), {
      target: { value: "leaf" },
    });
    expect(
      within(grid)
        .getAllByRole("option")
        .map((o) => o.getAttribute("title")),
    ).toEqual(["leaf"]);

    fireEvent.click(within(dialog).getByRole("radio", { name: "Color #e5484d" }));
    // In a colour the icon is drawn as a tinted silhouette.
    expect(grid.querySelector(".tinted-icon")).not.toBeNull();
    fireEvent.click(within(grid).getByRole("option", { name: "leaf" }));
    expect(useConfig.getState().config.folderIcons["Trip.md"]).toEqual({
      icon: "image:.axisnotes/packs/icons/Sample icons/leaf.svg",
      color: "#e5484d",
    });
  });

  it("draws a one-colour pack icon in the text colour unless a colour is chosen", async () => {
    await h.b.importPack("icons", SAMPLE_SOURCE);
    const { unmount } = render(<IconPicker path="Trip.md" onClose={() => {}} />);
    let dialog = screen.getByRole("dialog", { name: "Icon for Trip.md" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Packs" }));
    const grid = await within(dialog).findByRole("listbox", { name: "Icons in Sample icons" });
    // Visible on any theme: tinted with the text colour, not left black.
    const shown = grid.querySelector(".tinted-icon") as HTMLElement;
    expect(shown.style.backgroundColor).toBe("currentcolor");
    fireEvent.click(within(grid).getByRole("option", { name: "cloud" }));
    expect(useConfig.getState().config.folderIcons["Trip.md"]).toEqual({
      icon: "image:.axisnotes/packs/icons/Sample icons/cloud.svg",
      color: "currentColor",
    });
    unmount();
    // Reopened, the default swatch is the chosen one.
    render(<IconPicker path="Trip.md" onClose={() => {}} />);
    dialog = screen.getByRole("dialog", { name: "Icon for Trip.md" });
    expect(within(dialog).getByRole("radio", { name: "Default color" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("opens on the Packs tab for a pack icon, and draws it tinted", async () => {
    await h.b.importPack("icons", SAMPLE_SOURCE);
    const icon = { icon: "image:.axisnotes/packs/icons/Sample icons/atom.svg", color: "#3e63dd" };
    useConfig.setState({
      config: { ...DEFAULT_CONFIG, folderIcons: { "Trip.md": icon } },
      loaded: true,
    });
    const { container } = render(<EntryIcon icon={icon} />);
    const tinted = container.querySelector(".tinted-icon") as HTMLElement;
    expect(tinted.style.backgroundColor).toBe("rgb(62, 99, 221)");
    // Without a colour the image is shown as it is.
    const plain = render(<EntryIcon icon={{ icon: icon.icon }} />);
    expect(plain.container.querySelector("img.image-icon")).not.toBeNull();

    render(<IconPicker path="Trip.md" onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Icon for Trip.md" });
    expect(within(dialog).getByRole("tab", { name: "Packs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const atom = await within(dialog).findByRole("option", { name: "atom" });
    expect(atom).toHaveAttribute("aria-selected", "true");
  });
});

describe("image packs in the cover gallery", () => {
  async function open() {
    const utils = render(<Editor path="Trip.md" />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
    const view = EditorView.findFromDOM(
      utils.container.querySelector(".cm-editor") as HTMLElement,
    )!;
    return { ...utils, props: () => splitFrontmatter(view.state.doc.toString()).props };
  }

  it("adds an image pack and uses one of its images as the cover", async () => {
    const { props, container } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    const picker = screen.getByRole("dialog", { name: "Choose a cover" });
    await act(async () => {
      fireEvent.click(within(picker).getByRole("button", { name: /From folder/ }));
    });
    const tiles = await within(picker).findByRole("listbox", { name: "Covers in Sample covers" });
    fireEvent.click(within(tiles).getByRole("option", { name: "lagoon" }));

    expect(props()).toEqual({ banner: "[[.axisnotes/packs/images/Sample covers/lagoon.svg]]" });
    // Pack images aren't in the file tree, but the cover still finds the file.
    const img = await waitFor(() => {
      const el = container.querySelector(".page-cover img") as HTMLImageElement | null;
      expect(el).not.toBeNull();
      return el!;
    });
    expect(img.src).toMatch(/^data:image\/svg\+xml/);
  });
});

describe("Settings → Icon & image packs", () => {
  it("lists packs by kind and removes one", async () => {
    await h.b.importPack("icons", "Downloads/Feather");
    await h.b.importPack("images", SAMPLE_SOURCE);
    render(<PacksSettings />);
    const icons = await screen.findByRole("region", { name: "Icon packs" });
    await within(icons).findByText("Feather");
    expect(within(icons).getByText("2 icons")).toBeInTheDocument();
    const images = screen.getByRole("region", { name: "Image packs" });
    expect(within(images).getByText("Sample covers")).toBeInTheDocument();

    fireEvent.click(within(icons).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(within(icons).queryByText("Feather")).toBeNull());
    expect(within(icons).getByText("None yet.")).toBeInTheDocument();
    expect((await h.b.listPacks()).map((p) => p.name)).toEqual(["Sample covers"]);
  });
});
