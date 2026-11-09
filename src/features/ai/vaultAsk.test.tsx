import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { AskAi } from "./AskAi";
import { citeOf, citesPassage, passageSummary } from "./vaultAsk";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend, followLink: vi.fn() }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});
vi.mock("../commands/actions", async (orig) => ({
  ...(await orig<typeof import("../commands/actions")>()),
  followLink: h.followLink,
}));

let sent: AiRunRequest[] = [];

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axisnotes/config.json": JSON.stringify({
      ai: { folders: { Lab: "local", Medical: "never" } },
    }),
    "School/Bio.md": "# Bio\nMitochondria make ATP.",
    "Lab/Run.md": "Mitochondria results from the lab.",
    "Medical/Scan.md": "Mitochondria scan.",
    "Cooking.md": "Pasta.",
  });
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  sent = [];
  const run = h.b.aiRun.bind(h.b);
  h.b.aiRun = (id, req, onDelta) => {
    sent.push(structuredClone(req));
    return run(id, req, onDelta);
  };
  await useConfig.getState().load();
  useAppStore.setState({ vault: { root: "/v", name: "v" }, notice: null, error: null });
  h.followLink.mockReset();
});

afterEach(() => setAiResponder(null));

function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Question"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
}

describe("citations", () => {
  const passages = [
    { path: "School/Bio.md", heading: "Energy" },
    { path: "Cooking.md", heading: null },
  ];

  it("cite passages the way the Rust layer does", () => {
    expect(passages.map(citeOf)).toEqual(["School/Bio#Energy", "Cooking"]);
    expect(passageSummary(passages)).toBe("2 passages from 2 notes");
  });

  it("recognise links to passages that were sent, by path or note name", () => {
    for (const ok of ["School/Bio#Energy", "Bio#energy", "Bio", "school/bio.md", "Cooking|food"])
      expect(citesPassage(ok, passages), ok).toBe(true);
    for (const bad of ["Bio#Cells", "Nowhere", "Other/Bio#Energy", "Cook"])
      expect(citesPassage(bad, passages), bad).toBe(false);
  });
});

describe("Ask your vault", () => {
  it("sends the matching passages the rules allow, lists sources and marks made-up citations", async () => {
    setAiResponder(() => "Cells use it [[School/Bio]]. Also [[Nowhere#Made up]].");
    const onClose = vi.fn();
    render(<AskAi vault onClose={onClose} />);
    expect(screen.getByText("Ask your vault")).toBeInTheDocument();
    ask("Where do mitochondria work?");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.passages).toEqual([{ path: "School/Bio.md", heading: null }]);
    expect(sent[0]!.attach).toEqual([]);
    expect(await screen.findByLabelText("Passages sent")).toHaveTextContent(
      "Using 1 passage from 1 note · 2 notes left out by AI rules",
    );
    const answer = await screen.findByLabelText("Answer");
    await waitFor(() => expect(answer).toHaveTextContent("Made up"));
    expect(answer.querySelector(".cite-unknown")).toHaveTextContent("Nowhere › Made up");
    expect(answer.querySelectorAll(".inline-wikilink")).toHaveLength(1);
    fireEvent.click(within(screen.getByLabelText("Sources")).getByRole("button", { name: "Bio" }));
    expect(onClose).toHaveBeenCalled();
    expect(h.followLink).toHaveBeenCalledWith("School/Bio", "");
  });

  it("uses local-only notes only when asked, and holds follow-ups to their rule", async () => {
    render(<AskAi vault onClose={() => {}} />);
    fireEvent.click(screen.getByLabelText("Include local-only notes"));
    ask("mitochondria");
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.passages!.map((p) => p.path).sort()).toEqual(["Lab/Run.md", "School/Bio.md"]);
    expect(sent[0]!.atLeast).toBeUndefined();
    await screen.findByRole("button", { name: /New question/ });
    expect(screen.getByLabelText("Include local-only notes")).toBeDisabled();
    // The follow-up only finds an open note, but its history came from a local-only one.
    ask("And pasta?");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]!.passages).toEqual([{ path: "Cooking.md", heading: null }]);
    expect(sent[1]!.atLeast).toBe("local");
  });

  it("says when nothing matches, without sending anything", async () => {
    render(<AskAi vault onClose={() => {}} />);
    ask("quantum chromodynamics");
    expect(await screen.findByRole("alert")).toHaveTextContent("No notes match this question");
    ask("scan");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Only notes the AI may not read (1) match this question.",
    );
    expect(sent).toHaveLength(0);
  });
});
