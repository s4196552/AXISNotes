import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { useAppStore } from "../../app/store";
import { applySegments, changeCount, diffForReview, diffLines } from "../../lib/diff";
import { FixText } from "./FixText";
import { fixRequest } from "./fixPrompt";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const LIST = "Buy milk.\nCall Sam.\nBook the dentist.\n";
const NOTE = `# Todo\n\n${LIST}`;
const NUMBERED = "1. Buy milk.\n2. Call Sam.\n3. Book the dentist.\n";
const requests: AiRunRequest[] = [];

beforeEach(async () => {
  h.b = createMemoryBackend({ "Todo.md": NOTE });
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  requests.length = 0;
  setAiResponder((req) => {
    requests.push(req);
    return NUMBERED;
  });
  useAppStore.setState({ notice: null, error: null });
});
afterEach(() => setAiResponder(null));

function open(props: { mode?: "custom"; proposed?: string } = {}) {
  const onClose = vi.fn();
  const from = NOTE.indexOf(LIST);
  render(
    <FixText
      path="Todo.md"
      from={from}
      to={from + LIST.length}
      original={LIST}
      scope="selection"
      onClose={onClose}
      {...props}
    />,
  );
  return onClose;
}

describe("line diff", () => {
  it("groups changed lines and applies only accepted ones", () => {
    const segs = diffLines("a\nb\nc\nd\n", "a\nB\nc\nD\nE\n");
    expect(changeCount(segs)).toBe(2);
    expect(applySegments(segs, new Set())).toBe("a\nB\nc\nD\nE\n");
    expect(applySegments(segs, new Set([1]))).toBe("a\nB\nc\nd\n");
  });

  it("is used for rewrites, while light edits stay word by word", () => {
    // Numbering a list is a few small insertions: still word by word.
    expect(changeCount(diffForReview(LIST, NUMBERED))).toBe(3);
    // A rewrite of most of the text is reviewed line by line.
    const rewrite = diffForReview(
      "Mitochondria make energy.\nThey have two membranes.\n",
      "Cells get most of their ATP from mitochondria.\nEach is wrapped in an inner and outer membrane.\n",
    );
    expect(rewrite).toEqual([
      {
        kind: "change",
        id: 0,
        before: "Mitochondria make energy.\nThey have two membranes.\n",
        after:
          "Cells get most of their ATP from mitochondria.\nEach is wrapped in an inner and outer membrane.\n",
      },
    ]);
    const light = diffForReview("The cat sat on teh mat today.", "The cat sat on the mat today.");
    expect(light).toContainEqual({ kind: "change", id: 0, before: "teh", after: "the" });
  });
});

describe("Edit with AI", () => {
  it("sends the user's instruction and the text to the general model", () => {
    const req = fixRequest(LIST, "custom", "Todo.md", "Make a numbered list");
    expect(req.task).toBe("chat");
    expect(req.sources).toEqual(["Todo.md"]);
    const user = req.messages[1]!.content[0]!;
    expect(user.type === "text" && user.text).toBe(
      `Instruction: Make a numbered list\n\nText:\n${LIST}`,
    );
  });

  it("needs an instruction, then reviews the rewrite change by change", async () => {
    const onClose = open({ mode: "custom" });
    expect(screen.getByText(/Edit with AI/)).toBeInTheDocument();
    const edit = screen.getByRole("button", { name: /Edit$/ });
    expect(edit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Instruction"), {
      target: { value: "Make a numbered list" },
    });
    fireEvent.click(edit);
    const changes = await screen.findAllByRole("button", { name: /^Change/ });
    expect(changes.length).toBeGreaterThan(0);
    expect(requests[0]!.task).toBe("chat");
    // Keep the original for the first change only.
    fireEvent.click(changes[0]!);
    fireEvent.click(screen.getByRole("button", { name: /^Apply/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.b.files()["Todo.md"]).toBe(
      `# Todo\n\n${applySegments(diffForReview(LIST, NUMBERED), new Set([0]))}`,
    );
  });
});

describe("Review AI changes from an AI block", () => {
  it("reviews a proposed replacement without asking a model", async () => {
    const onClose = open({ proposed: NUMBERED });
    expect(screen.getByText(/Review AI changes/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Fix$|^Edit$/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Apply/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(h.b.files()["Todo.md"]).toBe(`# Todo\n\n${NUMBERED}`);
    expect(requests).toHaveLength(0);
  });
});
