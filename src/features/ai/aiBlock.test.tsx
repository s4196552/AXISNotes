import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { aiBlockField, aiBlocks, insertionFor, openAiBlock } from "./aiBlock";
import { useAiBlocks } from "./aiBlockStore";
import { clearModelCache, promptCallout } from "./aiBlockStore";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeAll(() => {
  const rect = { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  Range.prototype.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
});

let view: EditorView | null = null;

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axisnotes/config.json": JSON.stringify({ ai: { folders: { Journal: "local" } } }),
    "School/Bio.md": "# Bio\n\nMitochondria.\n",
    "Journal/Day.md": "Private day.\n",
  });
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [
      { id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true },
      { id: "openai", kind: "openai", name: "OpenAI", baseUrl: "", enabled: true },
    ],
  });
  await h.b.aiSetKey("openai", "sk-test");
  useAppStore.setState({ vault: { root: "/v", name: "v" } });
  clearModelCache();
  try {
    localStorage.clear();
  } catch {
    /* no storage */
  }
});

afterEach(() => {
  view?.destroy();
  view = null;
  useAiBlocks.setState({ blocks: {} });
});

function mount(doc: string, path: string, cursor: number) {
  const parent = document.createElement("div");
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: cursor }, extensions: aiBlocks(path) }),
  });
  return view;
}

describe("insertionFor", () => {
  it("fills a blank line, else adds a paragraph after the line", () => {
    const blank = EditorState.create({ doc: "a\n\nb" });
    expect(insertionFor(blank, 2, "Answer\n\n")).toEqual({ from: 2, to: 2, insert: "Answer" });
    const text = EditorState.create({ doc: "a\nline\nb" });
    expect(insertionFor(text, 3, "Answer")).toEqual({ from: 6, to: 6, insert: "\n\nAnswer" });
  });

  it("keeps the prompt as a collapsed callout on one line", () => {
    expect(promptCallout("Summarise\nthis")).toBe("> [!ai]- Summarise this\n\n");
  });
});

describe("AI block", () => {
  it("follows edits made above it", () => {
    const v = mount("one\n\nthree", "School/Bio.md", 4);
    act(() => void openAiBlock(v));
    act(() => v.dispatch({ changes: { from: 0, insert: "zero\n" } }));
    expect(v.state.field(aiBlockField)[0]!.pos).toBe(9);
  });

  it("reads the note, streams the answer and inserts it in place of the blank line", async () => {
    const v = mount("# Bio\n\nMitochondria.\n\n", "School/Bio.md", 22);
    act(() => void openAiBlock(v));
    const block = await screen.findByRole("group", { name: "AI block" });
    expect(within(block).getByRole("button", { name: /Reads: Bio/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(within(block).getByLabelText("AI prompt"), {
      target: { value: "What makes ATP?" },
    });
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    await waitFor(() =>
      expect(within(block).getByLabelText("Answer")).toHaveTextContent(
        "Echo from Ollama: What makes ATP?",
      ),
    );
    const log = await h.b.aiLog();
    expect(log[0]).toMatchObject({ status: "ok", sources: 1 });

    fireEvent.click(await within(block).findByRole("button", { name: "Insert" }));
    expect(v.state.doc.toString()).toBe(
      "# Bio\n\nMitochondria.\n\nEcho from Ollama: What makes ATP?",
    );
    expect(v.state.field(aiBlockField)).toEqual([]);
    expect(screen.queryByRole("group", { name: "AI block" })).toBeNull();
  });

  it("uses the chosen model and effort, and remembers them for the vault", async () => {
    const v = mount("Text\n", "School/Bio.md", 0);
    act(() => void openAiBlock(v));
    const block = await screen.findByRole("group", { name: "AI block" });
    fireEvent.click(within(block).getByRole("button", { name: /Model and effort/ }));
    const menu = await screen.findByRole("menu", { name: "Choose a model" });
    fireEvent.click(within(menu).getByRole("button", { name: "Deep" }));
    const openai = await within(menu).findByRole("group", { name: "OpenAI" });
    const first = (await within(openai).findAllByRole("menuitemradio"))[0]!;
    const modelName = first.textContent!;
    fireEvent.click(first);
    expect(within(block).getByRole("button", { name: /Model and effort/ })).toHaveAccessibleName(
      `Model and effort: ${modelName}, Deep`,
    );
    expect(JSON.parse(localStorage.getItem("axis.aiBlock.choice:/v")!)).toMatchObject({
      provider: "openai",
      effort: "deep",
    });

    fireEvent.change(within(block).getByLabelText("AI prompt"), { target: { value: "Hi" } });
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    await within(block).findByText(/Echo from OpenAI: Hi/);
    expect((await h.b.aiLog())[0]).toMatchObject({ provider: "openai" });
  });

  it("greys out cloud models for a local-only note", async () => {
    const v = mount("Private day.\n", "Journal/Day.md", 0);
    act(() => void openAiBlock(v));
    const block = await screen.findByRole("group", { name: "AI block" });
    // Wait for the plan, which carries the note's rule.
    await waitFor(() =>
      expect(within(block).getByLabelText("Destination")).toHaveTextContent(/tokens/),
    );
    fireEvent.click(within(block).getByRole("button", { name: /Model and effort/ }));
    const menu = await screen.findByRole("menu", { name: "Choose a model" });
    const openai = await within(menu).findByRole("group", { name: "OpenAI" });
    expect(within(openai).getByText("This note allows local models only.")).toBeInTheDocument();
    for (const item of await within(openai).findAllByRole("menuitemradio"))
      expect(item).toBeDisabled();
  });

  it("discards with Escape without changing the note", async () => {
    const v = mount("Keep me\n", "School/Bio.md", 0);
    act(() => void openAiBlock(v));
    const block = await screen.findByRole("group", { name: "AI block" });
    fireEvent.change(within(block).getByLabelText("AI prompt"), { target: { value: "x" } });
    fireEvent.keyDown(within(block).getByLabelText("AI prompt"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("group", { name: "AI block" })).toBeNull());
    expect(v.state.doc.toString()).toBe("Keep me\n");
    expect(useAiBlocks.getState().blocks).toEqual({});
  });
});
