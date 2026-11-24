import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../ipc/memoryBackend";
import {
  CONFIG_BACKUP_PATH,
  CONFIG_PATH,
  DEFAULT_CONFIG,
  setConfigWriteDelay,
  useConfig,
} from "./config";
import { ConfigProblemBanner } from "../features/settings/ConfigProblemBanner";

// T-278: a settings file that can't be read is never replaced by the defaults (it holds the
// AI privacy rules), changes in quick succession are saved once, and failed saves show.

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../ipc", async (orig) => {
  const mod = await orig<typeof import("../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const privacy = JSON.stringify({ ai: { folders: { Medical: "never" } }, theme: "dark" });

beforeEach(async () => {
  h.b = createMemoryBackend({});
  await h.b.openVault("/v");
  useConfig.setState({ config: structuredClone(DEFAULT_CONFIG), loaded: false, problem: null });
});
afterEach(async () => {
  await useConfig.getState().flush();
  setConfigWriteDelay(0);
  vi.restoreAllMocks();
});

const file = async (path = CONFIG_PATH) => (await h.b.readFile(path)).content;

describe("a settings file that can't be read (T-278)", () => {
  it("is kept, backed up, and never overwritten by changes", async () => {
    const broken = privacy.slice(0, -1); // a typo: the closing brace is missing
    await h.b.writeFile(CONFIG_PATH, broken);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await useConfig.getState().load();
    const s = useConfig.getState();
    expect(s.loaded).toBe(true);
    expect(s.config).toEqual(DEFAULT_CONFIG);
    expect(s.problem).toMatchObject({ kind: "broken" });
    expect(s.problem!.message).toMatch(/won't save changes until it's fixed/);
    expect(await file(CONFIG_BACKUP_PATH)).toBe(broken);

    const write = vi.spyOn(h.b, "writeFile");
    await useConfig.getState().update((c) => ({ ...c, theme: "light" }));
    await useConfig.getState().flush();
    expect(useConfig.getState().config.theme).toBe("light");
    expect(write).not.toHaveBeenCalled();
    expect(await file()).toBe(broken);
  });

  it("shows a banner: Try again reloads a fixed file, Use defaults replaces it after asking", async () => {
    await h.b.writeFile(CONFIG_PATH, "{ nope");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await useConfig.getState().load();
    render(<ConfigProblemBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't be read/);
    expect(screen.getByRole("alert")).toHaveTextContent(CONFIG_BACKUP_PATH);

    // Fixed by hand, then Try again: the user's settings, with their privacy rules.
    await h.b.writeFile(CONFIG_PATH, privacy);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(useConfig.getState().problem).toBeNull());
    expect(useConfig.getState().config.ai.folders).toEqual({ Medical: "never" });
    expect(screen.queryByRole("alert")).toBeNull();

    // Broken again; Use defaults asks first.
    await h.b.writeFile(CONFIG_PATH, "{ nope");
    await useConfig.getState().load();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(await screen.findByRole("button", { name: "Use defaults" }));
    expect(await file()).toBe("{ nope");
    confirm.mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Use defaults" }));
    await waitFor(async () => expect(JSON.parse(await file())).toEqual(DEFAULT_CONFIG));
    expect(useConfig.getState().problem).toBeNull();
    expect(await file(CONFIG_BACKUP_PATH)).toBe("{ nope");
  });

  it("uses the defaults without a banner when there is no settings file yet", async () => {
    await useConfig.getState().load();
    expect(useConfig.getState()).toMatchObject({ loaded: true, problem: null });
    await useConfig.getState().update((c) => ({ ...c, theme: "dark" }));
    expect(JSON.parse(await file()).theme).toBe("dark");
  });
});

describe("saving settings (T-278)", () => {
  it("saves changes in quick succession once, with the last value", async () => {
    setConfigWriteDelay(40);
    const write = vi.spyOn(h.b, "writeFile");
    const saves = [14, 15, 16, 17, 18].map((noteFontSize) =>
      useConfig.getState().update((c) => ({ ...c, appearance: { ...c.appearance, noteFontSize } })),
    );
    // The change shows at once; the file follows.
    expect(useConfig.getState().config.appearance.noteFontSize).toBe(18);
    expect(write).not.toHaveBeenCalled();
    await Promise.all(saves);
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await file()).appearance.noteFontSize).toBe(18);
  });

  it("saves a waiting change at once when flushed (closing, switching vaults)", async () => {
    setConfigWriteDelay(60_000);
    void useConfig.getState().update((c) => ({ ...c, theme: "dark" }));
    await useConfig.getState().flush();
    expect(JSON.parse(await file()).theme).toBe("dark");
  });

  it("shows a failed save instead of losing it silently, and clears once a save works", async () => {
    vi.spyOn(h.b, "writeFile").mockRejectedValueOnce(new Error("Disk full"));
    // Resolves (callers use `void update(...)`); the problem is shown instead.
    await useConfig.getState().update((c) => ({ ...c, theme: "dark" }));
    expect(useConfig.getState().problem).toEqual({
      kind: "write",
      message: "Settings couldn't be saved: Disk full",
    });
    render(<ConfigProblemBanner />);
    expect(screen.queryByRole("button", { name: "Use defaults" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(useConfig.getState().problem).toBeNull());
    expect(JSON.parse(await file()).theme).toBe("dark");
  });
});
