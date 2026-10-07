import {
  acceptCompletion,
  autocompletion,
  type Completion,
  CompletionContext,
  type CompletionResult,
  currentCompletions,
  startCompletion,
} from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryBackend, type MemoryBackend } from "../../ipc/memoryBackend";
import { migrateTriggers } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { inlineProperties } from "../../lib/markdown";
import {
  commandMenuAnchor,
  DEFAULT_QUICK_CONFIG,
  openCommandMenu,
  type QuickCommandConfig,
  quickCommandConfig,
  slashCompletions,
} from "./quickCommands";
import {
  blockCompletions,
  blockPreview,
  clearPropertyKeyCache,
  linkTargetFor,
  mentionCompletions,
  typedDate,
  propertyCompletions,
  templateCompletions,
} from "./triggers";
import { linkHost } from "./links";
import { notePath } from "./embeds";
import { findMath, loadKatex, math } from "./math";
import { useAppStore } from "../../app/store";
import { dailyDateOf, followLink } from "../commands/actions";
import type { NoteRef } from "../../ipc";

const h = vi.hoisted(() => ({ b: null as unknown as MemoryBackend }));
vi.mock("../../ipc", async (orig) => {
  const mod = await orig<typeof import("../../ipc")>();
  const backend = new Proxy({}, { get: (_t, key) => h.b[key as keyof MemoryBackend] });
  return { ...mod, backend };
});

beforeEach(async () => {
  h.b = createMemoryBackend({
    "School/Biology.md":
      "# Bio\n\nMitochondria make energy for the cell.\n\n- Cells divide ^cell1\n",
    "Projects/Alpha.md": "---\npriority: 1\n---\nstatus:: done\nowner:: Ada\n",
    "Projects/Beta.md": "status:: draft\n",
    "Templates/Meeting.md": "# {{title}}\n",
  });
  await h.b.openVault("/v");
  clearPropertyKeyCache();
});

function viewWith(
  doc: string,
  opts: {
    path?: string;
    cfg?: Partial<QuickCommandConfig>;
    cursor?: number;
    extra?: Extension[];
    notes?: NoteRef[];
    /** Completion sources the view runs itself (for ranking tests). */
    sources?: Parameters<typeof autocompletion>[0] extends infer C
      ? C extends { override?: infer O }
        ? O
        : never
      : never;
  } = {},
) {
  return new EditorView({
    parent: document.body,
    state: EditorState.create({
      doc,
      selection: { anchor: opts.cursor ?? doc.length },
      extensions: [
        markdown(),
        autocompletion({ override: opts.sources ?? [slashCompletions], interactionDelay: 0 }),
        commandMenuAnchor,
        quickCommandConfig.of({ ...DEFAULT_QUICK_CONFIG, ...opts.cfg }),
        notePath.of(opts.path ?? "Plan.md"),
        linkHost.of({
          openLink: () => {},
          openTag: () => {},
          isKnown: () => true,
          notes: () =>
            opts.notes ?? [
              { path: "School/Biology.md", name: "Biology", title: "Bio", aliases: [] },
            ],
        }),
        ...(opts.extra ?? []),
      ],
    }),
  });
}

const ctx = (view: EditorView) =>
  new CompletionContext(view.state, view.state.selection.main.head, false);

/** Pick the option with `label` from a completion result and apply it. */
async function pick(view: EditorView, r: CompletionResult | null, label: string) {
  const opt = r?.options.find((o) => o.label === label);
  if (!opt) throw new Error(`no option ${label}: ${r?.options.map((o) => o.label).join(", ")}`);
  const apply = opt.apply as (v: EditorView, c: Completion, f: number, t: number) => unknown;
  await apply(view, opt, r!.from, view.state.selection.main.head);
  return view.state.doc.toString();
}

const type = (view: EditorView, text: string) => {
  const at = view.state.selection.main.head;
  view.dispatch({
    changes: { from: at, insert: text },
    selection: { anchor: at + text.length },
    userEvent: "input.type",
  });
};

