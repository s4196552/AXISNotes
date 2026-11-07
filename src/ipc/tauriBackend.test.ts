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

// Windows-style URLs from convertFileSrc; `current_vault` reports an open vault.
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string, protocol = "asset") =>
    `http://${protocol}.localhost/${encodeURIComponent(path)}`,
  invoke: async (cmd: string) =>
    cmd === "current_vault" ? { root: "C:\\Vault", name: "Vault" } : null,
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

describe("vault web pages", () => {
  it("are served by the page protocol, one URL segment per folder", async () => {
    const backend = createTauriBackend();
    expect(backend.pageUrl("Bio/Quiz.html")).toBeNull(); // no vault yet
    await backend.currentVault();
    expect(backend.pageUrl("Bio/Lesson 1 - Cells#?.html")).toBe(
      "http://axispage.localhost/Bio/Lesson%201%20-%20Cells%23%3F.html",
    );
    expect(backend.pageUrl(".axisnotes/drafts/Quiz.HTM")).toBe(
      "http://axispage.localhost/.axisnotes/drafts/Quiz.HTM",
    );
    expect(backend.pageUrl("Bio/Cells.md")).toBeNull();
  });
});
