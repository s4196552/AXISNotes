import { readFileSync } from "node:fs";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { useAppStore } from "../../app/store";
import { DEFAULT_CONFIG, useConfig } from "../../app/config";
import { parseSkillFiles } from "../skills/skills";
import { BUILTIN_SKILL_FILES } from "../skills/builtinSkills";
import {
  addResults,
  blockText,
  buildColumns,
  COMPREHENSION_PATH,
  emptyFile,
  levelForScore,
  levelOf,
  notesInSources,
  parseBlock,
  parseFile,
  sectionsOf,
  setManual,
  shortLabel,
  statsOf,
  unitLevel,
  withSources,
} from "./model";
import { useComprehension } from "./store";
import {
  parseStudyMessage,
  recordStudy,
  recordTeach,
  resolveSource,
  studySourcesOf,
  withStudySources,
} from "./studyResults";
import { HeatmapCard } from "./HeatmapCard";
import { HeatmapView } from "./HeatmapView";
import { heatmapBlocks } from "./heatmapBlock";

// T-261: the comprehension heatmap.

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

const CYBER = "Uni/CyberSec OPs";
const NOTES: Record<string, string> = {
  [`${CYBER}/M10 Firewalls.md`]:
    "# M10 Firewalls\n\n## Packet filters\ntext\n\n## Stateful\ntext\n",
  [`${CYBER}/M11 IDS.md`]:
    "---\ntags: [ids]\n---\n## Signatures\n\n```\n## not a heading\n```\n## Anomaly\n",
  [`${CYBER}/M12 Crypto.md`]: "No headings here.",
  "Private/Medical.md": "## Results\n",
};

async function setup(files: Record<string, string> = NOTES) {
  h.b = createMemoryBackend(files);
  await h.b.openVault("/v");
  useAppStore.setState({ vault: { root: "/v", name: "Vault" }, tree: null, error: null });
  useConfig.setState({
    config: {
      ...structuredClone(DEFAULT_CONFIG),
      ai: { ...DEFAULT_CONFIG.ai, folders: { Private: "never" } },
    },
    loaded: true,
  });
  useComprehension.setState({ file: emptyFile(), root: null });
  await act(async () => {
    await useAppStore.getState().refreshTree();
  });
}

const saved = () => parseFile(h.b.files()[COMPREHENSION_PATH] ?? "");

beforeEach(() => localStorage.clear());