describe("command menu (Ctrl+/)", () => {
  it("opens at the cursor, filters on what's typed, and is done after a command", async () => {
    const view = viewWith("Title");
    expect(slashCompletions(ctx(view))).toBeNull(); // no typed trigger by default
    openCommandMenu(view);
    type(view, " he");
    const r = slashCompletions(ctx(view));
    expect(r?.from).toBe(5);
    expect(await pick(view, r, "Heading 1")).toBe("# Title");
    type(view, " more");
    expect(slashCompletions(ctx(view))).toBeNull();
  });

  it("closes when the cursor leaves the line", () => {
    const view = viewWith("one\ntwo", { cursor: 3 });
    openCommandMenu(view);
    expect(view.state.field(commandMenuAnchor)).toBe(3);
    view.dispatch({ selection: { anchor: 6 } });
    expect(view.state.field(commandMenuAnchor)).toBeNull();
  });

  it("moves vaults off the old typed / once, keeping a trigger the user chose", () => {
    const q = (raw: unknown) =>
      (migrateTriggers(raw) as { quickCommands: Record<string, unknown> }).quickCommands;
    expect(q({ quickCommands: { slashTrigger: "/" } })).toMatchObject({
      slashTrigger: "",
      triggerVersion: 2,
    });
    expect(q({ quickCommands: { slashTrigger: ";" } }).slashTrigger).toBe(";");
    // Chosen again after the move: kept.
    expect(q({ quickCommands: { slashTrigger: "/", triggerVersion: 2 } }).slashTrigger).toBe("/");
    expect(migrateTriggers({})).toEqual({});
  });
});

describe("@@ dates and notes", () => {
  const tomorrow = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  };

  it("links the daily note for a date (in the daily folder), or a note by name", async () => {
    const t = formatDate(tomorrow(), "YYYY-MM-DD");
    let view = viewWith("Meet @@tom");
    expect(await pick(view, mentionCompletions(ctx(view)), "Tomorrow")).toBe(
      `Meet [[Daily/${t}|${t}]]`,
    );
    view = viewWith("Meet @@tom", { cfg: { dailyFolder: "" } });
    expect(await pick(view, mentionCompletions(ctx(view)), "Tomorrow")).toBe(`Meet [[${t}]]`);
    view = viewWith("See @@bio");
    expect(await pick(view, mentionCompletions(ctx(view)), "Biology")).toBe("See [[Biology]]");
    view = viewWith("On @@2026-12-25");
    expect(await pick(view, mentionCompletions(ctx(view)), "2026-12-25")).toBe(
      "On [[Daily/2026-12-25|2026-12-25]]",
    );
  });

  it("writes the path when two notes share a name", async () => {
    const notes = [
      { path: "School/Biology.md", name: "Biology", title: null, aliases: [] },
      { path: "Archive/Biology.md", name: "Biology", title: null, aliases: [] },
      { path: "Plan.md", name: "Plan", title: null, aliases: [] },
    ];
    expect(linkTargetFor("Archive/Biology.md", notes)).toBe("Archive/Biology");
    expect(linkTargetFor("Plan.md", notes)).toBe("Plan");
    const view = viewWith("See @@bio", { notes });
    const r = mentionCompletions(ctx(view));
    const opt = r!.options.find((o) => o.detail === "Archive")!;
    (opt.apply as (v: EditorView, c: Completion, f: number, t: number) => void)(
      view,
      opt,
      r!.from,
      9,
    );
    expect(view.state.doc.toString()).toBe("See [[Archive/Biology]]");
  });

  it("opens a missing daily note from a link in the daily folder, from the daily template", async () => {
    expect(dailyDateOf("Daily/2026-12-25")?.getDate()).toBe(25);
    expect(dailyDateOf("2026-12-25")?.getMonth()).toBe(11);
    expect(dailyDateOf("Notes/2026-12-25")).toBeNull();
    expect(dailyDateOf("Biology")).toBeNull();
    useAppStore.setState({ vault: { root: "/v", name: "v" }, notes: [] });
    await followLink("Daily/2026-12-25|2026-12-25", "Plan.md");
    expect((await h.b.readFile("Daily/2026-12-25.md")).content).toContain(
      "# Friday, December 25, 2026",
    );
    expect(useAppStore.getState().activePath).toBe("Daily/2026-12-25.md");
  });

  it("writes a due date on a task line, and ignores @@ inside words", async () => {
    const view = viewWith("- [ ] Call Ada @@tom");
    expect(await pick(view, mentionCompletions(ctx(view)), "Tomorrow")).toBe(
      `- [ ] Call Ada 📅 ${formatDate(tomorrow(), "YYYY-MM-DD")}`,
    );
    expect(mentionCompletions(ctx(viewWith("ada@@x")))).toBeNull();
  });
});

