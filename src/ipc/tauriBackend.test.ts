import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the window calls are faked; the rest of the Tauri API isn't touched by these tests.
const calls: string[] = [];
vi.mock("@tauri-apps/api/window", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/window")>()),
  getCurrentWindow: () => ({
    clearEffects: async () => void calls.push("clear"),
    setEffects: async (e: { effects: string[] }) => void calls.push(`set ${e.effects.join()}`),
  }),
}));

const { createTauriBackend } = await import("./tauriBackend");

beforeEach(() => {
  calls.length = 0;
});

describe("window effects on the desktop app", () => {
  it("clear the previous material before applying another (Tauri layers them otherwise)", async () => {
    const backend = createTauriBackend();
    await backend.setWindowEffect("mica");
    await backend.setWindowEffect("blur");
    await backend.setWindowEffect(null);
    expect(calls).toEqual(["clear", "set mica", "clear", "set blur", "clear"]);
  });
});
