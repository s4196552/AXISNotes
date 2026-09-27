import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Speller } from "./engine";
import { createEngine, engineSpeller } from "./hunspell";
import { openSpellFix, recheck, spellcheck } from "./spellcheck";

const dir = resolve("node_modules/dictionary-en");
let engine: ReturnType<typeof createEngine>;

beforeAll(() => {
  engine = createEngine(
    readFileSync(resolve(dir, "index.aff"), "utf8"),
    readFileSync(resolve(dir, "index.dic"), "utf8"),
  );
});

describe("Hunspell engine (en_US)", () => {
  it("accepts correct words, including capitalized and possessive forms", () => {
    for (const w of ["hello", "Hello", "mitochondria", "don't", "teacher's", "running"])
      expect(engine.correct(w), w).toBe(true);
  });

  it("rejects misspellings and suggests fixes", () => {
    expect(engine.correct("recieve")).toBe(false);
    expect(engine.suggest("recieve")).toContain("receive");
    expect(engine.suggest("teh")[0]).toBe("the"); // swapped letters first
    expect(engine.suggest("Teh")[0]).toBe("The");
  });
});

let view: EditorView | null = null;
afterEach(() => {
  view?.destroy();
  view = null;
});

function setup(doc: string, speller: Speller, words: string[] = []) {
  const known = new Set(words);
  const added: string[] = [];
  view = new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ base: markdownLanguage }),
        spellcheck({
          speller,
          isKnown: (w) => known.has(w),
          addWord: (w) => {
            added.push(w);
            known.add(w);
          },
        }),
      ],
    }),
  });
  return { view, added, known };
}

const flagged = (v: EditorView) =>
  [...v.contentDOM.querySelectorAll(".cm-misspelled")].map((e) => e.textContent);

describe("spellcheck extension", () => {
  it("underlines misspelled prose but not code, links or frontmatter", async () => {
    const doc =
      "---\ntittle: Draftt\n---\nThe mitochondria is teh powerhouse.\n\n`recieve` [[Notte]] #tagg\n\n```\nrecieve\n```\n";
    const { view } = setup(doc, engineSpeller(engine));
    // On a busy machine the code block may still be unparsed on the first pass; the check
    // runs again when parsing finishes.
    await vi.waitFor(() => expect(flagged(view)).toEqual(["teh"]), { timeout: 5000 });
  });

  it("skips words in the personal dictionary and re-checks when it changes", async () => {
    const { view, known } = setup("Axis notes use zettel links.", engineSpeller(engine));
    await vi.waitFor(() => expect(flagged(view)).toEqual(["zettel"]));
    known.add("zettel");
    view.dispatch({ effects: recheck.of(null) });
    await vi.waitFor(() => expect(flagged(view)).toEqual([]));
  });

  it("opens quick fixes: replace with a suggestion", async () => {
    const { view } = setup("I recieve mail.", engineSpeller(engine));
    await vi.waitFor(() => expect(flagged(view)).toEqual(["recieve"]));
    expect(openSpellFix(view, 0)).toBe(false);
    expect(openSpellFix(view, 4)).toBe(true);
    const menu = await vi.waitFor(() => {
      const m = view.dom.querySelector('[role="menu"]');
      expect(m?.textContent).toContain("receive");
      return m!;
    });
    expect(menu.getAttribute("aria-label")).toBe("Spelling: recieve");
    const receive = [...menu.querySelectorAll("button")].find((b) => b.textContent === "receive");
    receive!.click();
    expect(view.state.doc.toString()).toBe("I receive mail.");
    expect(view.dom.querySelector('[role="menu"]')).toBeNull();
    await vi.waitFor(() => expect(flagged(view)).toEqual([]));
  });

  it("adds a word to the dictionary, or ignores it for the session", async () => {
    const { view, added } = setup("Blorbx and Quuxly.", engineSpeller(engine));
    await vi.waitFor(() => expect(flagged(view)).toEqual(["Blorbx", "Quuxly"]));

    openSpellFix(view, 2);
    const add = await vi.waitFor(() => {
      const b = [...view.dom.querySelectorAll('[role="menuitem"]')].find((e) =>
        e.textContent?.startsWith("Add"),
      );
      expect(b).toBeTruthy();
      return b as HTMLButtonElement;
    });
    expect(add.textContent).toBe("Add “Blorbx” to dictionary");
    add.click();
    expect(added).toEqual(["blorbx"]);
    view.dispatch({ effects: recheck.of(null) });
    await vi.waitFor(() => expect(flagged(view)).toEqual(["Quuxly"]));

    openSpellFix(view, 13);
    const ignore = await vi.waitFor(() => {
      const b = [...view.dom.querySelectorAll('[role="menuitem"]')].find(
        (e) => e.textContent === "Ignore",
      );
      expect(b).toBeTruthy();
      return b as HTMLButtonElement;
    });
    ignore.click();
    await vi.waitFor(() => expect(flagged(view)).toEqual([]));
  });

  it("shows nothing when the dictionary fails to load", async () => {
    const broken: Speller = {
      check: () => Promise.reject(new Error("no dictionary")),
      suggest: () => Promise.resolve([]),
    };
    const { view } = setup("teh", broken);
    await new Promise((r) => setTimeout(r, 50));
    expect(flagged(view)).toEqual([]);
  });
});