describe("review fixes", () => {
  it("offers a date typed after @@ opened, and only real dates", () => {
    const r = mentionCompletions(ctx(viewWith("@@")))!;
    const valid = r.validFor as (t: string) => boolean;
    expect(valid("tom")).toBe(true);
    expect(valid("2026-12")).toBe(false); // re-run, so the typed date gets offered
    const later = mentionCompletions(ctx(viewWith("@@2026-12-25")))!;
    expect(later.options[0]!.label).toBe("2026-12-25");
    expect(typedDate("2026-02-30")).toBeNull();
    expect(typedDate("2026-13-01")).toBeNull();
    expect(typedDate("2028-02-29")?.getDate()).toBe(29);
  });

  it("follows daily links whose format has folders", () => {
    const cfg = { folder: "Daily", format: "YYYY/MM/DD", template: "", openOnStartup: false };
    expect(dailyDateOf("Daily/2026/10/08", cfg)?.getDate()).toBe(8);
    expect(dailyDateOf("2026/10/08", cfg)?.getMonth()).toBe(9);
    expect(dailyDateOf("Notes/2026/10/08", cfg)).toBeNull();
    expect(dailyDateOf("10/08", cfg)).toBeNull();
  });

  it("keeps a ( typed before the (( trigger", async () => {
    const view = viewWith("(((cells div");
    const r = await blockCompletions(ctx(view));
    expect(await pick(view, r, "Cells divide")).toBe("([[Biology#^cell1]]");
  });

  it("finds inline properties with prop: search in the memory backend", async () => {
    const hits = await h.b.search("prop:status=done");
    expect(hits.map((x) => x.path)).toEqual(["Projects/Alpha.md"]);
  });
});

