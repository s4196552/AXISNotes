import { readFileSync } from "node:fs";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";
import { notePath } from "../editor/embeds";
import {
  matchesAnswer,
  parseFlashcards,
  parseMindmap,
  parseQuiz,
  studyKind,
  toMermaidMindmap,
  type FlashcardsBlock,
  type MindmapBlock,
  type QuizBlock,
} from "./model";
import { studyBlocks, type StudyCardHost } from "./studyBlocks";
import { clearSessions, sourceOf } from "./session";
import { FlashcardsView } from "./FlashcardsCard";
import { QuizView } from "./QuizCard";
import { MindmapView } from "./MindmapCard";

// T-267: ```flashcards, ```quiz and ```mindmap blocks in notes.

const rec = vi.hoisted(() => ({ calls: [] as unknown[][] }));
vi.mock("../comprehension/studyResults", () => ({
  recordStudy: (...args: unknown[]) => {
    rec.calls.push(args);
    return Promise.resolve(1);
  },
}));

const NOTE = "# Biology\n\n## Cells\n\ntext\n\n```flashcards\nQ: a\nA: b\n```\n\n## Plants\n";

function host(kind: StudyCardHost["kind"], body: string): StudyCardHost {
  return {
    kind,
    body,
    path: "Bio/Cells.md",
    where: () => ({ text: NOTE, line: 7 }),
    onEditSource: vi.fn(),
  };
}

function ok<T>(r: { ok: true; block: T } | { ok: false; error: string; line: number }): T {
  if (!r.ok) throw new Error(`line ${r.line}: ${r.error}`);
  return r.block;
}

beforeEach(() => {
  clearSessions();
  rec.calls = [];
});

describe("parsing", () => {
  it("knows the three block kinds by their fence", () => {
    expect(studyKind("flashcards")).toBe("flashcards");
    expect(studyKind(" Quiz ")).toBe("quiz");
    expect(studyKind("mindmap extra")).toBe("mindmap");
    expect(studyKind("mermaid")).toBeNull();
  });

  it("reads flash cards with a header and multi-line answers", () => {
    const b = ok(
      parseFlashcards(
        "title: Cell biology\nreverse: yes\n\nQ: What does the mitochondrion make?\nA: ATP.\n\nQ: Which organelle holds DNA?\nA: The **nucleus**.\n   See [[Cell structure]].\n",
      ),
    );
    expect(b.header).toMatchObject({ title: "Cell biology", reverse: true, shuffle: false });
    expect(b.cards).toEqual([
      { front: "What does the mitochondrion make?", back: "ATP.", line: 4 },
      {
        front: "Which organelle holds DNA?",
        back: "The **nucleus**.\nSee [[Cell structure]].",
        line: 7,
      },
    ]);
  });

  it("says which line is wrong in a flash-card block", () => {
    expect(parseFlashcards("Q: no answer\n\nQ: x\nA: y")).toMatchObject({ ok: false, line: 1 });
    expect(parseFlashcards("A: orphan")).toMatchObject({ ok: false, line: 1 });
    expect(parseFlashcards("title: t\n\nstray text\nQ: x\nA: y")).toMatchObject({
      ok: false,
      line: 3,
    });
    expect(parseFlashcards("")).toMatchObject({ ok: false });
  });

  it("reads quiz questions: one answer, select-all, short answer, explanations", () => {
    const b = ok(
      parseQuiz(
        "title: Photosynthesis\nshuffle: true\n\nQ: Where?\n- [ ] Stroma\n- [x] Thylakoid\n> Chlorophyll is there.\n\nQ: Which are products?\n- [x] Oxygen\n- [X] Glucose\n- [ ] Carbon dioxide\n\nQ: Name the pigment.\n= chlorophyll\n=Chlorophyll a\n",
      ),
    );
    expect(b.header.shuffle).toBe(true);
    expect(b.questions.map((q) => [q.text, q.options.length, q.answers])).toEqual([
      ["Where?", 2, []],
      ["Which are products?", 3, []],
      ["Name the pigment.", 0, ["chlorophyll", "Chlorophyll a"]],
    ]);
    expect(b.questions[0]!.explanation).toBe("Chlorophyll is there.");
    expect(b.questions[1]!.options.filter((o) => o.correct)).toHaveLength(2);
  });

  it("rejects quiz questions without a right answer, options and answers mixed, or one option", () => {
    expect(parseQuiz("Q: x\n- [ ] a\n- [ ] b")).toMatchObject({ ok: false, line: 1 });
    expect(parseQuiz("Q: x\n- [x] a\n= a")).toMatchObject({ ok: false });
    expect(parseQuiz("Q: x\n- [x] a")).toMatchObject({ ok: false });
    expect(parseQuiz("Q: x")).toMatchObject({ ok: false });
    expect(parseQuiz("- [x] a")).toMatchObject({ ok: false, line: 1 });
  });

  it("compares short answers ignoring case and spacing", () => {
    expect(matchesAnswer("  ChloroPhyll ", ["chlorophyll"])).toBe(true);
    expect(matchesAnswer("chlorophyll  a", ["Chlorophyll a"])).toBe(true);
    expect(matchesAnswer("", ["x"])).toBe(false);
    expect(matchesAnswer("xylem", ["chlorophyll"])).toBe(false);
  });

  it("reads a mind map from a nested list, with the title as the root", () => {
    const b = ok(
      parseMindmap(
        "title: Photosynthesis\n\n- Light stage\n  - Thylakoid\n  - Water split\n- Calvin cycle\n\t- Stroma\n1. Numbered works too\n",
      ),
    );
    expect(b.root.label).toBe("Photosynthesis");
    expect(b.root.children.map((c) => [c.label, c.children.map((g) => g.label)])).toEqual([
      ["Light stage", ["Thylakoid", "Water split"]],
      ["Calvin cycle", ["Stroma"]],
      ["Numbered works too", []],
    ]);
    expect(b.count).toBe(6);
    // A single top item is the root when there's no title.
    expect(ok(parseMindmap("- Root\n  - A")).root.label).toBe("Root");
    expect(parseMindmap("not a list")).toMatchObject({ ok: false, line: 1 });
  });

  it("copies a mind map as Mermaid with plain labels", () => {
    const b = ok(parseMindmap("title: Cells (intro)\n- [[Nucleus|The nucleus]]\n  - DNA: genes"));
    expect(toMermaidMindmap(b.root)).toBe(
      "mindmap\n  root((Cells intro))\n    The nucleus\n      DNA genes",
    );
  });

  it("refuses blocks that are too large", () => {
    expect(parseFlashcards("Q: a\nA: b\n".repeat(30000))).toMatchObject({ ok: false });
  });
});

