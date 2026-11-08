import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { AskAi } from "./AskAi";
import { AllowedModels } from "./AllowedModels";
import { raiseNoteRule } from "./keepPrivacy";
import { folderScope } from "./folderScope";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axisnotes/config.json": JSON.stringify({ ai: { folders: { Lab: "local" } } }),
    "Lab/run.md": "# Run\nSecret results.",
    "School/Bio.md": "# Bio\nMitochondria.",
    "School/Summary.md": "---\nai-access: never\n---\nFrom a private note.",
  });
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  await useConfig.getState().load();
  useAppStore.setState({ notice: null, error: null });
});

function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Question"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
}

const drafts = () =>
  Object.entries(h.b.files()).filter(([p]) => p.startsWith(".axisnotes/drafts/"));

describe("AI output keeps its sources' privacy", () => {
  it("marks a draft made from a local-only note", async () => {
    render(<AskAi path="Lab/run.md" onClose={() => {}} />);
    ask("Summarize");
    fireEvent.click(await screen.findByRole("button", { name: /Open as draft/ }));
    await waitFor(() => expect(drafts()).toHaveLength(1));
    expect(drafts()[0]![1]).toMatch(/^---\nai-access: local\n---\nEcho from Ollama/);
  });

  it("leaves a draft from an open note unmarked", async () => {
    render(<AskAi path="School/Bio.md" onClose={() => {}} />);
    ask("Summarize");
    fireEvent.click(await screen.findByRole("button", { name: /Open as draft/ }));
    await waitFor(() => expect(drafts()).toHaveLength(1));
    expect(drafts()[0]![1]).not.toContain("ai-access");
  });

  it("raises an open note that receives stricter output, and says so", async () => {
    expect(await raiseNoteRule("School/Bio.md", "local")).toBe(true);
    expect(h.b.files()["School/Bio.md"]).toBe("---\nai-access: local\n---\n# Bio\nMitochondria.");
    expect(useAppStore.getState().notice).toMatch(/ai-access: local/);
    // Already that strict (by its folder, or its own mark): unchanged.
    expect(await raiseNoteRule("Lab/run.md", "local")).toBe(false);
    expect(await raiseNoteRule("School/Summary.md", "local")).toBe(false);
    expect(await raiseNoteRule("School/Bio.md", "any")).toBe(false);
    expect(h.b.files()["Lab/run.md"]).toBe("# Run\nSecret results.");
  });

  it("leaves marked notes out of a folder question", async () => {
    const notes = await h.b.listNotes();
    expect(notes.find((n) => n.path === "School/Summary.md")?.aiAccess).toBe("never");
    const scope = folderScope(notes, "School", true, {});
    expect(scope.include).toEqual(["School/Bio.md"]);
    expect(scope.never).toEqual(["School/Summary.md"]);
  });
});

describe("Allowed models", () => {
  it("saves the ticked models for a folder, and can lift the limit", async () => {
    const onClose = vi.fn();
    const { unmount } = render(<AllowedModels path="Lab" onClose={onClose} />);
    fireEvent.click(await screen.findByLabelText("Any Ollama model"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(useConfig.getState().config.ai.models).toEqual({ Lab: ["ollama/*"] }),
    );
    const saved = JSON.parse(h.b.files()[".axisnotes/config.json"]!) as {
      ai: { models: Record<string, string[]> };
    };
    expect(saved.ai.models.Lab).toEqual(["ollama/*"]);
    expect(onClose).toHaveBeenCalled();
    unmount();
    render(<AllowedModels path="Lab" onClose={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Allow any model" }));
    await waitFor(() => expect(useConfig.getState().config.ai.models).toEqual({}));
  });
});
