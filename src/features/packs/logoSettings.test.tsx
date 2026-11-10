import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { LogoSettings } from "./LogoSettings";
import { IconPicker } from "../icons/IconPicker";
import { EntryIcon } from "../icons/EntryIcon";
import { BUILTIN_LOGOS } from "./builtinLogos";
import { Logo } from "../../app/Logo";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => ({
  ...(await orig<typeof import("../../ipc")>()),
  backend: new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] }),
}));
beforeEach(async () => {
  h.b = createMemoryBackend({ "Note.md": "# Note" });
  const vault = await h.b.openVault("/v");
  useAppStore.setState({ vault });
  useConfig.setState({ config: DEFAULT_CONFIG, loaded: true });
});

it("persists a bundled choice, restores it on reload and resets to the original", async () => {
  render(<LogoSettings />);
  fireEvent.click(screen.getByRole("button", { name: "AXIS Neon" }));
  await waitFor(() =>
    expect(h.b.files()[".axisnotes/config.json"]).toContain("builtin:axis-neon.png"),
  );
  useConfig.setState({ config: DEFAULT_CONFIG });
  await useConfig.getState().load();
  expect(useConfig.getState().config.appearance.logo).toBe("builtin:axis-neon.png");
  fireEvent.click(screen.getByRole("button", { name: "Restore original logo" }));
  await waitFor(() => expect(useConfig.getState().config.appearance.logo).toBe(""));
});

it("uploads a custom image through the owner importer and preserves the choice", async () => {
  vi.spyOn(h.b, "pickImage").mockResolvedValue("my-logo.png");
  render(<LogoSettings />);
  fireEvent.click(screen.getByRole("button", { name: "Upload custom logo…" }));
  await waitFor(() =>
    expect(useConfig.getState().config.appearance.logo).toBe("Attachments/Branding/my-logo.png"),
  );
  await useConfig.getState().load();
  expect(useConfig.getState().config.appearance.logo).toBe("Attachments/Branding/my-logo.png");
  expect(h.b.files()["Attachments/Branding/my-logo.png"]).toBeDefined();
});

it("shows every bundled design in the icon picker and renders the selected icon", async () => {
  render(<IconPicker path="Note.md" onClose={() => {}} />);
  fireEvent.click(screen.getByRole("tab", { name: "Packs" }));
  const grid = screen.getByRole("listbox", { name: "Icons in Default pack" });
  expect(within(grid).getAllByRole("option")).toHaveLength(3);
  fireEvent.click(within(grid).getByRole("option", { name: "AXIS Risograph" }));
  await waitFor(() =>
    expect(useConfig.getState().config.folderIcons["Note.md"]?.icon).toBe(
      "image:builtin:axis-risograph.png",
    ),
  );
  const { container } = render(<EntryIcon icon={{ icon: "image:builtin:axis-risograph.png" }} />);
  expect(container.querySelector("img")?.getAttribute("src")).toBe(BUILTIN_LOGOS[1]!.url);
});

it("falls back for missing images and refuses network URLs in the saved logo setting", () => {
  useConfig.setState({
    config: {
      ...DEFAULT_CONFIG,
      appearance: { ...DEFAULT_CONFIG.appearance, logo: "https://example.com/logo.png" },
    },
  });
  const { rerender } = render(<Logo />);
  expect(screen.getByAltText("AXISNotes")).toHaveAttribute("src", BUILTIN_LOGOS[0]!.url);
  useConfig.setState({
    config: {
      ...DEFAULT_CONFIG,
      appearance: { ...DEFAULT_CONFIG.appearance, logo: BUILTIN_LOGOS[2]!.path },
    },
  });
  rerender(<Logo />);
  fireEvent.error(screen.getByAltText("AXISNotes"));
  expect(screen.getByAltText("AXISNotes")).toHaveAttribute("src", BUILTIN_LOGOS[0]!.url);
});