describe("in the editor", () => {
  const make = (doc: string, anchor: number) => {
    const state = EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown({ base: markdownLanguage }), notePath.of("N.md"), studyBlocks],
    });
    ensureSyntaxTree(state, state.doc.length, 5000);
    return state.update({ selection: { anchor } }).state;
  };
  const count = (s: EditorState) => s.field(studyBlocks).size;

  it("renders closed study blocks while the cursor is outside them", () => {
    const doc =
      "Intro\n\n```flashcards\nQ: a\nA: b\n```\n\n```quiz\nQ: x\n= y\n```\n\n~~~mindmap\n- a\n~~~\n\n```mermaid\nflowchart TD\n```\n";
    expect(count(make(doc, 0))).toBe(3);
    expect(count(make(doc, doc.indexOf("Q: a")))).toBe(2);
  });

  it("leaves a block that isn't closed yet as text", () => {
    expect(count(make("```flashcards\nQ: a\nA: b\n", 0))).toBe(0);
  });
});

describe("flash cards", () => {
  const block = ok(
    parseFlashcards("title: Cells\n\nQ: Q1\nA: A1\n\nQ: Q2\nA: A2"),
  ) as FlashcardsBlock;

  it("flips with a click or Space, and sends a sorted round to the heatmap once", () => {
    render(<FlashcardsView block={block} host={host("flashcards", "x")} />);
    const card = screen.getByRole("button", { pressed: false });
    expect(card).toHaveTextContent("Q1");
    fireEvent.click(card);
    expect(screen.getByRole("button", { pressed: true })).toHaveTextContent("A1");
    fireEvent.keyDown(screen.getByRole("button", { pressed: true }), { key: " " });
    expect(screen.getByRole("button", { pressed: false })).toHaveTextContent("Q1");

    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.getByRole("button", { pressed: false })).toHaveTextContent("Q2");
    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    expect(screen.getByRole("status")).toHaveTextContent("1 known, 1 to study again");
    expect(rec.calls).toEqual([
      [
        {
          kind: "flashcards",
          items: [
            { source: "Bio/Cells.md#Cells", correct: true },
            { source: "Bio/Cells.md#Cells", correct: false },
          ],
        },
        ["Bio/Cells.md"],
      ],
    ]);

    // Studying the missed card is its own round.
    fireEvent.click(screen.getByRole("button", { name: "Study the 1 again" }));
    expect(screen.getByRole("button", { pressed: false })).toHaveTextContent("Q2");
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(rec.calls).toHaveLength(2);
    expect(rec.calls[1]![0]).toEqual({
      kind: "flashcards",
      items: [{ source: "Bio/Cells.md#Cells", correct: true }],
    });
  });

  it("keeps progress when the card is drawn again (scrolled away and back)", () => {
    const h = host("flashcards", "same body");
    const first = render(<FlashcardsView block={block} host={h} />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    first.unmount();
    render(<FlashcardsView block={block} host={h} />);
    expect(screen.getByRole("button", { pressed: false })).toHaveTextContent("Q2");
    expect(screen.getByText(/1 known/)).toBeInTheDocument();
  });

  it("shows HTML in a card as text, never as markup", () => {
    const evil = ok(
      parseFlashcards('Q: <img src=x onerror="alert(1)"> **bold**\nA: <script>alert(2)</script>'),
    );
    const { container } = render(<FlashcardsView block={evil} host={host("flashcards", "e")} />);
    expect(container.querySelector("img, script")).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(container.querySelector("strong")).toHaveTextContent("bold");
  });

  it("names the section a block is under, or just the note", () => {
    expect(sourceOf(host("flashcards", "x"))).toBe("Bio/Cells.md#Cells");
    expect(
      sourceOf({ ...host("flashcards", "x"), where: () => ({ text: "Intro\n", line: 1 }) }),
    ).toBe("Bio/Cells.md");
  });
});

