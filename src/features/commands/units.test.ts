import { CompletionContext } from "@codemirror/autocomplete";
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, mergeConfig } from "../../app/config";
import { formatDate, parseDate } from "../../lib/dates";
import {
  emojiCompletions,
  loadEmoji,
  quickCommandConfig,
  searchEmoji,
  slashCompletions,
} from "../editor/quickCommands";
import { monthGrid } from "../daily/monthGrid";
import { promptsIn, renderTemplate } from "../templates/templates";
import { fuzzyScore } from "./fuzzy";

const date = new Date(2026, 8, 6, 9, 5, 7); // Sun 6 Sep 2026 09:05:07

describe("dates", () => {
  it("formats moment-style tokens and literals", () => {
    expect(formatDate(date, "YYYY-MM-DD")).toBe("2026-09-06");
    expect(formatDate(date, "dddd, MMMM D, YYYY")).toBe("Sunday, September 6, 2026");
    expect(formatDate(date, "ddd DD MMM YY HH:mm:ss")).toBe("Sun 06 Sep 26 09:05:07");
    expect(formatDate(date, "[Week of] YYYY")).toBe("Week of 2026");
  });

  it("parses numeric formats and rejects invalid dates", () => {
    expect(parseDate("2026-09-06", "YYYY-MM-DD")?.getDate()).toBe(6);
    expect(parseDate("6.9.2026", "D.M.YYYY")?.getMonth()).toBe(8);
    expect(parseDate("2026-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseDate("notes", "YYYY-MM-DD")).toBeNull();
  });

  it("builds Monday-first month grids", () => {
    const grid = monthGrid(2026, 8); // September 2026 starts on Tuesday
    expect(formatDate(grid[0]!, "YYYY-MM-DD")).toBe("2026-08-31");
    expect(grid.length % 7).toBe(0);
    expect(grid.filter((d) => d.getMonth() === 8)).toHaveLength(30);
  });
});

describe("templates", () => {
  it("renders variables and finds the cursor", () => {
    const body =
      "# {{title}}\n{{date}} {{time}} {{date:dddd}} {{prompt:Topic}}\n{{cursor}}end {{unknown}}";
    const { text, cursor } = renderTemplate(body, {
      title: "T",
      now: date,
      answers: { Topic: "AI" },
    });
    expect(text).toBe("# T\n2026-09-06 09:05 Sunday AI\nend {{unknown}}");
    expect(text.slice(cursor)).toBe("end {{unknown}}");
    expect(promptsIn("{{prompt:A}} {{prompt: B }} {{prompt:A}}")).toEqual(["A", "B"]);
    expect(renderTemplate("x", { title: "", now: date }).cursor).toBe(1);
  });
});

describe("fuzzy", () => {
  it("ranks exact, word-start and subsequence matches", () => {
    expect(fuzzyScore("plan", "Plan")).toBeGreaterThan(fuzzyScore("plan", "Explanation"));
    expect(fuzzyScore("pa", "Project Alpha")).toBeGreaterThan(0);
    expect(fuzzyScore("xyz", "Project Alpha")).toBe(0);
    expect(fuzzyScore("", "anything")).toBe(1);
  });
});

describe("config", () => {
  it("merges over defaults, dropping wrong types and keeping unknown keys", () => {
    const c = mergeConfig({
      theme: "dark",
      dailyNotes: { folder: "Journal", openOnStartup: "yes" },
      quickCommands: { custom: [{ label: "Sig", insert: "— me" }] },
      extra: 1,
    });
    expect(c.theme).toBe("dark");
    expect(c.dailyNotes).toEqual({ ...DEFAULT_CONFIG.dailyNotes, folder: "Journal" });
    expect(c.quickCommands.custom).toHaveLength(1);
    expect(c.extra).toBe(1);
    expect(mergeConfig(null)).toEqual(DEFAULT_CONFIG);
  });
});

function viewWith(doc: string, cfg = {}) {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [
        markdown(),
        quickCommandConfig.of({
          ...DEFAULT_CONFIG.quickCommands,
          insertTemplate: () => {},
          ...cfg,
        }),
      ],
    }),
  });
}

describe("slash commands", () => {
  it("opens after the trigger at a line start or after a space, not inside words", () => {
    const at = (doc: string) =>
      slashCompletions(new CompletionContext(viewWith(doc).state, doc.length, false));
    expect(at("/he")?.from).toBe(1);
    expect(at("text /he")?.from).toBe(6);
    expect(at("a/b")).toBeNull();
    expect(at("http://x")).toBeNull();
  });

  it("applies line-level and inline commands, and respects config", () => {
    const run = (doc: string, label: string, cfg = {}) => {
      const view = viewWith(doc, cfg);
      const r = slashCompletions(new CompletionContext(view.state, doc.length, false))!;
      const opt = r.options.find((o) => o.label === label)!;
      (opt.apply as (v: EditorView, c: unknown, f: number, t: number) => void)(
        view,
        opt,
        r.from,
        doc.length,
      );
      return {
        text: view.state.doc.toString(),
        head: view.state.selection.main.head,
        labels: r.options.map((o) => o.label),
      };
    };
    expect(run("Title /h2", "Heading 2").text).toBe("## Title");
    expect(run("- item /ta", "Task").text).toBe("- [ ] item");
    const code = run("/co", "Code block");
    expect(code.text).toBe("```\n\n```");
    expect(code.head).toBe(4);
    expect(run("x\n/gr", "Page style: Math grid").text).toBe(
      "---\naxis-style: math-grid\n---\n\nx\n",
    );
    const custom = run(";s", "Sig", {
      slashTrigger: ";",
      custom: [{ label: "Sig", insert: "— {{cursor}}me" }],
    });
    expect(custom.text).toBe("— me");
    expect(custom.head).toBe(2);
    expect(run("/", "Heading 1", { disabled: ["h2"] }).labels).not.toContain("Heading 2");
  });
});

describe("emoji", () => {
  it("searches names before keywords and completes after the trigger", async () => {
    const data = await loadEmoji();
    const hits = searchEmoji(data, "rocket");
    expect(hits[0]).toEqual({ emoji: "🚀", name: "rocket" });

    const doc = "launch :rock";
    const r = await emojiCompletions(new CompletionContext(viewWith(doc).state, doc.length, false));
    expect(r?.from).toBe(7);
    expect(r?.options.some((o) => o.apply === "🚀")).toBe(true);
    const time = "at 10:30";
    expect(
      await emojiCompletions(new CompletionContext(viewWith(time).state, time.length, false)),
    ).toBeNull();
  });
});