describe("model", () => {
  it("splits notes into sections by their top headings, skipping a title H1 and code", () => {
    expect(sectionsOf(NOTES[`${CYBER}/M10 Firewalls.md`]!).map((s) => s.text)).toEqual([
      "Packet filters",
      "Stateful",
    ]);
    expect(sectionsOf(NOTES[`${CYBER}/M11 IDS.md`]!).map((s) => s.text)).toEqual([
      "Signatures",
      "Anomaly",
    ]);
    expect(sectionsOf("plain")).toEqual([]);
    expect(sectionsOf("# Only a title\ntext")).toEqual([]);
  });

  it("builds a column per note, with the note as one square when it has no sections", () => {
    const cols = buildColumns(
      Object.entries(NOTES)
        .filter(([p]) => p.startsWith(CYBER))
        .map(([path, text]) => ({ path, text })),
      "sections",
    );
    expect(cols.map((c) => [c.label, c.units.length])).toEqual([
      ["M10", 2],
      ["M11", 2],
      ["M12", 1],
    ]);
    expect(cols[0]!.units[1]!.key).toBe(`${CYBER}/M10 Firewalls.md#Stateful`);
    expect(cols[2]!.units[0]!.key).toBe(`${CYBER}/M12 Crypto.md`);
    expect(buildColumns([{ path: "a.md", text: "## x\n## y" }], "notes")[0]!.units).toHaveLength(1);
    expect(shortLabel("Week 3 Cells")).toBe("Week3");
    expect(shortLabel("Photosynthesis")).toBe("Phot");
  });

  it("finds the notes in picked folders and notes, in natural order", () => {
    const all = ["A/n10.md", "A/n2.md", "B/x.md", "C.md"];
    expect(notesInSources(["A", "C.md"], all)).toEqual(["A/n2.md", "A/n10.md", "C.md"]);
    expect(
      withSources({ id: "t", title: "T", sources: ["A"], unit: "notes" }, ["A/n2.md", "B", "A"])
        .sources,
    ).toEqual(["A", "B"]);
  });

  it("maps scores to the five levels and averages the three latest results", () => {
    expect([0, 0.4, 0.6, 0.8, 0.95].map(levelForScore)).toEqual([1, 2, 3, 4, 5]);
    let f = addResults(
      emptyFile(),
      [{ key: "a.md", right: 1, total: 5 }],
      "test",
      "2026-11-01T00:00:00Z",
    );
    expect(levelOf(f.units["a.md"])).toBe(1);
    f = addResults(
      f,
      [
        { key: "a.md", right: 1, total: 1 },
        { key: "a.md", right: 1, total: 1 },
      ],
      "flashcards",
      "2026-11-02T00:00:00Z",
    );
    expect(f.units["a.md"]!.results!.at(-1)).toMatchObject({ score: 1, right: 2, total: 2 });
    // (0.2 + 1) / 2 = 0.6 → Fair
    expect(levelOf(f.units["a.md"])).toBe(3);
    // A level set by hand wins until cleared.
    f = setManual(f, "a.md", 5);
    expect(levelOf(f.units["a.md"])).toBe(5);
    f = setManual(f, "a.md", null);
    expect(levelOf(f.units["a.md"])).toBe(3);
    expect(setManual(emptyFile(), "b.md", null).units).toEqual({});
  });

  it("lets a section without data show its note's level, marked as inherited", () => {
    const f = addResults(emptyFile(), [{ key: "n.md", level: 4 }], "teach", "2026-11-01T00:00:00Z");
    const unit = { key: "n.md#X", path: "n.md", heading: "X", name: "n › X" };
    expect(unitLevel(f, unit)).toMatchObject({ level: 4, inherited: "note" });
    // A whole note without its own data averages its sections.
    const g = addResults(
      emptyFile(),
      [
        { key: "m.md#A", level: 1 },
        { key: "m.md#B", level: 5 },
        { key: "m.md#C", level: 5 },
      ],
      "teach",
      "2026-11-01T00:00:00Z",
    );
    const note = { key: "m.md", path: "m.md", heading: null, name: "m" };
    // Scores 0.2, 0.95, 0.95 → Bad, Best, Best → (1 + 5 + 5) / 3 ≈ 4
    expect(unitLevel(g, note)).toMatchObject({ level: 4, inherited: "sections" });
  });

  it("counts levels and mastery", () => {
    expect(statsOf([1, 5, 4, null, 5, 2])).toEqual({
      total: 6,
      covered: 5,
      mastered: 3,
      counts: [1, 1, 0, 1, 2],
    });
  });

  it("reads a hand-edited levels file, dropping what's malformed", () => {
    const f = parseFile(
      JSON.stringify({
        version: 1,
        topics: [
          { id: "t1", title: "Cyber", sources: ["Uni", 3], unit: "notes" },
          { title: "no id" },
        ],
        units: {
          "a.md": { manual: 9, results: [{ at: "x", from: "test", score: 2 }] },
          "b.md": { manual: 2 },
          "c.md": { results: [{ at: "2026-11-01", from: "teach", score: 0.5 }] },
        },
      }),
    );
    expect(f.topics).toEqual([{ id: "t1", title: "Cyber", sources: ["Uni"], unit: "notes" }]);
    expect(Object.keys(f.units)).toEqual(["b.md", "c.md"]);
    expect(parseFile("not json")).toEqual(emptyFile());
  });

  it("round-trips a ```heatmap block", () => {
    const spec = { title: "Cyber", unit: "notes" as const, sources: ["Uni/CyberSec OPs", "x.md"] };
    const text = blockText(spec);
    expect(text).toBe(
      "```heatmap\ntitle: Cyber\nunit: notes\nsource: Uni/CyberSec OPs\nsource: x.md\n```",
    );
    expect(parseBlock(text.split("\n").slice(1, -1).join("\n"))).toEqual(spec);
  });
});

