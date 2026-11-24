import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { useAppStore } from "../../app/store";
import { NoteAiAccess } from "./NoteAiAccess";
import { noteAccess } from "./noteAccess";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({ "School/Bio.md": "# Bio\n", "Health/Blood.md": "# Blood\n" });
  await h.b.openVault("/v");
  await useAppStore.getState().openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG) });
});

const savedRules = async () =>
  JSON.parse((await h.b.readFile(".axisnotes/config.json")).content).ai.folders;

describe("AI access button beside the note title (T-256)", () => {
  it("works out the note's own, inherited and effective rule", () => {
    const folders = { Health: "local", "Health/Blood.md": "never" } as const;
    expect(noteAccess(folders, "Health/Blood.md", undefined)).toEqual({
      own: "never",
      inherited: "local",
      mark: null,
      effective: "never",
    });
    expect(noteAccess(folders, "Health/Other.md", undefined).effective).toBe("local");
    // A note's own ai-access property can only make it stricter.
    expect(noteAccess({}, "School/Bio.md", "local").effective).toBe("local");
  });

  it("shows whether AI can read the note and sets the note's own rule", async () => {
    render(<NoteAiAccess path="School/Bio.md" />);
    const button = screen.getByRole("button", { name: "AI access: Any AI" });
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const choice = screen.getByRole("menuitemradio", { name: /Same as its folder/ });
    expect(choice).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Never" }));
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "AI access: Never" })).toBeInTheDocument();
    await waitFor(async () => expect(await savedRules()).toEqual({ "School/Bio.md": "never" }));
    // Back to following the folder removes the note's own rule.
    fireEvent.click(screen.getByRole("button", { name: "AI access: Never" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Same as its folder/ }));
    await waitFor(async () => expect(await savedRules()).toEqual({}));
  });

  it("follows its folder's rule until the note has its own", () => {
    useConfig.setState({
      config: { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, folders: { Health: "local" } } },
    });
    render(<NoteAiAccess path="Health/Blood.md" />);
    const button = screen.getByRole("button", { name: "AI access: Local models only" });
    expect(button.title).toMatch(/folder's rule/);
    fireEvent.click(button);
    expect(
      screen.getByRole("menuitemradio", { name: "Same as its folder (Local models only)" }),
    ).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("can be turned off in Settings → AI", () => {
    useConfig.setState({
      config: { ...DEFAULT_CONFIG, ai: { ...DEFAULT_CONFIG.ai, titleButton: false } },
    });
    const { container } = render(<NoteAiAccess path="School/Bio.md" />);
    expect(container).toBeEmptyDOMElement();
  });
});
