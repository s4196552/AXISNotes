import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { splitFrontmatter } from "../../lib/markdown";
import { useUi } from "../commands/ui";
import { Modals } from "../commands/Modals";
import { Editor } from "./Editor";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const SKY = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="800"></svg>';

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    "Trip.md": "# Trip\n\nNotes",
    "Remote.md": "---\nbanner: https://example.com/a.jpg\n---\nx",
    "Gone.md": '---\nbanner: "[[nowhere.png]]"\n---\nx',
    "img/sky.svg": SKY,
  });
  await h.b.openVault("/memory");
  useConfig.setState({ config: DEFAULT_CONFIG, loaded: true });
  useUi.setState({ modal: null });
  useAppStore.setState({ error: null, activePath: "Trip.md", pendingTarget: null });
  await useAppStore.getState().refreshTree();
});

async function open(path = "Trip.md") {
  const utils = render(<Editor path={path} />);
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved"));
  const view = EditorView.findFromDOM(utils.container.querySelector(".cm-editor") as HTMLElement)!;
  const props = () => splitFrontmatter(view.state.doc.toString()).props;
  return { ...utils, view, props };
}

describe("page cover", () => {
  it("adds a gradient cover, kept in the frontmatter and out of the properties chip", async () => {
    const { props, container } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    const picker = screen.getByRole("dialog", { name: "Choose a cover" });
    fireEvent.click(within(picker).getByRole("option", { name: "Dusk" }));

    expect(props()).toEqual({ banner: "gradient:dusk" });
    // The new YAML block stays folded: the cursor was below it and still is.
    expect(container.querySelector(".cm-lp-props-chip")).not.toBeNull();
    const cover = container.querySelector(".page-cover") as HTMLElement;
    expect(cover.style.background).toContain("linear-gradient");
    expect(screen.queryByLabelText("Value of banner")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Choose a cover" })).toBeNull();

    // Change it to a colour, then remove it.
    fireEvent.click(screen.getByRole("button", { name: "Change cover" }));
    fireEvent.click(screen.getByRole("option", { name: "Colour #0090ff" }));
    expect(props()).toEqual({ banner: "#0090ff" });
    fireEvent.click(screen.getByRole("button", { name: "Remove cover" }));
    expect(props()).toEqual({});
    expect(container.querySelector(".page-cover")).toBeNull();
  });

  it("uses a vault image in the Obsidian Banners form and repositions it", async () => {
    const { props, container } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Filter images" }), {
      target: { value: "sky" },
    });
    fireEvent.click(screen.getByRole("option", { name: /sky\.svg/ }));
    expect(props()).toEqual({ banner: "[[img/sky.svg]]" });
    const img = container.querySelector(".page-cover img") as HTMLImageElement;
    expect(img.src).toMatch(/^data:image\/svg\+xml/);
    expect(img.style.objectPosition).toBe("center 50%");

    fireEvent.click(screen.getByRole("button", { name: "Reposition" }));
    const slider = screen.getByRole("slider", { name: "Cover position" });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    fireEvent.keyDown(slider, { key: "ArrowDown" });
    expect(img.style.objectPosition).toBe("center 60%");
    // Pressing Save on the cover must not start a drag (that would capture the pointer
    // and swallow the click).
    const saveButton = screen.getByRole("button", { name: "Save position" });
    expect(fireEvent.pointerDown(saveButton, { button: 0 })).toBe(true);
    fireEvent.click(saveButton);
    expect(props()).toEqual({ banner: "[[img/sky.svg]]", banner_y: 0.6 });

    // Escape cancels a reposition without writing.
    fireEvent.click(screen.getByRole("button", { name: "Reposition" }));
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowUp" });
    fireEvent.keyDown(screen.getByRole("slider"), { key: "Escape" });
    expect(props().banner_y).toBe(0.6);
    expect(img.style.objectPosition).toBe("center 60%");
  });

  it("uploads an image from the computer into attachments/", async () => {
    h.b.pickImage = async () => "C:\\Pictures\\coast.svg";
    const { props } = await open();
    fireEvent.click(screen.getByRole("button", { name: "Add cover" }));
    fireEvent.click(screen.getByRole("tab", { name: "Images" }));
    fireEvent.click(screen.getByRole("button", { name: /Upload image/ }));
    await waitFor(() => expect(props()).toEqual({ banner: "[[attachments/coast.svg]]" }));
    expect(h.b.files()["attachments/coast.svg"]).toBe("");
  });

  it("explains web and missing covers instead of loading them", async () => {
    const remote = await open("Remote.md");
    expect(screen.getByText(/Web images aren't loaded/)).toBeInTheDocument();
    expect(remote.container.querySelector(".page-cover img")).toBeNull();
    remote.unmount();
    await open("Gone.md");
    expect(screen.getByText("Cover image not found: nowhere.png")).toBeInTheDocument();
  });
});

describe("page icon", () => {
  it("shows the note's custom icon large and opens the icon picker", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add icon" }));
    expect(useUi.getState().modal).toEqual({ kind: "icon", path: "Trip.md" });

    act(() =>
      useConfig.setState({
        config: { ...DEFAULT_CONFIG, folderIcons: { "Trip.md": { icon: "🏖" } } },
      }),
    );
    const button = screen.getByRole("button", { name: "Change page icon" });
    expect(button).toHaveTextContent("🏖");
    expect(screen.queryByRole("button", { name: "Add icon" })).toBeNull();
  });

  it("can use a vault image as the icon", async () => {
    render(<Modals />);
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add icon" }));
    const dialog = await screen.findByRole("dialog", { name: "Icon for Trip.md" });
    fireEvent.click(within(dialog).getByRole("tab", { name: "Image" }));
    fireEvent.click(within(dialog).getByRole("option", { name: /sky\.svg/ }));
    await waitFor(() =>
      expect(useConfig.getState().config.folderIcons["Trip.md"]).toEqual({
        icon: "image:img/sky.svg",
      }),
    );
    const icon = screen.getByRole("button", { name: "Change page icon" }).querySelector("img");
    expect(icon?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
  });
});
