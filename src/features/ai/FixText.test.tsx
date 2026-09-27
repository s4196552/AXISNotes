import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { useAppStore } from "../../app/store";
import { FixText } from "./FixText";
import { cleanReply, fixRequest } from "./fixPrompt";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const NOTE = "# Bio\n\nMitochondria is teh powerhouse of teh cell.\n";
const BODY = "Mitochondria is teh powerhouse of teh cell.";
const requests: AiRunRequest[] = [];

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axis/config.json": JSON.stringify({ ai: { folders: { Medical: "never" } } }),
    "School/Bio.md": NOTE,
    "Medical/scan.md": "Pateint is fine.",
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
    return "```\nMitochondria are the powerhouse of the cell.\n```";
  });
  useAppStore.setState({ notice: null, error: null });
});
afterEach(() => setAiResponder(null));

function open(path = "School/Bio.md", original = BODY) {
  const onClose = vi.fn();
  const from = NOTE.indexOf(original);
  render(
    <FixText
      path={path}
      from={from}
      to={from + original.length}
      original={original}
      scope="selection"
      onClose={onClose}
    />,
  );
  return onClose;
}

describe("Fix writing", () => {
  it("shows the destination, then the edits as changes that can be rejected", async () => {
    const onClose = open();
    await waitFor(() => expect(screen.getByLabelText("Destination")).toHaveTextContent("→ Ollama"));
    fireEvent.click(screen.getByRole("button", { name: /^Fix$/ }));

    const change = await screen.findByRole("button", { name: "Change “is teh” to “are the”" });
    expect(screen.getByRole("status")).toHaveTextContent("2 of 2 changes accepted");
    expect(requests[0]!.task).toBe("textFixes");
    expect(requests[0]!.sources).toEqual(["School/Bio.md"]);

    fireEvent.click(change); // keep "is teh"
    expect(change).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toHaveTextContent("1 of 2 changes accepted");

    fireEvent.click(screen.getByRole("button", { name: "Apply 1 change" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect((await h.b.readFile("School/Bio.md")).content).toBe(
      "# Bio\n\nMitochondria is teh powerhouse of the cell.\n",
    );
  });

  it("reports when nothing needs fixing", async () => {
    setAiResponder(() => BODY);
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Fix$/ }));
    expect(await screen.findByText("No changes suggested.")).toBeInTheDocument();
  });

  it("refuses notes in an 'AI: never' folder", async () => {
    open("Medical/scan.md", "Pateint is fine.");
    await waitFor(() =>
      expect(screen.getByLabelText("Destination")).toHaveTextContent(/AI: never/),
    );
    fireEvent.click(screen.getByRole("button", { name: /^Fix$/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Not sent: .*AI: never/);
    expect(requests).toHaveLength(0);
  });

  it("won't overwrite text that changed meanwhile", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /^Fix$/ }));
    await screen.findByRole("button", { name: /Apply 2 changes/ });
    await h.b.writeFile("School/Bio.md", "# Bio\n\nRewritten by hand.\n");
    fireEvent.click(screen.getByRole("button", { name: /Apply 2 changes/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/note changed/);
    expect((await h.b.readFile("School/Bio.md")).content).toBe("# Bio\n\nRewritten by hand.\n");
  });
});

describe("fix prompt helpers", () => {
  it("keeps the original's surrounding whitespace and drops code fences", () => {
    expect(cleanReply("```markdown\nFixed text.\n```", "\n  fixd text.\n\n")).toBe(
      "\n  Fixed text.\n\n",
    );
    expect(cleanReply("```js\nx\n```", "```js\nx\n```")).toBe("```js\nx\n```");
  });

  it("asks the text-fix model to keep Markdown intact", () => {
    const req = fixRequest("hi", "clarity", "a.md");
    expect(req.task).toBe("textFixes");
    const system = req.messages[0]!.content[0]!;
    expect(system.type === "text" && system.text).toMatch(/clarity/);
    expect(system.type === "text" && system.text).toMatch(/\[\[wikilinks\]\]/);
  });
});
