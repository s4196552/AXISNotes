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
import { makeCopyable } from "./copyable";
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
    expect(h.b.files()["Bio/Cells - Flash cards.html"]).toBe(
      makeCopyable("<!doctype html><html><body>Cards</body></html>\n"),
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
      makeCopyable("<!doctype html><html><body>Test</body></html>\n"),
    );
  });
});