describe("(( blocks", () => {
  it("links a block in another note, adding its id there", async () => {
    const view = viewWith("Remember ((mitochondria");
    const r = await blockCompletions(ctx(view));
    expect(r?.options.map((o) => o.detail)).toEqual(["School/Biology · new id"]);
    const text = await pick(view, r, "Mitochondria make energy for the cell.");
    const id = /\[\[Biology#\^([a-z0-9]+)\]\]$/.exec(text)?.[1];
    expect(text).toMatch(/^Remember \[\[Biology#\^[a-z0-9]+\]\]$/);
    expect((await h.b.readFile("School/Biology.md")).content).toContain(`for the cell. ^${id}`);
  });

  it("keeps what's typed while the id is being added in the other note", async () => {
    const view = viewWith("Remember ((mitochondria");
    const r = await blockCompletions(ctx(view));
    const opt = r!.options[0]!;
    const apply = opt.apply as (
      v: EditorView,
      c: Completion,
      f: number,
      t: number,
    ) => Promise<void>;
    const pending = apply(view, opt, r!.from, view.state.doc.length);
    type(view, " and more"); // typed before the file write finishes
    await pending;
    expect(view.state.doc.toString()).toMatch(/^Remember \[\[Biology#\^[a-z0-9]+\]\] and more$/);
  });

  it("finds the block again if the note changed after it was listed", async () => {
    const view = viewWith("((mitochondria");
    const r = await blockCompletions(ctx(view));
    // Another editor adds a paragraph above it before the menu item is chosen.
    const file = await h.b.readFile("School/Biology.md");
    await h.b.writeFile(
      "School/Biology.md",
      file.content.replace("# Bio\n", "# Bio\n\nNew intro.\n"),
    );
    const text = await pick(view, r, "Mitochondria make energy for the cell.");
    const id = /\^([a-z0-9]+)\]\]$/.exec(text)![1];
    const after = (await h.b.readFile("School/Biology.md")).content;
    expect(after).toContain("New intro.\n");
    expect(after).toContain(`for the cell. ^${id}`);
  });

  it("matches words anywhere in a paragraph, not just its first line", async () => {
    await h.b.writeFile("Notes/Intro.md", "A general introduction\nRibosomes build proteins.\n");
    const view = viewWith("((ribosomes");
    const r = await blockCompletions(ctx(view));
    expect(r?.options.map((o) => o.label)).toEqual(["A general introduction"]);
  });

  it("shows block text without Markdown marks", () => {
    expect(blockPreview("This is **demo** and `code` see [[Note|the note]] or [x](http://y)")).toBe(
      "This is demo and code see the note or x",
    );
    expect(blockPreview("a".repeat(100))).toHaveLength(72);
  });

  it("reuses an existing id without touching the file", async () => {
    const before = (await h.b.readFile("School/Biology.md")).content;
    const view = viewWith("((cells div");
    expect(await pick(view, await blockCompletions(ctx(view)), "Cells divide")).toBe(
      "[[Biology#^cell1]]",
    );
    expect((await h.b.readFile("School/Biology.md")).content).toBe(before);
  });

  it("links a block in this note in one edit, but never the block being typed in", async () => {
    const doc = "Alpha idea here.\n\nSee ((alpha";
    const view = viewWith(doc);
    const r = await blockCompletions(ctx(view));
    expect(r?.options.map((o) => o.label)).toEqual(["Alpha idea here."]);
    const text = await pick(view, r, "Alpha idea here.");
    const id = /\^([a-z0-9]+)\n/.exec(text)?.[1];
    expect(text).toBe(`Alpha idea here. ^${id}\n\nSee [[Plan#^${id}]]`);
    expect(view.state.selection.main.head).toBe(text.length);
  });
});

describe(":: inline properties", () => {
  it("suggests keys used in the vault, most used first, at a line start", async () => {
    const view = viewWith("- ::");
    const r = await propertyCompletions(ctx(view));
    expect(r?.options.map((o) => [o.label, o.detail])).toEqual([
      ["status", "2 notes"],
      ["owner", "1 note"],
      ["priority", "1 note"],
    ]);
    expect(await pick(view, r, "status")).toBe("- status:: ");
    expect(await propertyCompletions(ctx(viewWith("some text ::st")))).toBeNull();
  });

  it("ranks an existing key above a new one with the typed text", async () => {
    const view = viewWith("::sta", { sources: [propertyCompletions] });
    startCompletion(view);
    await vi.waitFor(() => expect(currentCompletions(view.state).length).toBeGreaterThan(0));
    expect(currentCompletions(view.state).map((c) => c.label)).toEqual(["status", "sta"]);
    acceptCompletion(view);
    expect(view.state.doc.toString()).toBe("status:: ");
  });

  it("offers a new key for what's typed", async () => {
    const view = viewWith("::mood");
    const r = await propertyCompletions(ctx(view));
    expect(r?.options[0]).toMatchObject({ label: "mood", detail: "new property" });
    expect(await pick(view, r, "mood")).toBe("mood:: ");
  });

  it("parses inline properties like the indexer (frontmatter and code excluded)", () => {
    expect(
      inlineProperties(
        "---\na: 1\n---\nstatus:: done\n- [ ] owner:: Ada\n```\nx:: 1\n```\nhttps://x.y\n9lives:: no\n",
      ),
    ).toEqual({ status: "done", owner: "Ada" });
  });

  it("reads and completes properties in every list and task form, like the indexer", async () => {
    expect(
      inlineProperties("* [ ] a:: 1\n+ [x] b:: 2\n1. c:: 3\n2) [X] d:: 4\n*e:: no\n- [ ]f:: no\n"),
    ).toEqual({ a: "1", b: "2", c: "3", d: "4" });
    for (const line of ["* [ ] ::st", "+ ::st", "1. ::st", "2) [x] ::st"]) {
      const view = viewWith(line);
      expect(await pick(view, await propertyCompletions(ctx(view)), "status"), line).toBe(
        line.replace("::st", "status:: "),
      );
    }
  });
});

describe("{{ template variables", () => {
  it("inserts the variable in a template, and the value in a note", async () => {
    let view = viewWith("Due {{da", { path: "Templates/Meeting.md" });
    let r = templateCompletions(ctx(view));
    expect(r?.options.map((o) => o.label)).toContain("cursor");
    expect(await pick(view, r, "date")).toBe("Due {{date}}");

    view = viewWith("Due {{da}}", { cursor: 8 });
    r = templateCompletions(ctx(view));
    expect(r?.options.map((o) => o.label)).not.toContain("cursor");
    expect(await pick(view, r, "date")).toBe(`Due ${formatDate(new Date(), "YYYY-MM-DD")}`);
    view = viewWith("# {{ti");
    expect(await pick(view, templateCompletions(ctx(view)), "title")).toBe("# Plan");
  });

  it("puts the cursor inside a prompt", async () => {
    const view = viewWith("{{pr", { path: "Templates/Meeting.md" });
    expect(await pick(view, templateCompletions(ctx(view)), "prompt")).toBe("{{prompt:}}");
    expect(view.state.selection.main.head).toBe(9);
  });
});

describe("$$ math", () => {
  it("finds $$…$$ spans, skipping escaped and empty ones", () => {
    expect(findMath(String.raw`a $$x^2$$ b \$$not math and $$ $$`)).toEqual([
      { from: 2, to: 9, tex: "x^2" },
    ]);
  });

  it("doesn't let a $$ inside code pair with real math", () => {
    expect(findMath("Use `$$` like this:\n\n$$x^2$$\n")).toEqual([
      { from: 21, to: 28, tex: "x^2" },
    ]);
    expect(findMath("```\n$$a\n```\n$$b$$")).toEqual([{ from: 12, to: 17, tex: "b" }]);
  });

  it("renders display and inline math with KaTeX unless the cursor is in it", async () => {
    await loadKatex();
    const doc = "$$E = mc^2$$\n\nInline $$a+b$$ here, `$$code$$`.\n\nend";
    const view = viewWith(doc, { extra: [math] });
    expect(view.dom.querySelectorAll(".cm-math-display .katex")).toHaveLength(1);
    expect(view.dom.querySelectorAll(".cm-math:not(.cm-math-display) .katex")).toHaveLength(1);
    view.dispatch({ selection: { anchor: 3 } });
    expect(view.dom.querySelectorAll(".cm-math-display")).toHaveLength(0);
  });

  it("closes $$ as it's typed", () => {
    const view = viewWith("x $", { extra: [math] });
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((f) => f(view, 3, 3, "$", () => view.state.update({})));
    expect(handled).toBe(true);
    expect(view.state.doc.toString()).toBe("x $$$$");
    expect(view.state.selection.main.head).toBe(4);
  });

  it("steps over the closing $$ when it's typed by hand", () => {
    const view = viewWith("$$x$$", { cursor: 3, extra: [math] });
    const typeDollar = () =>
      view.state.facet(EditorView.inputHandler).some((f) => {
        const at = view.state.selection.main.head;
        return f(view, at, at, "$", () => view.state.update({}));
      });
    expect(typeDollar()).toBe(true);
    expect(typeDollar()).toBe(true);
    expect(view.state.doc.toString()).toBe("$$x$$");
    expect(view.state.selection.main.head).toBe(5);
  });

  it("keeps decorations on cursor moves that don't enter math", async () => {
    await loadKatex();
    const view = viewWith("$$a$$\n\nplain text here", { extra: [math] });
    const before = view.dom.querySelector(".cm-math");
    view.dispatch({ selection: { anchor: 10 } });
    view.dispatch({ selection: { anchor: 12 } });
    expect(view.dom.querySelector(".cm-math")).toBe(before);
  });
});
