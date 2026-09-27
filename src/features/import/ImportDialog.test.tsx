import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { ImportReport } from "../../ipc";
import { useConfig } from "../../app/config";
import { ImportDialog } from "./ImportDialog";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const REPORT: ImportReport = {
  target: "Old Vault",
  notes: 12,
  attachments: 3,
  canvases: 1,
  skipped: [{ path: "Home.md", reason: "already exists in the vault" }],
  settings: {
    templatesFolder: "Old Vault/Templates",
    dailyFolder: "Old Vault/Journal",
    dailyFormat: "YYYY-MM-DD",
    dailyTemplate: "Old Vault/Templates/Daily.md",
  },
};

beforeEach(async () => {
  h.b = createMemoryBackend({ "Welcome.md": "" });
  await h.b.openVault("/v");
  h.b.pickFolder = async () => "C:/Users/me/Old Vault";
  useConfig.setState({ config: useConfig.getState().config });
});

describe("Import from Obsidian", () => {
  it("picks a folder, imports it into a folder named after it, and offers its settings", async () => {
    const importObsidian = vi.fn(async () => REPORT);
    h.b.importObsidian = importObsidian;
    h.b.inspectImport = async () => ({ obsidian: true, name: "Old Vault" });
    const onClose = vi.fn();
    render(<ImportDialog onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose a folder…" }));
    expect(await screen.findByText("· Obsidian vault")).toBeInTheDocument();
    expect(screen.getByLabelText("Import into folder")).toHaveValue("Old Vault");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    const result = await screen.findByRole("status", { name: "Import result" });
    expect(result).toHaveTextContent(
      "Imported 12 notes, 3 attachments and 1 canvas into “Old Vault”.",
    );
    expect(result).toHaveTextContent("1 file skipped");
    expect(importObsidian).toHaveBeenCalledWith("C:/Users/me/Old Vault", "Old Vault");

    fireEvent.click(screen.getByLabelText(/as the templates folder/)); // keep ours
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(useConfig.getState().config.dailyNotes).toMatchObject({
        folder: "Old Vault/Journal",
        template: "Old Vault/Templates/Daily.md",
      }),
    );
    expect(useConfig.getState().config.templatesFolder).toBe("Templates");
  });

  it("warns when the folder isn't an Obsidian vault, and imports into the root", async () => {
    h.b.inspectImport = async () => ({ obsidian: false, name: "Notes" });
    render(<ImportDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Choose a folder…" }));
    expect(await screen.findByText(/no .obsidian folder/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Import into folder"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("status", { name: "Import result" })).toHaveTextContent(
      "Imported 1 note, 0 attachments and 0 canvases.",
    );
    expect((await h.b.readFile("From Obsidian.md")).content).toContain("From Obsidian");
  });
});