describe("study results", () => {
  beforeEach(() => setup());

  it("accept only well-formed messages from a page", () => {
    expect(parseStudyMessage({ axisnotesLink: "x" })).toBeNull();
    expect(parseStudyMessage({ axisnotesStudy: { kind: "quiz", items: [] } })).toBeNull();
    expect(
      parseStudyMessage({
        axisnotesStudy: { kind: "test", items: [{ source: "a.md", correct: true }, { source: 1 }] },
      }),
    ).toEqual({ kind: "test", items: [{ source: "a.md", correct: true }] });
  });

  it("keep the notes a page was made from in its head", () => {
    const html = withStudySources("<!doctype html><html><head><title>T</title></head></html>", [
      'a "b".md',
    ]);
    expect(html).toContain('<head><meta name="axisnotes-sources"');
    expect(studySourcesOf(html)).toEqual(['a "b".md']);
    expect(studySourcesOf("<html></html>")).toBeNull();
  });

  it("resolve sources to notes AI may read, and only the page's own notes", () => {
    const notes = useAppStore.getState().notes.map((n) => n.path);
    const canRead = (p: string) => !p.startsWith("Private/");
    const m10 = `${CYBER}/M10 Firewalls.md`;
    expect(resolveSource(`${m10}#Stateful`, notes, canRead, null)).toBe(`${m10}#Stateful`);
    expect(resolveSource("M10 Firewalls#Stateful", notes, canRead, null)).toBe(`${m10}#Stateful`);
    expect(resolveSource("Private/Medical.md#Results", notes, canRead, null)).toBeNull();
    expect(resolveSource("Nowhere.md", notes, canRead, null)).toBeNull();
    // Not among the page's notes: goes to its only note instead (as the whole note).
    expect(resolveSource(`${CYBER}/M11 IDS.md`, notes, canRead, [m10])).toBe(m10);
  });

  it("save a page's results to the levels file, never for AI: never notes", async () => {
    const m10 = `${CYBER}/M10 Firewalls.md`;
    await recordStudy(
      {
        kind: "test",
        items: [
          { source: `${m10}#Stateful`, correct: true },
          { source: `${m10}#Stateful`, correct: false },
          { source: `${m10}#Packet filters`, correct: true },
          { source: "Private/Medical.md#Results", correct: false },
        ],
      },
      null,
    );
    const f = saved();
    expect(f.units[`${m10}#Stateful`]!.results![0]).toMatchObject({
      from: "test",
      right: 1,
      total: 2,
    });
    expect(levelOf(f.units[`${m10}#Packet filters`])).toBe(5);
    expect(Object.keys(f.units).some((k) => k.startsWith("Private/"))).toBe(false);
    expect(useAppStore.getState().notice).toMatch(/Practice test results saved .* \(2 items\)/);
  });

  it("save Teach me's levels for the notes the lesson read", async () => {
    const m11 = `${CYBER}/M11 IDS.md`;
    await recordTeach(
      [
        { source: `${m11}#Anomaly`, level: 2 },
        { source: `${CYBER}/M12 Crypto.md`, level: 5 },
      ],
      [m11],
    );
    const f = saved();
    expect(levelOf(f.units[`${m11}#Anomaly`])).toBe(2);
    // M12 wasn't read by the lesson, so its level goes to the only note it read.
    expect(Object.keys(f.units)).toEqual([`${m11}#Anomaly`, m11]);
  });
});

describe("skills report to the heatmap", () => {
  it("Practice test and Flash cards pages post results; Teach me returns levels", () => {
    expect(BUILTIN_SKILL_FILES.test).toContain('axisnotesStudy: {kind: "test"');
    expect(BUILTIN_SKILL_FILES.flashcards).toContain('axisnotesStudy: {kind: "flashcards"');
    expect(BUILTIN_SKILL_FILES.teach).toContain('"comprehension"');
  });

  it("Teach me's levels are optional and never fail the lesson", () => {
    const files = [{ path: "Progress.md", content: "x" }];
    expect(parseSkillFiles(JSON.stringify({ message: "m", files })).comprehension).toBeUndefined();
    expect(
      parseSkillFiles(
        JSON.stringify({
          message: "m",
          files,
          comprehension: [{ source: "a.md#X", level: 4 }, { source: "b.md", level: 9 }, "x"],
        }),
      ).comprehension,
    ).toEqual([{ source: "a.md#X", level: 4 }]);
    expect(parseSkillFiles(JSON.stringify({ files, comprehension: "nope" })).files).toHaveLength(1);
  });
});