describe("practice test", () => {
  const block = ok(
    parseQuiz(
      "Q: Where?\n- [ ] Stroma\n- [x] Thylakoid\n> Light is absorbed there.\n\nQ: Pigment?\n= chlorophyll",
    ),
  ) as QuizBlock;

  it("checks answers, explains, scores and reports once every question is checked", () => {
    render(<QuizView block={block} host={host("quiz", "q")} />);
    const [first, second] = screen.getAllByRole("listitem");
    fireEvent.click(within(first!).getByLabelText("Stroma"));
    fireEvent.click(within(first!).getByRole("button", { name: "Check" }));
    expect(first).toHaveTextContent("Not quite");
    expect(first).toHaveTextContent("Answer: Thylakoid");
    expect(first).toHaveTextContent("Light is absorbed there.");
    expect(rec.calls).toHaveLength(0);

    const input = within(second!).getByRole("textbox");
    fireEvent.change(input, { target: { value: " Chlorophyll " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(second).toHaveTextContent("Right");
    expect(screen.getByText("You got 1 of 2. Missed: 1.")).toBeInTheDocument();
    expect(rec.calls).toEqual([
      [
        {
          kind: "test",
          items: [
            { source: "Bio/Cells.md#Cells", correct: false },
            { source: "Bio/Cells.md#Cells", correct: true },
          ],
        },
        ["Bio/Cells.md"],
      ],
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.queryByText(/You got/)).toBeNull();
    expect(screen.getAllByRole("button", { name: "Check" })).toHaveLength(2);
  });

  it("needs every right option for a select-all question", () => {
    const multi = ok(parseQuiz("Q: Products?\n- [x] O2\n- [x] Glucose\n- [ ] CO2")) as QuizBlock;
    render(<QuizView block={multi} host={host("quiz", "m")} />);
    expect(screen.getByText("Select all that apply")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("O2"));
    fireEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(screen.getByRole("listitem")).toHaveTextContent("Not quite");
  });
});

describe("mind map", () => {
  const block = ok(
    parseMindmap("title: Plants\n- Leaves\n  - Stomata\n  - Veins\n- Roots"),
  ) as MindmapBlock;

  it("draws every idea and folds a branch", () => {
    render(<MindmapView block={block} host={host("mindmap", "m")} />);
    expect(screen.getAllByRole("treeitem")).toHaveLength(5);
    fireEvent.click(screen.getAllByRole("button", { name: "Hide what's under this" })[0]!);
    // The root folds first in document order; expand all brings everything back.
    expect(screen.getAllByRole("treeitem")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Expand all" }));
    expect(screen.getAllByRole("treeitem")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Collapse all" }));
    expect(screen.getAllByRole("treeitem").map((n) => n.textContent)).toEqual([
      "Plants−",
      "Leaves+2",
      "Roots",
    ]);
  });
});

describe("safety", () => {
  it("study-block code never writes HTML into the page", () => {
    const files = [
      "studyBlocks.ts",
      "shared.tsx",
      "FlashcardsCard.tsx",
      "QuizCard.tsx",
      "MindmapCard.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(`src/features/studyBlocks/${f}`, "utf8");
      expect(src).not.toMatch(/innerHTML|outerHTML|dangerouslySetInnerHTML|insertAdjacentHTML/);
    }
  });
});
