import { beforeEach, describe, expect, it, vi } from "vitest";

// Only the window calls are faked; the rest of the Tauri API isn't touched by these tests.
const calls: string[] = [];
let taskbarFails = false;
vi.mock("@tauri-apps/api/image", () => ({
  Image: { new: async () => ({ close: async () => void calls.push("close image") }) },
}));
vi.mock("@tauri-apps/api/window", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/window")>()),
  getCurrentWindow: () => ({
    setIcon: async () => void calls.push("window icon"),
    clearEffects: async () => void calls.push("clear"),
    setEffects: async (e: { effects: string[] }) => void calls.push(`set ${e.effects.join()}`),
  }),
}));

// Windows-style URLs from convertFileSrc; `current_vault` reports an open vault.
vi.mock("@tauri-apps/api/core", async (orig) => ({
  ...(await orig<typeof import("@tauri-apps/api/core")>()),
  convertFileSrc: (path: string, protocol = "asset") =>
    `http://${protocol}.localhost/${encodeURIComponent(path)}`,
  invoke: async (cmd: string, args?: { rgba: number[]; branded: boolean }) => {
    if (cmd === "set_taskbar_icon") {
      calls.push(`taskbar icon ${args?.rgba.length} ${args?.branded ? "branded" : "original"}`);
      if (taskbarFails) throw new Error("Taskbar failure");
    }
    return cmd === "current_vault" ? { root: "C:\\Vault", name: "Vault" } : null;
  },
}));

const { createTauriBackend } = await import("./tauriBackend");

beforeEach(() => {
  calls.length = 0;
  taskbarFails = false;
});

describe("window and taskbar logos", () => {
  it("updates both native icon sizes and releases the temporary image", async () => {
    await createTauriBackend().setWindowIcon(new Array(256 * 256 * 4).fill(0), true);
    expect(calls).toEqual(["window icon", "taskbar icon 262144 branded", "close image"]);
    calls.length = 0;
    await createTauriBackend().setWindowIcon(new Array(256 * 256 * 4).fill(0), false);
    expect(calls[1]).toBe("taskbar icon 262144 original");
  });
  it("releases the image when the taskbar update fails and rejects invalid sizes", async () => {
    taskbarFails = true;
    await expect(
      createTauriBackend().setWindowIcon(new Array(256 * 256 * 4).fill(0), true),
    ).rejects.toThrow("Taskbar failure");
    expect(calls.at(-1)).toBe("close image");
    calls.length = 0;
    await expect(createTauriBackend().setWindowIcon([0], true)).rejects.toThrow(
      "Invalid window icon size",
    );
    expect(calls).toEqual([]);
  });
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
