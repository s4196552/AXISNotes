import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import type { AiRunRequest } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { AskAi } from "./AskAi";
import { AnswerText } from "./AnswerText";
import { aiBlocks, discardParkedBlocks, openAiBlock } from "./aiBlock";
import { clearModelCache, useAiBlocks } from "./aiBlockStore";
import { allTurns, conversationMarkdown, type Turn, withHistory } from "./conversation";

const h = vi.hoisted(() => ({
  b: null as unknown as MemoryBackend,
  followLink: vi.fn(),
}));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});
vi.mock("../commands/actions", async (orig) => ({
  ...(await orig<typeof import("../commands/actions")>()),
  followLink: h.followLink,
}));

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

/** Every request the AI layer was asked to run. */
let sent: AiRunRequest[] = [];
let view: EditorView | null = null;

beforeEach(async () => {
  h.b = createMemoryBackend({
    "School/Bio.md": "# Bio\nMitochondria.",
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
  clearModelCache();
  h.followLink.mockReset();
});

afterEach(() => {
  view?.destroy();
  view = null;
  discardParkedBlocks();
  useAiBlocks.setState({ blocks: {} });
});

const texts = (req: AiRunRequest) =>
  req.messages
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role}: ${m.content.map((p) => (p.type === "text" ? p.text : "")).join("")}`);

describe("conversation history", () => {
  const turns: Turn[] = allTurns(allTurns([], "First?", "One."), "Second?", "Two.");

  it("sends earlier exchanges before the new question, with the selection on the first", () => {
    const { messages, dropped } = withHistory(turns, "Third?", "Sel: ");
    expect(dropped).toBe(0);
    expect(
      messages.map((m) => [m.role, m.content[0]!.type === "text" && m.content[0]!.text]),
    ).toEqual([
      ["user", "Sel: First?"],
      ["assistant", "One."],
      ["user", "Second?"],
      ["assistant", "Two."],
      ["user", "Third?"],
    ]);
  });

  it("drops whole exchanges, oldest first, to stay within the budget", () => {
    const long: Turn[] = allTurns(allTurns([], "Old?", "x".repeat(4000)), "New?", "Short.");
    const { messages, dropped } = withHistory(long, "Now?", "Sel: ", 100);
    expect(dropped).toBe(2);
    expect(messages.map((m) => m.content[0]!.type === "text" && m.content[0]!.text)).toEqual([
      "Sel: New?",
      "Short.",
      "Now?",
    ]);
  });

  it("writes a conversation as Markdown", () => {
    expect(conversationMarkdown("Cells", turns)).toBe(
      "# Cells\n\n**Me:** First?\n\n**AI:** One.\n\n**Me:** Second?\n\n**AI:** Two.\n",
    );
    expect(allTurns(turns, "", "")).toBe(turns);
  });
});

describe("answers", () => {
  it("render Markdown safely, with clickable [[links]]", () => {
    const onFollow = vi.fn();
    const { container } = render(
      <AnswerText
        text={"## Cells\n- See [[Bio#Energy]]\n<b>not bold</b> and **bold**\n```\ncode()\n```"}
        from="School/Bio.md"
        onFollow={onFollow}
      />,
    );
    expect(container.querySelector("b")).toBeNull();
    expect(screen.getByText("<b>not bold</b> and", { exact: false })).toBeInTheDocument();
    expect(container.querySelector("strong")).toHaveTextContent("bold");
    expect(container.querySelector("pre")).toHaveTextContent("code()");
    fireEvent.click(container.querySelector(".inline-wikilink")!);
    expect(h.followLink).toHaveBeenCalledWith("Bio#Energy", "School/Bio.md", { newTab: false });
    expect(onFollow).toHaveBeenCalled();
  });
});

function ask(question: string) {
  fireEvent.change(screen.getByLabelText("Question"), { target: { value: question } });
  fireEvent.click(screen.getByRole("button", { name: /Ask/ }));
}

describe("Ask AI follow-ups", () => {
  it("keeps the conversation, locks what it reads and can save or restart it", async () => {
    const onClose = vi.fn();
    render(<AskAi path="School/Bio.md" onClose={onClose} />);
    ask("What makes ATP?");
    await waitFor(() =>
      expect(screen.getByLabelText("Answer")).toHaveTextContent(
        "Echo from Ollama: What makes ATP?",
      ),
    );
    expect(screen.getByLabelText("Question")).toHaveValue("");
    expect(screen.getByLabelText("Question")).toHaveAttribute("placeholder", "Ask a follow-up…");
    expect(screen.getByLabelText(/Include note/)).toBeDisabled();

    ask("Where?");
    await waitFor(() =>
      expect(screen.getByLabelText("Answer")).toHaveTextContent("Echo from Ollama: Where?"),
    );
    expect(texts(sent[1]!).slice(-3)).toEqual([
      "user: What makes ATP?",
      "assistant: Echo from Ollama: What makes ATP?",
      "user: Where?",
    ]);
    expect(sent[1]!.attach).toEqual(["School/Bio.md"]);
    expect(screen.getByLabelText("Earlier in this conversation")).toHaveTextContent(
      "What makes ATP?",
    );

    fireEvent.click(screen.getByRole("button", { name: /Save conversation/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const draft = Object.entries(h.b.files()).find(([p]) => p.startsWith(".axisnotes/drafts/"));
    expect(draft![1]).toBe(
      "# What makes ATP?\n\n**Me:** What makes ATP?\n\n**AI:** Echo from Ollama: What makes ATP?\n\n**Me:** Where?\n\n**AI:** Echo from Ollama: Where?\n",
    );
  });

  it("starts over with New question", async () => {
    render(<AskAi path="School/Bio.md" onClose={() => {}} />);
    ask("One?");
    fireEvent.click(await screen.findByRole("button", { name: /New question/ }));
    expect(screen.getByLabelText(/Include note/)).not.toBeDisabled();
    expect(screen.queryByLabelText("Answer")).toBeNull();
    ask("Two?");
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(texts(sent[1]!)).toEqual(["user: Two?"]);
  });
});

describe("AI block follow-ups", () => {
  function mount(doc: string, path: string, cursor: number) {
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: aiBlocks(path) }),
    });
    return view;
  }

  it("sends the conversation with a follow-up, and Retry asks the last question again", async () => {
    const v = mount("# Bio\n\n", "School/Bio.md", 7);
    act(() => void openAiBlock(v));
    const block = await screen.findByRole("group", { name: "AI block" });
    const prompt = () => within(block).getByLabelText("AI prompt");
    fireEvent.change(prompt(), { target: { value: "First?" } });
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    await waitFor(() =>
      expect(within(block).getByLabelText("Answer")).toHaveTextContent("Echo from Ollama: First?"),
    );
    expect(prompt()).toHaveValue("");
    expect(within(block).getByRole("button", { name: /Reads: Bio/ })).toBeDisabled();

    fireEvent.change(prompt(), { target: { value: "Second?" } });
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    await waitFor(() =>
      expect(within(block).getByLabelText("Answer")).toHaveTextContent("Echo from Ollama: Second?"),
    );
    expect(texts(sent[1]!)).toEqual([
      "user: First?",
      "assistant: Echo from Ollama: First?",
      "user: Second?",
    ]);
    expect(within(block).getByLabelText("Conversation")).toHaveTextContent("First?");

    fireEvent.click(within(block).getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(sent).toHaveLength(3));
    expect(texts(sent[2]!)).toEqual(texts(sent[1]!));

    // Insert keeps only the latest answer.
    await within(block).findByRole("button", { name: "Insert" });
    fireEvent.click(within(block).getByRole("button", { name: "Insert" }));
    expect(v.state.doc.toString()).toBe("# Bio\n\nEcho from Ollama: Second?");
  });
});
