import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { AskAi } from "./AskAi";
import type { AiPlan } from "../../ipc";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axisnotes/config.json": JSON.stringify({ ai: { folders: { Medical: "never" } } }),
    "School/Bio.md": "# Bio\nMitochondria.",
    "Medical/scan.md": "private",
  });
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  useAppStore.setState({ notice: null, error: null });
});

function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Question"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
}

describe("Ask AI", () => {
  it("shows where the request goes, streams the answer and appends it to the note", async () => {
    const onClose = vi.fn();
    render(<AskAi path="School/Bio.md" onClose={onClose} />);
    expect(screen.getByLabelText(/Include note “Bio”/)).toBeChecked();
    await waitFor(() =>
      expect(screen.getByLabelText("Destination")).toHaveTextContent("→ Ollama · llama3.3"),
    );
    expect(screen.getByLabelText("On this device")).toBeInTheDocument();

    ask("What makes ATP?");
    await waitFor(() =>
      expect(screen.getByLabelText("Answer")).toHaveTextContent(
        "Echo from Ollama: What makes ATP?",
      ),
    );
    expect(
      await screen.findByText(/Answered by Ollama · llama3.3 \(on this device\)/),
    ).toBeInTheDocument();
    const log = await h.b.aiLog();
    expect(log[0]).toMatchObject({ status: "ok", sources: 1 });

    fireEvent.click(screen.getByRole("button", { name: "Append to note" }));
    await waitFor(() =>
      expect(h.b.files()["School/Bio.md"]).toBe(
        "# Bio\nMitochondria.\n\nEcho from Ollama: What makes ATP?\n",
      ),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("refuses notes from an 'AI: never' folder before sending", async () => {
    render(<AskAi path="Medical/scan.md" onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByLabelText("Destination")).toHaveTextContent('marked "AI: never"'),
    );
    ask("Summarize");
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Not sent: .*AI: never/);
    expect((await h.b.aiLog())[0]!.status).toBe("blocked");
    // Without the note it's fine.
    fireEvent.click(screen.getByLabelText(/Include note/));
    ask("Summarize");
    await waitFor(() => expect(screen.getByLabelText("Answer")).toHaveTextContent("Echo"));
  });

  it("asks before sending large requests", async () => {
    const { settings } = await h.b.aiSettings();
    await h.b.aiSaveSettings({ ...settings, confirmAboveTokens: 5 });
    render(<AskAi onClose={() => {}} />);
    ask("A question long enough to cross the tiny threshold");
    expect(await screen.findByRole("alert")).toHaveTextContent(/input tokens.*Send it to Ollama\?/);
    expect(screen.queryByLabelText("Answer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByLabelText("Answer")).toHaveTextContent("Echo"));
  });

  it("includes a selection as quoted context", async () => {
    render(<AskAi path="School/Bio.md" selection="Mitochondria." onClose={() => {}} />);
    expect(screen.getByLabelText("Include selection")).toBeChecked();
    expect(screen.getByLabelText(/Include note/)).not.toBeChecked();
    ask("Explain");
    await waitFor(() =>
      expect(screen.getByLabelText("Answer")).toHaveTextContent(
        'Selected text: """ Mitochondria. """',
      ),
    );
  });
});

it("does not send old note context when a pending plan completes in another vault", async () => {
  useAppStore.setState({ vault: { root: "/v", name: "v" } });
  render(<AskAi path="School/Bio.md" onClose={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText("Destination")).toHaveTextContent("Ollama"));
  const plan = await h.b.aiPlan({ task: "chat", messages: [], attach: ["School/Bio.md"] });
  let resolve!: (value: AiPlan) => void;
  vi.spyOn(h.b, "aiPlan").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const run = vi.spyOn(h.b, "aiRun");
  ask("Summarize this note");
  useAppStore.setState({ vault: { root: "/other", name: "other" } });
  await act(async () => {
    resolve(plan);
  });
  expect(run).not.toHaveBeenCalled();
});

it("cancels a closed dialog without updating React after its window is destroyed", async () => {
  const ui = render(<AskAi onClose={() => {}} />);
  await waitFor(() => expect(screen.getByLabelText("Destination")).toHaveTextContent("Ollama"));
  let resolve!: (value: { text: string }) => void;
  const run = vi.spyOn(h.b, "aiRun").mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r as typeof resolve;
      }),
  );
  const cancel = vi.spyOn(h.b, "aiCancel").mockResolvedValue();
  ask("A pending request");
  await waitFor(() => expect(run).toHaveBeenCalledOnce());
  ui.unmount();
  expect(cancel).toHaveBeenCalledOnce();
  try {
    vi.stubGlobal("window", undefined);
    resolve({ text: "late result" });
    await new Promise((r) => setTimeout(r, 25));
  } finally {
    vi.unstubAllGlobals();
  }
});
