import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { NoteRef } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { AskAi } from "./AskAi";
import { folderScope, MAX_FOLDER_NOTES, ruleForPath } from "./folderScope";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const ref = (path: string): NoteRef => ({
  path,
  name: path.slice(path.lastIndexOf("/") + 1, -3),
  title: null,
  aliases: [],
});

const NOTES = [
  "School/Bio.md",
  "School/Chem.md",
  "School/Private/Grades.md",
  "School/Lab/Week1.md",
  "Medical/scan.md",
  "Top.md",
].map(ref);
const RULES = { "School/Private": "never", "School/Lab": "local" } as const;

describe("folderScope", () => {
  it("uses the nearest rule, like the Rust layer", () => {
    expect(ruleForPath(RULES, "School/Private/Grades.md")).toBe("never");
    expect(ruleForPath(RULES, "School/Lab/Week1.md")).toBe("local");
    expect(ruleForPath(RULES, "School/Bio.md")).toBe("any");
  });

  it("takes the folder's own notes, or its subfolders too, and leaves out 'never' notes", () => {
    expect(folderScope(NOTES, "School", false, RULES)).toEqual({
      include: ["School/Bio.md", "School/Chem.md"],
      never: [],
      overLimit: 0,
      rule: "any",
    });
    expect(folderScope(NOTES, "School", true, RULES)).toEqual({
      include: ["School/Bio.md", "School/Chem.md", "School/Lab/Week1.md"],
      never: ["School/Private/Grades.md"],
      overLimit: 0,
      rule: "local",
    });
    expect(folderScope(NOTES, "", false, RULES).include).toEqual(["Top.md"]);
  });

  it("caps the number of notes", () => {
    const many = Array.from({ length: MAX_FOLDER_NOTES + 5 }, (_, i) => ref(`F/n${i}.md`));
    const s = folderScope(many, "F", false, {});
    expect(s.include).toHaveLength(MAX_FOLDER_NOTES);
    expect(s.overLimit).toBe(5);
  });
});

describe("Ask AI about a folder", () => {
  beforeEach(async () => {
    h.b = createMemoryBackend({
      ".axisnotes/config.json": JSON.stringify({ ai: { folders: RULES } }),
      "School/Bio.md": "Mitochondria.",
      "School/Chem.md": "Atoms.",
      "School/Private/Grades.md": "A+",
      "School/Lab/Week1.md": "Titration.",
    });
    await h.b.openVault("/v");
    const { settings } = await h.b.aiSettings();
    await h.b.aiSaveSettings({
      ...settings,
      providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
    });
    useAppStore.setState({ notes: NOTES, notice: null, error: null });
    useConfig.setState((s) => ({ config: { ...s.config, ai: { folders: { ...RULES } } } }));
  });

  it("sends the folder's notes, lists left-out ones and saves the answer as a note", async () => {
    render(<AskAi folder="School" onClose={() => {}} />);
    expect(screen.getByLabelText(/Include 2 notes in “School”/)).toBeChecked();
    fireEvent.click(screen.getByLabelText("Subfolders"));
    expect(screen.getByLabelText(/Include 3 notes in “School”/)).toBeChecked();
    expect(screen.getByLabelText("Left out")).toHaveTextContent(
      "1 note marked “AI: never” left out.",
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Destination")).toHaveTextContent("Local-only notes"),
    );

    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Summarise" } });
    fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
    expect(await screen.findByText(/Answered by Ollama/)).toBeInTheDocument();
    expect((await h.b.aiLog())[0]).toMatchObject({ status: "ok", sources: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Save as a note here" }));
    await waitFor(() =>
      expect(h.b.files()["School/AI answer.md"]).toBe("Echo from Ollama: Summarise\n"),
    );
  });
});
