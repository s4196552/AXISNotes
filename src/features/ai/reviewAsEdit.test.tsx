import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import { useAppStore } from "../../app/store";
import { useUi } from "../commands/ui";
import { aiBlocks, discardParkedBlocks, openAiBlock } from "./aiBlock";
import { clearModelCache, useAiBlocks } from "./aiBlockStore";

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
const DOC = "# Todo\n\nBuy milk.\nCall Sam.\n";

beforeEach(async () => {
  h.b = createMemoryBackend({ "Todo.md": DOC });
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  useAppStore.setState({ vault: { root: "/v", name: "v" } });
  useUi.setState({ modal: null });
  clearModelCache();
  setAiResponder(() => "```\n1. Buy milk.\n2. Call Sam.\n```");
});

afterEach(() => {
  setAiResponder(null);
  view?.destroy();
  view = null;
  discardParkedBlocks();
  useAiBlocks.setState({ blocks: {} });
});

describe("AI block: Review as edit", () => {
  it("opens the answer as changes to the selection instead of replacing it blind", async () => {
    const from = DOC.indexOf("Buy");
    const parent = document.createElement("div");
    document.body.append(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: DOC,
        selection: { anchor: from, head: DOC.length },
        extensions: aiBlocks("Todo.md"),
      }),
    });
    act(() => void openAiBlock(view!));
    const block = await screen.findByRole("group", { name: "AI block" });
    fireEvent.change(within(block).getByLabelText("AI prompt"), {
      target: { value: "Number these" },
    });
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    fireEvent.click(await within(block).findByRole("button", { name: "Review as edit" }));
    await waitFor(() =>
      expect(useUi.getState().modal).toEqual({
        kind: "fix",
        path: "Todo.md",
        from,
        to: DOC.length,
        original: "Buy milk.\nCall Sam.\n",
        scope: "selection",
        // Fences are removed and the selection's trailing newline kept.
        proposed: "1. Buy milk.\n2. Call Sam.\n",
      }),
    );
    // The note isn't changed until the review is applied.
    expect(view.state.doc.toString()).toBe(DOC);
    expect(screen.queryByRole("group", { name: "AI block" })).toBeNull();
  });
});
