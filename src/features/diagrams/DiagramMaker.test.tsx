import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { useAppStore } from "../../app/store";
import { DiagramMaker } from "./DiagramMaker";
import { loadMermaid } from "./mermaid";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});
// Mermaid's renderer needs real layout; its parser (used for validation) runs for real.
vi.mock("./mermaid", async (orig) => ({
  ...(await orig<typeof import("./mermaid")>()),
  renderMermaid: (code: string) =>
    Promise.resolve(`<svg data-testid="svg"><text>${code.split("\n")[0]}</text></svg>`),
}));

const requests: AiRunRequest[] = [];
const MITOSIS = "flowchart TD\n  A[Prophase] --> B[Metaphase]\n  B --> C[Anaphase]";

// Loading Mermaid's parser under jsdom can take several minutes on Windows.
beforeAll(() => loadMermaid(), 360_000);

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axisnotes/config.json": JSON.stringify({ ai: { folders: { Private: "never" } } }),
    "Bio.md": "# Cells\n## Parts\n- Nucleus\n- [[Mito]]\n",
    "Mito.md": "Links back to [[Bio]].",
    "Private/Diary.md": "secret",
  });
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  useAppStore.setState({
    notes: [
      { path: "Bio.md", name: "Bio", title: "Cells", aliases: [] },
      { path: "Mito.md", name: "Mito", title: null, aliases: [] },
    ],
  });
  requests.length = 0;
});
afterEach(() => setAiResponder(null));

function answer(...replies: string[]) {
  setAiResponder((req) => {
    requests.push(req);
    return replies.shift() ?? "";
  });
}

describe("Diagram maker (note)", () => {
  it("generates Mermaid from a description, previews it and inserts it", async () => {
    answer("Here you go:\n```mermaid\n" + MITOSIS + "\n```");
    const onInsert = vi.fn();
    render(<DiagramMaker target="note" path="Bio.md" onInsert={onInsert} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Describe the diagram"), {
      target: { value: "flowchart of mitosis" },
    });
    await waitFor(() => expect(screen.getByLabelText("Destination")).toHaveTextContent("Ollama"));
    fireEvent.click(screen.getByRole("button", { name: /Generate/ }));

    const code = await screen.findByLabelText("Mermaid code");
    expect(code).toHaveValue(MITOSIS);
    expect(await screen.findByTestId("svg")).toHaveTextContent("flowchart TD");
    expect(requests[0]).toMatchObject({ task: "diagrams", sources: ["Bio.md"] });

    // Hand edits go in as typed.
    fireEvent.change(code, { target: { value: MITOSIS + "\n  C --> D[Telophase]" } });
    fireEvent.click(screen.getByRole("button", { name: "Insert into note" }));
    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith({ mermaid: MITOSIS + "\n  C --> D[Telophase]" }),
    );
  });

  it("sends invalid Mermaid back once with the parser's error", async () => {
    answer("flowchart TD\n  A --> ", MITOSIS);
    render(<DiagramMaker target="note" path="Bio.md" onInsert={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Describe the diagram"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/ }));
    expect(await screen.findByLabelText("Mermaid code")).toHaveValue(MITOSIS);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain("Mermaid can't parse it");
  });

  it("gives up with a clear error after the retry", async () => {
    answer("not a diagram", "still not");
    render(<DiagramMaker target="note" path="Bio.md" onInsert={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("Describe the diagram"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/answer wasn't usable/);
  });

  it("builds a mind map from the note's outline without AI", async () => {
    answer();
    const onInsert = vi.fn();
    render(<DiagramMaker target="note" path="Bio.md" onInsert={onInsert} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: "From notes (no AI)" }));
    expect(await screen.findByLabelText("Mermaid code")).toHaveValue(
      "mindmap\n  n0((Cells))\n    n1[Parts]\n      n2[Nucleus]\n      n3[Mito]",
    );
    fireEvent.change(screen.getByLabelText("Diagram source"), { target: { value: "links" } });
    await waitFor(() =>
      expect((screen.getByLabelText("Mermaid code") as HTMLTextAreaElement).value).toMatch(
        /^flowchart LR[\s\S]*n0 --> n1/,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Insert into note" }));
    await waitFor(() => expect(onInsert).toHaveBeenCalled());
    expect(requests).toHaveLength(0);
  });

  it("refuses notes in an 'AI: never' folder", async () => {
    answer(MITOSIS);
    render(
      <DiagramMaker target="note" path="Private/Diary.md" onInsert={vi.fn()} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Describe the diagram"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Not sent: .*AI: never/);
    expect(requests).toHaveLength(0);
  });
});

describe("Diagram maker (canvas)", () => {
  it("asks for a JSON graph, validates it and returns it", async () => {
    const graph = {
      kind: "flowchart",
      direction: "down",
      nodes: [
        { id: "p", label: "Prophase" },
        { id: "m", label: "Metaphase" },
      ],
      edges: [{ from: "p", to: "m" }],
    };
    answer(
      '{"kind":"flowchart","nodes":[{"id":"p","label":"Prophase"}],"edges":[{"from":"p","to":"x"}]}',
      JSON.stringify(graph),
    );
    const onInsert = vi.fn();
    render(
      <DiagramMaker target="canvas" path="Board.axcanvas" onInsert={onInsert} onClose={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Describe the diagram"), {
      target: { value: "mitosis" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate/ }));
    expect(await screen.findByTestId("svg")).toHaveTextContent("flowchart TD");
    expect(requests[0]!.json).toBe(true);
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain("is not a node id");
    fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith({ graph }));
  });

  it("draws on the canvas while the answer arrives, then adds the checked diagram", async () => {
    const graph = {
      kind: "flowchart",
      nodes: [
        { id: "p", label: "Prophase" },
        { id: "m", label: "Metaphase" },
        { id: "a", label: "Anaphase" },
      ],
      edges: [
        { from: "p", to: "m" },
        { from: "m", to: "a" },
      ],
    };
    answer(JSON.stringify(graph, null, 1)); // streamed a word at a time
    const onDraft = vi.fn();
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(
      <DiagramMaker
        target="canvas"
        path="Board.axcanvas"
        onInsert={onInsert}
        onDraft={onDraft}
        onClose={onClose}
      />,
    );
    expect(screen.getByLabelText(/Draw on the canvas as it's written/)).toBeChecked();
    fireEvent.change(screen.getByLabelText("Describe the diagram"), {
      target: { value: "mitosis" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Generate/ }));
    await waitFor(() => expect(onInsert).toHaveBeenCalledWith({ graph }));
    expect(onClose).toHaveBeenCalled();
    // Drafts grew node by node, then edge by edge.
    const sizes = onDraft.mock.calls.map((call) => {
      const g = call[0] as { nodes: unknown[]; edges: unknown[] };
      return `${g.nodes.length}/${g.edges.length}`;
    });
    expect(sizes).toEqual(["1/0", "2/0", "3/0", "3/1", "3/2"]);
  });

  it("removes the draft when the answer can't be used", async () => {
    answer(
      '{"kind":"flowchart","nodes":[{"id":"p","label":"P"}], "edges":[{"from":"p","to":"x"}]}',
      "no",
    );
    const onDraft = vi.fn();
    render(
      <DiagramMaker
        target="canvas"
        path="Board.axcanvas"
        onInsert={vi.fn()}
        onDraft={onDraft}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Describe the diagram"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /Generate/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/answer wasn't usable/);
    expect(onDraft).toHaveBeenLastCalledWith(null);
  });
});
