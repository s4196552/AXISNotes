import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { setAiResponder } from "../../ipc/memoryAi";
import type { AiRunRequest } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { aiBlocks, openAiBlock } from "../ai/aiBlock";
import { useAiBlocks } from "../ai/aiBlockStore";
import { clearModelCache } from "../ai/aiBlockStore";
import {
  BUILTIN_SKILLS,
  copyBuiltinsToVault,
  extractHtml,
  mergeSkills,
  parseSkill,
  parseSkillFiles,
  skillFromNote,
  useSkills,
} from "./skills";
import { skillAttach, skillRequest } from "./skillRun";

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
const lastRequest: { req: AiRunRequest | null } = { req: null };

beforeEach(async () => {
  h.b = createMemoryBackend({
    ".axisnotes/config.json": JSON.stringify({ ai: { folders: { "Bio/Private.md": "never" } } }),
    "Bio/Cells.md": "# Cells\n\nMitochondria make ATP.\n",
    "Bio/Genes.md": "DNA codes proteins.",
    "Bio/Private.md": "secret",
  });
  const vault = await h.b.openVault("/v");
  const { settings } = await h.b.aiSettings();
  await h.b.aiSaveSettings({
    ...settings,
    providers: [{ id: "ollama", kind: "ollama", name: "Ollama", baseUrl: "", enabled: true }],
  });
  useAppStore.setState({ vault, notice: null });
  await useAppStore.getState().refreshTree();
  useAppStore.setState({
    notes: ["Bio/Cells.md", "Bio/Genes.md", "Bio/Private.md"].map((path) => ({
      path,
      name: path.slice(4, -3),
      title: null,
      aliases: [],
    })),
  });
  useConfig.setState((s) => ({
    config: { ...s.config, ai: { folders: { "Bio/Private.md": "never" } } },
  }));
  useSkills.setState({ skills: BUILTIN_SKILLS });
  clearModelCache();
  lastRequest.req = null;
});

