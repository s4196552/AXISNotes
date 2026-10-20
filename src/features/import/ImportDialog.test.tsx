import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { ImportPreview, ImportReport } from "../../ipc";
import { useConfig } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { ImportDialog } from "./ImportDialog";
import { countsText, SOURCES } from "./sources";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const today = formatDate(new Date(), "YYYY-MM-DD");

const PREVIEW: ImportPreview = {
  name: "Old Vault",
  notes: 12,
  attachments: 3,
  tables: 0,
  canvases: 1,
  looksLike: null,
  warnings: [],
};

const REPORT: ImportReport = {
  target: "Imported/Obsidian 2026-10-20",
  notes: 12,
  attachments: 3,
  canvases: 1,
  tables: 0,
  links: 0,
  skipped: [{ path: "Home.md", reason: "already exists in the vault" }],
  warnings: [],
  settings: {
    templatesFolder: "Imported/Obsidian 2026-10-20/Templates",
    dailyFolder: "Imported/Obsidian 2026-10-20/Journal",
    dailyFormat: "YYYY-MM-DD",
    dailyTemplate: "Imported/Obsidian 2026-10-20/Templates/Daily.md",
  },
};

beforeEach(async () => {
  h.b = createMemoryBackend({ "Welcome.md": "" });
  await h.b.openVault("/v");
  h.b.pickFolder = async () => "C:/Users/me/Old Vault";
  h.b.pickImportFile = async () => "C:/Users/me/Downloads/Export-abc.zip";
  useConfig.setState({ config: useConfig.getState().config });
});

describe("Import notes", () => {
  it("lists each app with how to export from it", () => {
    render(<ImportDialog onClose={vi.fn()} />);
    const list = screen.getByRole("list", { name: "Import from" });
    for (const s of SOURCES) expect(within(list).getByText(s.name)).toBeInTheDocument();
    expect(within(list).getByText(/Markdown & CSV/)).toBeInTheDocument();
    expect(within(list).getByText(/Export notebook… as ENEX/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notion: Choose .zip…" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Notion: Unzipped folder…" })).toBeInTheDocument();
  });

  it("imports an Obsidian vault into a dated folder and offers its settings", async () => {
    const importNotes = vi.fn(async () => REPORT);
    h.b.importNotes = importNotes;
    h.b.inspectImport = async () => PREVIEW;
    const onClose = vi.fn();
    render(<ImportDialog onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Obsidian: Choose vault folder…" }));
    expect(await screen.findByText("· 12 notes, 3 attachments and 1 canvas")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveAccessibleName("Import notes");
    expect(screen.getByText("Import from Obsidian")).toBeInTheDocument();
    expect(screen.getByLabelText("Import into folder")).toHaveValue(`Imported/Obsidian ${today}`);
    expect(screen.queryByLabelText("Databases as")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    const result = await screen.findByRole("status", { name: "Import result" });
    expect(result).toHaveTextContent(
      "Imported 12 notes, 3 attachments and 1 canvas into “Imported/Obsidian 2026-10-20”.",
    );
    expect(result).toHaveTextContent("1 file skipped");
    expect(importNotes).toHaveBeenCalledWith(
      "obsidian",
      "C:/Users/me/Old Vault",
      `Imported/Obsidian ${today}`,
      { tablesAsMarkdown: false },
      expect.any(Function),
    );

    fireEvent.click(screen.getByLabelText(/as the templates folder/)); // keep ours
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalled();
    await waitFor(() =>
      expect(useConfig.getState().config.dailyNotes).toMatchObject({
        folder: "Imported/Obsidian 2026-10-20/Journal",
        template: "Imported/Obsidian 2026-10-20/Templates/Daily.md",
      }),
    );
    expect(useConfig.getState().config.templatesFolder).toBe("Templates");
  });

  it("imports a Notion zip, with databases as Markdown tables if chosen", async () => {
    const pickImportFile = vi.fn(async () => "C:/Users/me/Downloads/Export-abc.zip");
    h.b.pickImportFile = pickImportFile;
    const inspect = vi.fn(h.b.inspectImport);
    h.b.inspectImport = inspect;
    render(<ImportDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Notion: Choose .zip…" }));
    await screen.findByText("Import from Notion");
    expect(pickImportFile).toHaveBeenCalledWith("Notion export", ["zip"]);
    expect(inspect).toHaveBeenCalledWith("notion", "C:/Users/me/Downloads/Export-abc.zip");
    expect(screen.getByText("· 2 notes and 1 database")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Databases as"), { target: { value: "markdown" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    const result = await screen.findByRole("status", { name: "Import result" });
    const folder = `Imported/Notion ${today}`;
    expect(result).toHaveTextContent(`into “${folder}”. 1 link updated.`);
    expect((await h.b.readFile(`${folder}/Tasks.md`)).content).toContain("| Write | Done |");
    expect((await h.b.readFile(`${folder}/From Notion.md`)).content).toContain(
      `[[${folder}/Second note|the second note]]`,
    );
  });

  it("never reuses a folder: a second import gets its own", async () => {
    render(<ImportDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Evernote: Choose .enex…" }));
    fireEvent.change(await screen.findByLabelText("Import into folder"), {
      target: { value: "Welcome.md" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("status", { name: "Import result" })).toHaveTextContent(
      "into “Welcome.md 2”",
    );
    expect((await h.b.readFile("Welcome.md")).content).toBe("");
  });

  it("shows progress while importing", async () => {
    let finish!: (r: ImportReport) => void;
    h.b.importNotes = (_k, _s, _t, _o, onProgress) =>
      new Promise((resolve) => {
        onProgress?.({ done: 40, total: 120 });
        finish = resolve;
      });
    render(<ImportDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Markdown or HTML: Choose folder…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const progress = await screen.findByRole("status", { name: "Import progress" });
    expect(progress).toHaveTextContent("Importing 40 of 120 files…");
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    finish(REPORT);
    expect(await screen.findByRole("status", { name: "Import result" })).toBeInTheDocument();
  });

  it("suggests the right app and shows warnings and errors", async () => {
    h.b.inspectImport = async (kind) => ({
      ...PREVIEW,
      looksLike: kind === "markdown" ? "notion" : null,
      warnings: kind === "markdown" ? ["No notes found here."] : [],
    });
    render(<ImportDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Markdown or HTML: Choose .zip…" }));
    expect(await screen.findByRole("note")).toHaveTextContent("This looks like a Notion export.");
    expect(screen.getByRole("list", { name: "Warnings" })).toHaveTextContent("No notes found");
    fireEvent.click(screen.getByRole("button", { name: "Import it as Notion instead" }));
    expect(await screen.findByText("Import from Notion")).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();

    h.b.importNotes = async () => {
      throw { code: "InvalidName", message: "invalid name: a:b" };
    };
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid name: a:b");
  });

  it("describes counts", () => {
    expect(countsText({ notes: 1, attachments: 0, tables: 0, canvases: 0 })).toBe("1 note");
    expect(countsText({ notes: 0, attachments: 2, tables: 1, canvases: 2 })).toBe(
      "0 notes, 2 attachments, 1 database and 2 canvases",
    );
  });
});
