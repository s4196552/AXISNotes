import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { HandwritingDialog } from "./HandwritingDialog";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const IMAGE = { mime: "image/png" as const, data: "iVBORw0KGgo=" };
const ANSWER = JSON.stringify({
  text: "Mitochondria make ATP\nthe powerhouse of the cel",
  uncertain: [
    { word: "ATP", alternatives: ["AIP"], reason: "unclear" },
    { word: "cel", alternatives: ["cell"], reason: "misspelled" },
  ],
});
const requests: AiRunRequest[] = [];

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axisnotes/config.json": JSON.stringify({ ai: { folders: { Private: "never" } } }),
  });
  await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  requests.length = 0;
  setAiResponder((req) => {
    requests.push(req);
    return ANSWER;
  });
});
afterEach(() => setAiResponder(null));

function show(sources = ["Board.axcanvas"]) {
  const onInsert = vi.fn();
  const onClose = vi.fn();
  render(
    <HandwritingDialog
      image={IMAGE}
      sources={sources}
      insertLabel="Add to canvas"
      offerReplace
      onInsert={onInsert}
      onClose={onClose}
    />,
  );
  return { onInsert, onClose };
}

describe("Handwriting to text", () => {
  it("reads the image, underlines uncertain words and applies quick fixes", async () => {
    const { onInsert, onClose } = show();
    await screen.findByLabelText("Transcription");
    expect(requests[0]!.task).toBe("handwriting");
    expect(requests[0]!.messages[1]!.content[0]).toEqual({ type: "image", ...IMAGE });
    expect(screen.getByRole("status")).toHaveTextContent("2 uncertain words underlined");

    // "cel" → pick the suggested spelling.
    fireEvent.click(screen.getByRole("button", { name: "cel (Misspelled)" }));
    const menu = screen.getByRole("menu", { name: "Fix “cel”" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "cell" }));
    expect(screen.getByRole("button", { name: "cell (checked)" })).toBeInTheDocument();

    // "ATP" → keep as written.
    fireEvent.click(screen.getByRole("button", { name: "ATP (Hard to read)" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Keep “ATP”" }));
    expect(screen.getByRole("status")).toHaveTextContent("All uncertain words checked.");

    fireEvent.click(screen.getByLabelText(/Remove the handwriting/));
    fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onInsert).toHaveBeenCalledWith("Mitochondria make ATP\nthe powerhouse of the cell", {
      replace: true,
    });
  });

  it("accepts a typed correction", async () => {
    const { onInsert } = show();
    fireEvent.click(await screen.findByRole("button", { name: "ATP (Hard to read)" }));
    const input = screen.getByLabelText("Type a correction");
    fireEvent.change(input, { target: { value: "energy" } });
    fireEvent.submit(input.closest("form")!);
    fireEvent.click(screen.getByRole("button", { name: "Add to canvas" }));
    await waitFor(() =>
      expect(onInsert).toHaveBeenCalledWith("Mitochondria make energy\nthe powerhouse of the cel", {
        replace: false,
      }),
    );
  });

  it("asks once more when the first answer isn't valid JSON", async () => {
    const answers = ["Sure! The text says: Mitochondria", ANSWER];
    setAiResponder((req) => {
      requests.push(req);
      return answers.shift()!;
    });
    show();
    await screen.findByLabelText("Transcription");
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[1]!.messages.at(-1))).toContain("does not contain a JSON");
  });

  it("refuses images from an 'AI: never' folder", async () => {
    show(["Private/Board.axcanvas"]);
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Not sent: .*AI: never/);
    expect(requests).toHaveLength(0);
  });
});