afterEach(() => {
  view?.destroy();
  view = null;
  useAiBlocks.setState({ blocks: {} });
  setAiResponder(null);
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

const byId = (id: string) => BUILTIN_SKILLS.find((s) => s.id === id)!;

describe("skill files", () => {
  it("ships the six built-in skills with what they make", () => {
    expect(BUILTIN_SKILLS.map((s) => [s.id, s.output, s.reads])).toEqual([
      ["mindmap", "markdown", "note"],
      ["test", "html", "note"],
      ["flashcards", "html", "note"],
      ["grill-me", "chat", "note"],
      ["handoff", "markdown", "note"],
      ["teach", "files", "folder"],
    ]);
    expect(byId("grill-me").description).toMatch(/every branch of the design tree/);
  });

  it("reads a vault SKILL.md, which replaces a built-in of the same name", () => {
    const mine = parseSkill(
      "---\nname: Flashcards\ndescription: Mine\noutput: html\n---\nDo it my way.",
      "Skills/flashcards/SKILL.md",
    )!;
    expect(mine).toMatchObject({ id: "flashcards", title: "Flashcards", reads: "note" });
    const custom = parseSkill("Just instructions.", "Skills/Exam Prep/SKILL.md")!;
    expect(custom).toMatchObject({ id: "exam-prep", title: "Exam Prep", output: "markdown" });
    const merged = mergeSkills([mine, custom]);
    expect(merged.find((s) => s.id === "flashcards")!.description).toBe("Mine");
    expect(merged.map((s) => s.id)).toContain("exam-prep");
    expect(parseSkill("---\nname: x\n---\n", "Skills/x/SKILL.md")).toBeNull();
  });

  it("pulls the page out of a reply and checks a Teach session's files", () => {
    expect(
      extractHtml("Here you go:\n```html\n<!doctype html><html><body>Hi</body></html>\n```"),
    ).toBe("<!doctype html><html><body>Hi</body></html>\n");
    expect(() => extractHtml("No page here")).toThrow(/no HTML document/);
    const ok = parseSkillFiles('{"message":"Hi","files":[{"path":"Progress.md","content":"p"}]}');
    expect(ok).toEqual({ message: "Hi", files: [{ path: "Progress.md", content: "p\n" }] });
    expect(() =>
      parseSkillFiles(
        '{"files":[{"path":"../x.md","content":"a"},{"path":"run.exe","content":"b"}]}',
      ),
    ).toThrow(/plain file name/);
  });

  it("reads the note, or the folder's notes without 'AI: never' ones", () => {
    expect(skillAttach(byId("flashcards"), "Bio/Cells.md", true)).toEqual(["Bio/Cells.md"]);
    expect(skillAttach(byId("teach"), "Bio/Cells.md", true)).toEqual([
      "Bio/Cells.md",
      "Bio/Genes.md",
    ]);
    expect(skillAttach(byId("teach"), "Bio/Cells.md", false)).toEqual([]);
    const req = skillRequest({
      skill: byId("teach"),
      prompt: "",
      turns: [],
      path: "Bio/Cells.md",
      useNote: true,
      choice: { effort: "balanced" },
    });
    expect(req).toMatchObject({ json: true, maxOutputTokens: 16000 });
    expect(req.messages[0]!.content[0]).toMatchObject({
      text: expect.stringContaining("# Skill: Teach me"),
    });
  });

  it("copies the built-ins into the vault and makes a skill from a note", async () => {
    expect(await copyBuiltinsToVault()).toBe(6);
    expect(h.b.files()["Skills/teach/SKILL.md"]).toMatch(/^---\nname: teach/);
    expect(await copyBuiltinsToVault()).toBe(0);
    const p = await skillFromNote("Bio/Genes.md");
    expect(p).toBe("Skills/genes/SKILL.md");
    expect(parseSkill(h.b.files()[p]!, p)).toMatchObject({
      id: "genes",
      instructions: "DNA codes proteins.",
    });
  });
});

describe("running skills from an AI block", () => {
  it("makes a flash-card page and saves it next to the note", async () => {
    setAiResponder((req) => {
      lastRequest.req = req;
      return "```html\n<!doctype html><html><body>Cards</body></html>\n```";
    });
    const open = vi.spyOn(h.b, "openInBrowser").mockResolvedValue();
    const v = mount("# Cells\n\n", "Bio/Cells.md", 9);
    act(() => void openAiBlock(v, undefined, { skill: "flashcards" }));
    const block = await screen.findByRole("group", { name: "AI block" });
    expect(within(block).getByText(/Skill: Flash cards/)).toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    expect(await within(block).findByText(/Made a web page/)).toBeInTheDocument();
    expect(lastRequest.req!.attach).toEqual(["Bio/Cells.md"]);
    fireEvent.click(within(block).getByRole("button", { name: /Save next to the note/ }));
    await waitFor(() =>
      expect(h.b.files()["Bio/Cells - Flash cards.html"]).toBe(
        "<!doctype html><html><body>Cards</body></html>\n",
      ),
    );
    await waitFor(() => expect(open).toHaveBeenCalledWith("Bio/Cells - Flash cards.html"));
  });

  it("asks again once when the page is missing", async () => {
    let n = 0;
    setAiResponder(() =>
      ++n === 1 ? "Sorry, here is a summary." : "<!doctype html><html></html>",
    );
    const v = mount("x\n", "Bio/Cells.md", 0);
    act(() => void openAiBlock(v, undefined, { skill: "test" }));
    const block = await screen.findByRole("group", { name: "AI block" });
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    expect(await within(block).findByText(/Made a web page/)).toBeInTheDocument();
    expect(n).toBe(2);
  });

  it("saves a Teach session's files into the folder and opens the lesson", async () => {
    setAiResponder(() =>
      JSON.stringify({
        message: "Lesson 1 covers cells.",
        files: [
          { path: "Progress.md", content: "- [x] Lesson 1" },
          { path: "Lesson 1 - Cells.md", content: "# Cells" },
          { path: "Lesson 1 - Cells.html", content: "<!doctype html><p>Quiz</p>" },
        ],
      }),
    );
    const v = mount("x\n", "Bio/Cells.md", 0);
    act(() => void openAiBlock(v, undefined, { skill: "teach" }));
    const block = await screen.findByRole("group", { name: "AI block" });
    expect(within(block).getByRole("button", { name: /Reads: notes in Bio/ })).toBeInTheDocument();
    fireEvent.change(within(block).getByLabelText("AI prompt"), {
      target: { value: "Teach me cells" },
    });
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    expect(await within(block).findByText("Lesson 1 covers cells.")).toBeInTheDocument();
    expect(within(block).getByRole("list", { name: "Files to save" })).toHaveTextContent(
      "Progress.md (new)",
    );
    fireEvent.click(within(block).getByRole("button", { name: /Save to Bio/ }));
    await waitFor(() => expect(h.b.files()["Bio/Progress.md"]).toBe("- [x] Lesson 1\n"));
    expect(h.b.files()["Bio/Lesson 1 - Cells.html"]).toBe("<!doctype html><p>Quiz</p>\n");
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Bio/Lesson 1 - Cells.md"));
  });

  it("keeps a Grill me conversation going, then keeps it as a draft", async () => {
    const seen: number[] = [];
    setAiResponder((req) => {
      seen.push(req.messages.length);
      return seen.length === 1 ? "Goals: who is this for?" : "Scope: what is out of scope?";
    });
    const v = mount("Plan\n", "Bio/Cells.md", 0);
    act(() => void openAiBlock(v, undefined, { skill: "grill-me" }));
    const block = await screen.findByRole("group", { name: "AI block" });
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    await within(block).findByRole("button", { name: /Reply/ });
    expect(within(block).getByLabelText("Conversation")).toHaveTextContent(
      "AI: Goals: who is this for?",
    );
    fireEvent.change(within(block).getByLabelText("AI prompt"), { target: { value: "Students" } });
    fireEvent.click(within(block).getByRole("button", { name: /Reply/ }));
    await waitFor(() =>
      expect(within(block).getByLabelText("Conversation")).toHaveTextContent(
        "You: StudentsAI: Scope: what is out of scope?",
      ),
    );
    await within(block).findByRole("button", { name: /Wrap up/ });
    // system + "Start" ; then system + start + answer + reply
    expect(seen).toEqual([2, 4]);
    fireEvent.click(within(block).getByRole("button", { name: /Open as draft/ }));
    await waitFor(() =>
      expect(h.b.files()[".axisnotes/drafts/Grill me - Cells.md"]).toMatch(
        /\*\*Me:\*\* Students\n\n\*\*AI:\*\* Scope: what is out of scope\?/,
      ),
    );
  });
});