describe("the card", () => {
  beforeEach(() => setup());

  it("shows a square per section, stats, legend and counts; hover names a square", async () => {
    const m10 = `${CYBER}/M10 Firewalls.md`;
    await useComprehension
      .getState()
      .change((f) =>
        addResults(
          setManual(f, `${m10}#Stateful`, 5),
          [{ key: `${m10}#Packet filters`, right: 0, total: 3 }],
          "test",
          "2026-11-10T00:00:00Z",
        ),
      );
    render(<HeatmapCard topic={{ title: "Cyber", sources: [CYBER], unit: "sections" }} />);
    const card = screen.getByRole("region", { name: "Comprehension heatmap: Cyber" });
    const squares = await within(card).findAllByRole("button", { name: /›|M12/ });
    expect(squares).toHaveLength(5);
    expect(squares[0]).toHaveAttribute("data-level", "1");
    expect(squares[0]).toHaveAccessibleName(/Packet filters: Bad · Practice test 0\/3/);
    expect(squares[1]).toHaveAttribute("data-level", "5");
    expect(squares[1]).toHaveAccessibleName(/Stateful: Best · set by you/);
    expect(squares[4]).toHaveAttribute("data-level", "0");
    expect(within(card).getByText("Items covered").parentElement).toHaveTextContent("2/ 5");
    expect(within(card).getByText("Mastered").parentElement).toHaveTextContent("20%");
    expect(within(card).getByRole("list", { name: "Items per level" })).toHaveTextContent(
      "1Bad0Weak0Fair0Good1Best",
    );
    fireEvent.mouseEnter(squares[2]!);
    expect(card.querySelector(".heatmap-tip")).toHaveTextContent(
      "M11 IDS › Signatures: No data yet",
    );
    // The AI: never folder isn't in this topic, so nothing is locked here.
    expect(card).not.toHaveTextContent("AI: never");
  });

  it("opens the note at the section on click, and sets levels in Set levels mode or by key", async () => {
    const open = vi.spyOn(useAppStore.getState(), "openFile");
    useAppStore.setState({ openFile: open });
    render(
      <HeatmapCard
        topic={{ title: "Cyber", sources: [`${CYBER}/M10 Firewalls.md`], unit: "sections" }}
      />,
    );
    const [first, second] = await screen.findAllByRole("button", { name: /›/ });
    fireEvent.click(first!);
    expect(open).toHaveBeenCalledWith(`${CYBER}/M10 Firewalls.md`, { heading: "Packet filters" });
    fireEvent.keyDown(second!, { key: "4" });
    await waitFor(() =>
      expect(levelOf(saved().units[`${CYBER}/M10 Firewalls.md#Stateful`])).toBe(4),
    );
    fireEvent.click(screen.getByRole("button", { name: "Set levels" }));
    fireEvent.click(screen.getByRole("button", { name: /Bad/ }));
    fireEvent.click(first!);
    await waitFor(() =>
      expect(saved().units[`${CYBER}/M10 Firewalls.md#Packet filters`]?.manual).toBe(1),
    );
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(second!, { key: "0" });
    await waitFor(() =>
      expect(saved().units[`${CYBER}/M10 Firewalls.md#Stateful`]).toBeUndefined(),
    );
  });

  it("marks notes AI may never read, and leaves them out of Practise weak spots", async () => {
    await useComprehension.getState().change((f) => setManual(f, "Private/Medical.md#Results", 1));
    render(<HeatmapCard topic={{ title: "Mixed", sources: ["Private"], unit: "sections" }} />);
    const [sq] = await screen.findAllByRole("button", { name: /Results/ });
    expect(sq).toHaveAccessibleName(/AI: never/);
    expect(screen.getByRole("button", { name: /Practise weak spots/ })).toBeEnabled();
  });
});

describe("the view", () => {
  beforeEach(() => setup());

  it("makes topics, adds sources and keeps them in the levels file", async () => {
    render(<HeatmapView topic={null} />);
    fireEvent.click(screen.getAllByRole("button", { name: /New topic/ })[0]!);
    const name = await screen.findByRole("textbox", { name: "Topic name" });
    fireEvent.change(name, { target: { value: "CyberSec OPs" } });
    fireEvent.blur(name);
    await waitFor(() => expect(saved().topics[0]?.title).toBe("CyberSec OPs"));
    const id = saved().topics[0]!.id;
    await act(async () => {
      const { addSources } = await import("./actions");
      await addSources(id, [CYBER]);
    });
    expect(
      await screen.findByRole("list", { name: "Notes and folders in this topic" }),
    ).toHaveTextContent("CyberSec OPs");
    expect(await screen.findAllByRole("button", { name: /›|M12/ })).toHaveLength(5);
    fireEvent.click(screen.getByRole("radio", { name: "Notes" }));
    await waitFor(() => expect(saved().topics[0]!.unit).toBe("notes"));
  });

  it("is a tab view opened from the command palette", async () => {
    const { allCommands } = await import("../commands/registry");
    void allCommands()
      .find((c) => c.id === "comprehension-heatmap")!
      .run();
    expect(useAppStore.getState().mainView).toBe("heatmap");
    expect(useAppStore.getState().activePath).toBeNull();
  });
});

describe("the block in a note", () => {
  it("renders ```heatmap blocks while the cursor is outside them", () => {
    const doc = "Intro\n\n```heatmap\ntitle: Cyber\nsource: Uni\n```\n\nAfter";
    const make = (anchor: number) => {
      const state = EditorState.create({
        doc,
        selection: { anchor },
        extensions: [markdown({ base: markdownLanguage }), heatmapBlocks],
      });
      ensureSyntaxTree(state, state.doc.length, 5000);
      // Rebuild once the tree is complete (as the editor does when parsing finishes).
      return state.update({ selection: { anchor } }).state;
    };
    const count = (s: EditorState) => s.field(heatmapBlocks).size;
    expect(count(make(0))).toBe(1);
    expect(count(make(doc.indexOf("title")))).toBe(0);
  });

  it("uses theme tokens for its colours", () => {
    const css = readFileSync("src/styles/themes.css", "utf8");
    for (let n = 0; n <= 5; n++) expect(css).toMatch(new RegExp(`--heat-${n}: light-dark\\(`));
  });
});
