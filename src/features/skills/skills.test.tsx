import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
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
  defaultFormat,
  formatsOf,
  skillSystem,
  useSkills,
  withFormat,
} from "./skills";
import { skillAttach, skillRequest, transcriptHtml } from "./skillRun";
import { clearTreeUndo, undoTree, redoTree, useTreeUndo } from "../filetree/undo";
import { makeCopyable } from "./copyable";
import { withStudySources } from "../comprehension/studyResults";
import { commonFolder, pickedNotes, runSkillOnPicked, skillsForPicked } from "./skillOnFiles";
import { aiBlockField, discardParkedBlocks } from "../ai/aiBlock";

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
    config: { ...s.config, ai: { folders: { "Bio/Private.md": "never" }, models: {} } },
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
  it("ships the built-in skills with what they make", () => {
    expect(BUILTIN_SKILLS.map((s) => [s.id, s.output, s.reads])).toEqual([
      ["mindmap", "markdown", "note"],
      ["test", "html", "note"],
      ["flashcards", "html", "note"],
      ["mnemonic", "markdown", "note"],
      ["make-it-stick", "markdown", "note"],
      ["example", "markdown", "note"],
      ["slide-deck", "html", "note"],
      ["infographic", "html", "note"],
      ["teach-the-ai", "chat", "note"],
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
    ).toBe(makeCopyable("<!doctype html><html><body>Hi</body></html>\n"));
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
    expect(await copyBuiltinsToVault()).toBe(BUILTIN_SKILLS.length);
    for (const skill of BUILTIN_SKILLS) {
      const path = `Skills/${skill.id}/SKILL.md`;
      expect(parseSkill(h.b.files()[path]!, path)).toEqual({ ...skill, source: path });
    }
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
  it.each(
    ["mnemonic", "make-it-stick", "example", "slide-deck", "infographic"].flatMap((id) =>
      (["markdown", "html"] as const).map((format) => ({ id, format })),
    ),
  )("runs $id in $format through the existing source and result paths", async ({ id, format }) => {
    const skill = byId(id);
    const markdown = "# Worked result\n\nMitochondria make ATP.";
    const html = "<!doctype html><html><body>Mitochondria make ATP.</body></html>";
    setAiResponder((req) => {
      lastRequest.req = req;
      return format === "html" ? html : markdown;
    });
    const original = "# Cells\n\n";
    const v = mount(original, "Bio/Cells.md", original.length);
    act(() => void openAiBlock(v, undefined, { skill: id }));
    const block = within(await screen.findByRole("group", { name: "AI block" }));
    expect(block.getByText(`Skill: ${skill.title}`)).toBeInTheDocument();
    const formats = within(block.getByRole("group", { name: "Format" }));
    expect(
      formats.getByRole("button", { name: defaultFormat(skill) === "html" ? "HTML" : "Markdown" }),
    ).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(formats.getByRole("button", { name: format === "html" ? "HTML" : "Markdown" }));
    fireEvent.click(block.getByRole("button", { name: /Run/ }));

    if (format === "html") {
      const saved = `Bio/Cells - ${skill.title}.html`;
      await waitFor(() => expect(h.b.files()[saved]).toBe(makeCopyable(`${html}\n`)));
      expect(block.getByRole("button", { name: /Open page/ })).toBeInTheDocument();
      expect(useConfig.getState().config.folderIcons[saved]).toEqual({ icon: "🇦🇮" });
    } else {
      const insert = await block.findByRole("button", { name: "Insert" });
      // Running alone doesn't edit the source; insertion is a separate action.
      expect(v.state.doc.toString()).toBe(original);
      fireEvent.click(insert);
      expect(v.state.doc.toString()).toContain(markdown);
    }
    expect(lastRequest.req!.attach).toEqual(["Bio/Cells.md"]);
    expect(lastRequest.req!.messages[0]!.content[0]).toMatchObject({
      text: skillSystem(withFormat(skill, format)),
    });
    expect(h.b.files()["Bio/Cells.md"]).toBe("# Cells\n\nMitochondria make ATP.\n");
  });

  it("makes a flash-card page and saves it next to the note at once, with the AI icon", async () => {
    setAiResponder((req) => {
      lastRequest.req = req;
      return "```html\n<!doctype html><html><body>Cards</body></html>\n```";
    });
    const browser = vi.spyOn(h.b, "openInBrowser").mockResolvedValue();
    const v = mount("# Cells\n\n", "Bio/Cells.md", 9);
    act(() => void openAiBlock(v, undefined, { skill: "flashcards" }));
    const block = await screen.findByRole("group", { name: "AI block" });
    expect(within(block).getByText(/Skill: Flash cards/)).toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    expect(
      await within(block).findByText(/saved it as “Cells - Flash cards.html”/),
    ).toBeInTheDocument();
    expect(lastRequest.req!.attach).toEqual(["Bio/Cells.md"]);
    // A study page keeps the notes it was made from, for the comprehension heatmap.
    expect(h.b.files()["Bio/Cells - Flash cards.html"]).toBe(
      withStudySources(makeCopyable("<!doctype html><html><body>Cards</body></html>\n"), [
        "Bio/Cells.md",
      ]),
    );
    expect(useConfig.getState().config.folderIcons["Bio/Cells - Flash cards.html"]).toEqual({
      icon: "🇦🇮",
    });
    // Opening it opens the saved page in a tab, not the browser.
    fireEvent.click(within(block).getByRole("button", { name: /Open page/ }));
    await waitFor(() =>
      expect(useAppStore.getState().activePath).toBe("Bio/Cells - Flash cards.html"),
    );
    expect(browser).not.toHaveBeenCalled();
  });

  it("opens the saved page in the browser, and saves each run under its own name", async () => {
    setAiResponder(() => "<!doctype html><html><body>Cards</body></html>");
    const browser = vi.spyOn(h.b, "openInBrowser").mockResolvedValue();
    const run = async () => {
      const v = mount("# Cells\n\n", "Bio/Cells.md", 9);
      act(() => void openAiBlock(v, undefined, { skill: "flashcards" }));
      const block = await screen.findByRole("group", { name: "AI block" });
      fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
      await within(block).findByText(/Made a web page/);
      return block;
    };
    // The first run is opened in a tab (which closes its block); the second, in the browser.
    fireEvent.click(within(await run()).getByRole("button", { name: /Open page/ }));
    cleanup();
    fireEvent.click(within(await run()).getByRole("button", { name: /Open in browser/ }));
    await waitFor(() => expect(browser).toHaveBeenCalledWith("Bio/Cells - Flash cards 1.html"));
    expect(Object.keys(h.b.files()).filter((p) => p.startsWith(".axisnotes/drafts/"))).toEqual([]);
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
    // Saved at once, each with the AI icon.
    expect(within(block).getByRole("list", { name: "Saved files" })).toHaveTextContent(
      "Progress.md",
    );
    expect(h.b.files()["Bio/Progress.md"]).toBe("- [x] Lesson 1\n");
    expect(h.b.files()["Bio/Lesson 1 - Cells.html"]).toBe(
      makeCopyable("<!doctype html><p>Quiz</p>\n"),
    );
    expect(useConfig.getState().config.folderIcons["Bio/Lesson 1 - Cells.md"]).toEqual({
      icon: "🇦🇮",
    });
    fireEvent.click(within(block).getByRole("button", { name: /Open the lesson/ }));
    await waitFor(() => expect(useAppStore.getState().activePath).toBe("Bio/Lesson 1 - Cells.md"));
  });

  it("preserves colliding folders and retries only the remaining Teach files", async () => {
    clearTreeUndo();
    await h.b.createFile("Bio/Progress.md/Outline.md", "my outline");
    setAiResponder(() =>
      JSON.stringify({
        files: [
          { path: "Lesson.md", content: "lesson" },
          { path: "Progress.md", content: "progress" },
        ],
      }),
    );
    const v = mount("x", "Bio/Cells.md", 0);
    act(() => void openAiBlock(v, undefined, { skill: "teach" }));
    const block = within(await screen.findByRole("group", { name: "AI block" }));
    fireEvent.click(block.getByRole("button", { name: /Run/ }));
    const retry = await block.findByRole("button", { name: /Save remaining files/ });
    expect(block.getByRole("alert")).toHaveTextContent("Progress.md");
    expect(h.b.files()["Bio/Progress.md/Outline.md"]).toBe("my outline");
    await h.b.writeFile("Bio/Lesson.md", "my edits");
    await h.b.renameEntry("Bio/Progress.md", "Bio/Outlines");
    fireEvent.click(retry);
    await waitFor(() => expect(h.b.files()["Bio/Progress.md"]).toBe("progress\n"));
    expect(h.b.files()["Bio/Lesson.md"]).toBe("my edits");
    await waitFor(() => expect(block.queryByRole("alert")).toBeNull());
  });

  it("undoes and redoes new and updated Teach files as a single step", async () => {
    clearTreeUndo();
    await h.b.createFile("Bio/Progress.md", "old progress");
    setAiResponder(() =>
      JSON.stringify({
        files: [
          { path: "Progress.md", content: "next" },
          { path: "Lesson.md", content: "lesson" },
        ],
      }),
    );
    const v = mount("x", "Bio/Cells.md", 0);
    act(() => void openAiBlock(v, undefined, { skill: "teach" }));
    const block = within(await screen.findByRole("group", { name: "AI block" }));
    fireEvent.click(block.getByRole("button", { name: /Run/ }));
    await block.findByRole("button", { name: /Open the lesson/ });
    expect(useTreeUndo.getState().undo).toHaveLength(1);
    await act(() => undoTree());
    expect(h.b.files()["Bio/Progress.md"]).toBe("old progress");
    expect(h.b.files()["Bio/Lesson.md"]).toBeUndefined();
    await act(() => redoTree());
    expect(h.b.files()["Bio/Progress.md"]).toBe("next\n");
    expect(h.b.files()["Bio/Lesson.md"]).toBe("lesson\n");
  });

  it.each(["grill-me", "teach-the-ai"])(
    "%s carries transcript privacy into follow-ups and keeps each format in its own file",
    async (id) => {
      await h.b.writeFile("Bio/Cells.md", "---\nai-access: local\n---\nCells");
      setAiResponder((req) => {
        lastRequest.req = req;
        return "Answer";
      });
      const v = mount("x", "Bio/Cells.md", 0);
      act(() => void openAiBlock(v, undefined, { skill: id }));
      const block = within(await screen.findByRole("group", { name: "AI block" }));
      fireEvent.click(block.getByRole("button", { name: /Run/ }));
      await block.findByRole("button", { name: /Wrap up/ });
      const md = `Bio/${byId(id).title} - Cells.md`;
      const html = `Bio/${byId(id).title} - Cells.html`;
      const first = h.b.files()[md];
      expect(first).toContain("ai-access: local");
      expect(block.getByRole("button", { name: /Reads:/ })).toBeDisabled();
      await h.b.writeFile("Bio/Cells.md", "Cells");
      fireEvent.click(block.getByRole("button", { name: "HTML" }));
      fireEvent.change(block.getByLabelText("AI prompt"), { target: { value: "Second question" } });
      fireEvent.click(block.getByRole("button", { name: /Reply/ }));
      await waitFor(() => expect(h.b.files()[html]).toContain("Second question"));
      expect(lastRequest.req?.atLeast).toBe("local");
      expect(h.b.files()[html]).toContain('<meta name="ai-access" content="local">');
      expect(h.b.files()[md]).toBe(first);
      fireEvent.click(block.getByRole("button", { name: "Markdown" }));
      fireEvent.click(block.getByRole("button", { name: /Save the conversation/ }));
      await waitFor(() => expect(h.b.files()[md]).toContain("Second question"));
      expect(h.b.files()[md]).toContain("ai-access: local");
      fireEvent.click(block.getByRole("button", { name: /Discard/ }));
      await waitFor(() => expect(h.b.files()[md]).toBeUndefined());
      expect(h.b.files()[html]).toBeUndefined();
    },
  );

  it.each(["markdown", "html"] as const)(
    "runs a teaching conversation and wraps up with a saved %s transcript",
    async (format) => {
      const seen: AiRunRequest[] = [];
      const replies = [
        "Could you teach me how mitochondria help a cell?",
        "So ATP carries energy the cell can use. How is that energy released?",
        "You explained ATP clearly. Practise explaining how its energy is released next.",
      ];
      setAiResponder((req) => {
        seen.push(req);
        return replies[seen.length - 1]!;
      });
      const original = h.b.files()["Bio/Cells.md"];
      const v = mount("# Cells\n\n", "Bio/Cells.md", 0);
      act(() => void openAiBlock(v, undefined, { skill: "teach-the-ai" }));
      const block = within(await screen.findByRole("group", { name: "AI block" }));
      fireEvent.click(block.getByRole("button", { name: format === "html" ? "HTML" : "Markdown" }));
      expect(seen).toHaveLength(0);
      fireEvent.click(block.getByRole("button", { name: /Run/ }));
      await block.findByRole("button", { name: /Open the saved conversation/ });
      expect(block.getByLabelText("Conversation")).toHaveTextContent(replies[0]!);
      expect(seen[0]).toMatchObject({ attach: ["Bio/Cells.md"], sources: [] });
      expect(seen[0]!.json).toBeUndefined();
      expect(seen[0]!.messages[0]).toEqual({
        role: "system",
        content: [{ type: "text", text: skillSystem(byId("teach-the-ai")) }],
      });
      expect(seen[0]!.messages[1]!.content[0]).toEqual({
        type: "text",
        text: "Start the conversation.",
      });
      const explanation = "Mitochondria make ATP, which carries usable energy for the cell.";
      fireEvent.change(block.getByLabelText("AI prompt"), { target: { value: explanation } });
      fireEvent.click(block.getByRole("button", { name: /Reply/ }));
      await waitFor(() =>
        expect(block.getByLabelText("Conversation")).toHaveTextContent(replies[1]!),
      );
      await block.findByRole("button", { name: /Wrap up/ });
      fireEvent.click(block.getByRole("button", { name: /Wrap up/ }));
      await waitFor(() =>
        expect(block.getByLabelText("Conversation")).toHaveTextContent(replies[2]!),
      );
      await block.findByRole("button", { name: /Open the saved conversation/ });
      expect(seen.map((req) => req.messages.length)).toEqual([2, 4, 6]);
      expect(
        seen[2]!.messages.slice(1).map((message) => [message.role, message.content[0]]),
      ).toEqual([
        ["user", { type: "text", text: "Start the conversation." }],
        ["assistant", { type: "text", text: replies[0] }],
        ["user", { type: "text", text: explanation }],
        ["assistant", { type: "text", text: replies[1] }],
        ["user", { type: "text", text: "wrap up" }],
      ]);
      const saved = h.b.files()[`Bio/Teach the AI - Cells.${format === "html" ? "html" : "md"}`]!;
      expect(saved).toContain(explanation);
      expect(saved).toContain(replies[2]);
      expect(saved).not.toContain("Start the interview.");
      expect(h.b.files()["Bio/Cells.md"]).toBe(original);
      expect(v.state.doc.toString()).toBe("# Cells\n\n");
      if (format === "html") expect(saved).toMatch(/^<!doctype html>/);
    },
  );

  it("updates a Grill me conversation after each reply and discards its saved file", async () => {
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
    // Saved after every reply, and kept up to date.
    expect(h.b.files()["Bio/Grill me - Cells.md"]).toMatch(
      /\*\*Me:\*\* Students\n\n\*\*AI:\*\* Scope: what is out of scope\?/,
    );
    expect(useConfig.getState().config.folderIcons["Bio/Grill me - Cells.md"]).toEqual({
      icon: "🇦🇮",
    });
    expect(Object.keys(h.b.files()).filter((p) => p.includes("Grill me"))).toEqual([
      "Bio/Grill me - Cells.md",
    ]);
    vi.spyOn(h.b, "trashEntry").mockRejectedValueOnce(new Error("File is busy"));
    fireEvent.click(within(block).getByRole("button", { name: /Discard/ }));
    await waitFor(() => expect(useAppStore.getState().notice).toBe("File is busy"));
    expect(within(block).getByLabelText("Conversation")).toHaveTextContent("Students");
    // Discard closes it and moves the saved conversation to the trash.
    fireEvent.click(within(block).getByRole("button", { name: /Discard/ }));
    await waitFor(() => expect(h.b.files()["Bio/Grill me - Cells.md"]).toBeUndefined());
  });
});

describe("Markdown or HTML for every skill", () => {
  it("offers both formats for every skill, and Both for Teach", () => {
    expect(BUILTIN_SKILLS.map((k) => [k.id, formatsOf(k), defaultFormat(k)])).toEqual([
      ["mindmap", ["markdown", "html"], "markdown"],
      ["test", ["markdown", "html"], "html"],
      ["flashcards", ["markdown", "html"], "html"],
      ["mnemonic", ["markdown", "html"], "markdown"],
      ["make-it-stick", ["markdown", "html"], "markdown"],
      ["example", ["markdown", "html"], "markdown"],
      ["slide-deck", ["markdown", "html"], "html"],
      ["infographic", ["markdown", "html"], "html"],
      ["teach-the-ai", ["markdown", "html"], "markdown"],
      ["grill-me", ["markdown", "html"], "markdown"],
      ["handoff", ["markdown", "html"], "markdown"],
      ["teach", ["both", "markdown", "html"], "both"],
    ]);
  });

  it("keeps the shared instructions and only the chosen format's section", () => {
    const md = withFormat(byId("mindmap"), "markdown");
    expect(md.output).toBe("markdown");
    expect(md.instructions).toMatch(/Mermaid `mindmap` code block/);
    expect(md.instructions).not.toMatch(/HTML page|## Format/);
    const page = withFormat(byId("mindmap"), "html");
    expect(page.output).toBe("html");
    expect(page.instructions).toMatch(/self-contained HTML page/);
    expect(page.instructions).toMatch(/Use 2 to 4 levels/);
    expect(page.instructions).not.toMatch(/Mermaid `mindmap`/);

    const cards = withFormat(byId("flashcards"), "markdown");
    expect(cards.output).toBe("markdown");
    expect(cards.instructions).toMatch(/\[!question\]-/);
    expect(cards.instructions).not.toMatch(/<!doctype html>/);
    expect(withFormat(byId("flashcards"), null).output).toBe("html");

    const lesson = withFormat(byId("teach"), "markdown");
    expect(lesson.output).toBe("files");
    expect(lesson.instructions).toMatch(/Don't write any \.html file/);
    expect(withFormat(byId("teach"), "html").instructions).toMatch(/Don't write a lesson \.md/);
    expect(withFormat(byId("teach"), "both").instructions).toMatch(
      /Lesson N - <short title>\.html/,
    );

    // A conversation stays one whatever is picked; the format is how it's kept.
    expect(withFormat(byId("grill-me"), "html")).toEqual(byId("grill-me"));
  });

  it("keeps a files skill without format sections replying with its files", () => {
    const own = parseSkill(
      ["---", "name: course", "output: files", "---", 'Reply with {"message", "files"}.'].join(
        "\n",
      ),
      "Skills/course/SKILL.md",
    )!;
    for (const f of ["markdown", "html"] as const) {
      const run = withFormat(own, f);
      expect(run.output).toBe("files");
      expect(run.instructions).toMatch(/Keep replying with the JSON object/);
      expect(run.instructions).not.toMatch(/Reply with only|Answer in Markdown only/);
    }
    expect(withFormat(own, "markdown").instructions).toMatch(/don't write any \.html file/);
    expect(withFormat(own, "both").instructions).toBe('Reply with {"message", "files"}.');
  });

  it("gives a skill without format sections a general instruction for the other format", () => {
    const own = parseSkill(
      ["---", "name: summary", "output: markdown", "---", "Summarise the note."].join("\n"),
      "Skills/summary/SKILL.md",
    )!;
    expect(withFormat(own, "markdown").instructions).toBe("Summarise the note.");
    const page = withFormat(own, "html");
    expect(page.output).toBe("html");
    expect(skillSystem(page)).toMatch(
      /Summarise the note\.\n\nAnswer as one self-contained HTML page/,
    );
  });

  it("makes flash cards as a Markdown note when Markdown is picked", async () => {
    setAiResponder((req) => {
      lastRequest.req = req;
      return ["# Cells", "", "> [!question]- What makes ATP?", "> Mitochondria."].join("\n");
    });
    const v = mount("# Cells\n\n", "Bio/Cells.md", 9);
    act(() => void openAiBlock(v, undefined, { skill: "flashcards" }));
    const block = await screen.findByRole("group", { name: "AI block" });
    const formats = within(block).getByRole("group", { name: "Format" });
    expect(within(formats).getByRole("button", { name: "HTML" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(formats).getByRole("button", { name: "Markdown" }));
    expect(within(formats).getByRole("button", { name: "Markdown" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    await within(block).findByRole("button", { name: /Insert/ });
    expect(within(block).queryByText(/Made a web page/)).not.toBeInTheDocument();
    const system = lastRequest.req!.messages[0]!.content[0]!;
    expect(system.type === "text" && system.text).toMatch(/folded callout/);
    expect(lastRequest.req!.maxOutputTokens).toBeUndefined();
  });

  it("keeps a Grill me conversation as a web page when HTML is picked", async () => {
    setAiResponder(() => "Goals: who is this for? <b>now</b>");
    const v = mount("Plan\n", "Bio/Cells.md", 0);
    act(() => void openAiBlock(v, undefined, { skill: "grill-me" }));
    const block = await screen.findByRole("group", { name: "AI block" });
    fireEvent.click(within(block).getByRole("button", { name: "HTML" }));
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    await within(block).findByRole("button", { name: /Wrap up/ });
    await waitFor(() =>
      expect(h.b.files()["Bio/Grill me - Cells.html"]).toMatch(/^<!doctype html>/),
    );
    const page = h.b.files()["Bio/Grill me - Cells.html"]!;
    expect(page).toContain("Goals: who is this for? &lt;b&gt;now&lt;/b&gt;");
    expect(page).not.toContain("<b>now</b>");
  });

  it("builds the conversation page with lists and bold, and escapes everything", () => {
    const html = transcriptHtml(byId("grill-me"), [
      { role: "user", text: "Use <script>" },
      { role: "assistant", text: ["**Decisions**", "- Ship it", "- Test `x`"].join("\n") },
    ]);
    expect(html).toContain("<p>Use &lt;script&gt;</p>");
    expect(html).toContain("<p><strong>Decisions</strong></p>");
    expect(html).toContain("<ul><li>Ship it</li><li>Test <code>x</code></li></ul>");
    expect(html).not.toMatch(/<script/);
  });
});

describe("skills on files picked in the tree", () => {
  afterEach(() => discardParkedBlocks());

  it("reads picked notes and every note in picked folders, minus 'AI: never' ones", () => {
    expect(pickedNotes(["Bio/Genes.md", "Bio/Cells.md"])).toEqual({
      include: ["Bio/Cells.md", "Bio/Genes.md"],
      never: [],
      overLimit: 0,
    });
    expect(pickedNotes(["Bio"])).toEqual({
      include: ["Bio/Cells.md", "Bio/Genes.md"],
      never: ["Bio/Private.md"],
      overLimit: 0,
    });
    expect(commonFolder(["Bio/Cells.md", "Bio/Genes.md"])).toBe("Bio");
    expect(commonFolder(["Bio"])).toBe("Bio");
    expect(commonFolder(["Bio/Cells.md", "Notes.md"])).toBe("");
    // Teach me needs one folder as its workspace.
    expect(
      skillsForPicked(BUILTIN_SKILLS, ["Bio/Cells.md", "Bio/Genes.md"]).map((s) => s.id),
    ).not.toContain("teach");
    expect(skillsForPicked(BUILTIN_SKILLS, ["Bio"]).map((s) => s.id)).toContain("teach");
  });

  it("leaves out notes whose own mark is 'never' and keeps dotted folders as folders", async () => {
    useAppStore.setState((st) => ({
      notes: st.notes.map((n) => (n.path === "Bio/Genes.md" ? { ...n, aiAccess: "never" } : n)),
    }));
    expect(pickedNotes(["Bio"])).toEqual({
      include: ["Bio/Cells.md"],
      never: ["Bio/Genes.md", "Bio/Private.md"],
      overLimit: 0,
    });
    await h.b.createFile("School/Biology 2.0/Week 1.md", "Cells");
    await useAppStore.getState().refreshTree();
    expect(commonFolder(["School/Biology 2.0"])).toBe("School/Biology 2.0");
    expect(commonFolder(["School/Biology 2.0/Week 1.md"])).toBe("School/Biology 2.0");
    expect(skillsForPicked(BUILTIN_SKILLS, ["School/Biology 2.0"]).map((s) => s.id)).toContain(
      "teach",
    );
    // Not in the tree: decided by the name.
    expect(commonFolder(["Gone/photo.png"])).toBe("Gone");
  });

  it("refuses when everything picked is 'AI: never'", async () => {
    const notify = vi.spyOn(useAppStore.getState(), "notify");
    expect(await runSkillOnPicked(byId("test"), ["Bio/Private.md"])).toBeNull();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/AI: never/));
  });

  it("makes a practice test from several notes in a note saved next to them", async () => {
    setAiResponder((req) => {
      lastRequest.req = req;
      return "<!doctype html><html><body>Test</body></html>";
    });
    const note = await runSkillOnPicked(byId("test"), ["Bio/Cells.md", "Bio/Genes.md"]);
    // Saved straight into the picked notes' folder, with the AI icon (not a draft).
    expect(note).toBe("Bio/Practice test - 2 notes.md");
    expect(useAppStore.getState().activePath).toBe(note);
    expect(h.b.files()[note!]).toContain("Made from [[Cells]], [[Genes]].");
    expect(useConfig.getState().config.folderIcons[note!]).toEqual({ icon: "🇦🇮" });

    // The note's editor opens with the skill's block already in it, reading the picked notes.
    const v = mount(h.b.files()[note!]!, note!, 0);
    expect(v.state.field(aiBlockField)).toEqual([
      expect.objectContaining({ skill: "test", sources: ["Bio/Cells.md", "Bio/Genes.md"] }),
    ]);
    const block = await screen.findByRole("group", { name: "AI block" });
    expect(within(block).getByRole("button", { name: /Reads: 2 notes/ })).toBeInTheDocument();
    fireEvent.click(within(block).getByRole("button", { name: /Run/ }));
    expect(await within(block).findByText(/Made a web page/)).toBeInTheDocument();
    expect(lastRequest.req!.attach).toEqual(["Bio/Cells.md", "Bio/Genes.md"]);
    // The page is saved next to it, named after the run.
    expect(h.b.files()["Bio/Practice test - 2 notes.html"]).toBe(
      withStudySources(makeCopyable("<!doctype html><html><body>Test</body></html>\n"), [
        "Bio/Cells.md",
        "Bio/Genes.md",
      ]),
    );
  });
});

describe("study skills test the subject, not the notes' layout", () => {
  it("tell the model to ask about what the notes teach, never which week or note it was in", () => {
    for (const id of ["test", "flashcards", "teach", "mnemonic", "make-it-stick", "example"]) {
      for (const format of formatsOf(byId(id))) {
        const sent = skillSystem(withFormat(byId(id), format));
        expect(sent, `${id} (${format})`).toMatch(/Test the subject itself/);
        expect(sent).toMatch(/Never ask about the notes themselves: not which week, lecture/);
        expect(sent).toMatch(/never mention them in a question, an option or an answer/);
        expect(sent).toMatch(/why, how, what would happen if/);
      }
    }
    expect(byId("mindmap").instructions).toMatch(/Branch by topic, not by note, week/);
    // Not for skills about plans and work.
    expect(byId("grill-me").instructions).not.toMatch(/Test the subject itself/);
    expect(byId("handoff").instructions).not.toMatch(/Test the subject itself/);
  });
});
