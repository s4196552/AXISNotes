import { describe, expect, it } from "vitest";
import { InvalidAnswer } from "../../lib/aiJson";
import {
  applyOps,
  type ApplyOptions,
  type El,
  overlay,
  parseDrawAnswer,
  partialDraw,
  stableIds,
  summarize,
  touchedIds,
} from "./canvasOps";
import { REMEASURE } from "./liveMerge";

const notes: ApplyOptions = {
  noteOk: (p) => (p.startsWith("Medical/") ? { error: `no note at "${p}"` } : { path: p }),
};
const byId = (els: El[], id: string) => els.find((e) => e.id === id)!;
const labelOf = (els: El[], id: string) => {
  const b = (byId(els, id).boundElements as { type: string; id: string }[]).find(
    (x) => x.type === "text",
  )!;
  return byId(els, b.id);
};
const live = (els: El[]) => els.filter((e) => !e.isDeleted);

const MITOSIS = [
  { op: "add", id: "pro", text: "Prophase", x: 0, y: 0 },
  { op: "add", id: "meta", type: "diamond", text: "Metaphase", x: 0, y: 160 },
  { op: "add", id: "ana", text: "Anaphase", x: 0, y: 320 },
  { op: "arrow", id: "p-m", from: "pro", to: "meta", label: "then" },
  { op: "arrow", id: "m-a", from: "meta", to: "ana" },
];

describe("canvas operations", () => {
  it("adds labelled shapes and arrows bound to them, like the connector's add_to_canvas", () => {
    const r = applyOps([], MITOSIS, notes);
    expect(r.problems).toEqual([]);
    expect(r.added).toEqual(["pro", "meta", "ana", "p-m", "m-a"]);
    const pro = byId(r.elements, "pro");
    for (const k of ["seed", "versionNonce", "strokeColor", "fillStyle", "groupIds", "roundness"])
      expect(pro).toHaveProperty(k);
    const label = labelOf(r.elements, "pro");
    expect(label).toMatchObject({ text: "Prophase", containerId: "pro" });
    expect((label.customData as Record<string, unknown>)[REMEASURE]).toBe(true);
    const arrow = byId(r.elements, "p-m");
    expect(arrow.startBinding).toMatchObject({ elementId: "pro" });
    expect(arrow.endBinding).toMatchObject({ elementId: "meta" });
    // From border to border: it starts below Prophase and ends above Metaphase.
    expect(arrow.y as number).toBeGreaterThan((pro.y as number) + (pro.height as number));
    expect((byId(r.elements, "meta").boundElements as { id: string }[]).map((b) => b.id)).toContain(
      "p-m",
    );
  });

  it("gives unnamed labels and shapes the same ids each time a draft is redrawn", () => {
    const idFor = stableIds();
    const ops = [...MITOSIS, { op: "add", text: "Unnamed" }];
    const once = applyOps([], ops, { ...notes, idFor }).elements.map((e) => e.id);
    const again = applyOps([], ops, { ...notes, idFor }).elements.map((e) => e.id);
    expect(again).toEqual(once);
    expect(new Set(once).size).toBe(once.length);
  });

  it("places shapes without a position in a grid to the right of what is there", () => {
    const first = applyOps([], [{ op: "add", id: "a", text: "A", x: 0, y: 0 }], notes);
    const r = applyOps(
      first.elements,
      [
        { op: "add", id: "b", text: "B" },
        { op: "add", id: "c", text: "C" },
      ],
      notes,
    );
    const a = byId(r.elements, "a");
    const b = byId(r.elements, "b");
    const c = byId(r.elements, "c");
    expect(b.x as number).toBeGreaterThanOrEqual((a.x as number) + (a.width as number) + 100);
    expect(c.x as number).toBeGreaterThan((b.x as number) + (b.width as number));
  });

  it("moves, recolors and relabels by id; arrows and labels follow", () => {
    const drawn = applyOps([], MITOSIS, notes).elements;
    const r = applyOps(
      drawn,
      [
        { op: "change", id: "ana", x: 0, y: 300, backgroundColor: "#b2f2bb" },
        { op: "change", id: labelOf(drawn, "meta").id, text: "Metaphase (aligned)" },
      ],
      notes,
    );
    expect(r.problems).toEqual([]);
    expect(r.changed).toEqual(["ana", "meta"]); // a label's id stands for its shape
    const ana = byId(r.elements, "ana");
    expect(ana).toMatchObject({ y: 300, backgroundColor: "#b2f2bb" });
    expect(ana.version as number).toBeGreaterThan(byId(drawn, "ana").version as number);
    const label = labelOf(r.elements, "ana");
    const mid = (label.y as number) + (label.height as number) / 2;
    expect(Math.abs(mid - (300 + (ana.height as number) / 2))).toBeLessThan(0.2);
    expect(labelOf(r.elements, "meta").text).toBe("Metaphase (aligned)");
    // The arrow into Anaphase was re-routed to its new place.
    expect(byId(r.elements, "m-a").version as number).toBeGreaterThan(
      byId(drawn, "m-a").version as number,
    );
    // The input scene is untouched.
    expect(byId(drawn, "ana").y).toBe(320);
  });

  it("deletes a shape with its label and the arrows connected to it", () => {
    const drawn = applyOps([], MITOSIS, notes).elements;
    const r = applyOps(drawn, [{ op: "delete", id: "meta" }], notes);
    expect(r.deleted).toEqual(expect.arrayContaining(["meta", "p-m", "m-a"]));
    const left = live(r.elements).map((e) => e.id);
    expect(left).not.toContain("meta");
    expect(left).not.toContain("p-m");
    expect(left).not.toContain(labelOf(drawn, "meta").id);
    expect(
      (byId(r.elements, "pro").boundElements as { id: string }[]).map((b) => b.id),
    ).not.toContain("p-m");
  });

  it("skips what it can't do and says why", () => {
    const drawn = applyOps([], MITOSIS, notes).elements;
    const r = applyOps(
      drawn,
      [
        { op: "add", id: "pro", text: "again" },
        { op: "add", type: "star" },
        { op: "arrow", from: "pro", to: "nowhere" },
        { op: "change", id: "p-m", x: 4 },
        { op: "change", id: "missing", x: 4 },
        { op: "add", x: 3 },
        { op: "add", type: "noteCard", note: "Medical/scan.md" },
        { op: "add", type: "noteCard", note: "School/Bio.md" },
      ],
      notes,
    );
    expect(r.problems).toHaveLength(7);
    expect(r.problems.join("\n")).toMatch(/already used/);
    expect(r.problems.join("\n")).toMatch(/isn't a shape type/);
    expect(r.problems.join("\n")).toMatch(/no shape with id "nowhere"/);
    expect(r.problems.join("\n")).toMatch(/arrows follow/);
    expect(r.problems.join("\n")).toMatch(/no note at "Medical\/scan.md"/);
    // The one that worked was still applied.
    expect(live(r.elements).find((e) => e.type === "embeddable")?.link).toBe("axis:School/Bio.md");
  });

  it("summarizes the canvas with labels folded in and private cards hidden", () => {
    const drawn = applyOps(
      [],
      [
        ...MITOSIS,
        { op: "add", type: "noteCard", note: "School/Bio.md", x: 600, y: 0 },
        { op: "add", type: "noteCard", note: "Journal/day.md", x: 600, y: 300 },
      ],
      notes,
    ).elements;
    const { items, truncated } = summarize(drawn, (n) => !n.startsWith("Journal/"));
    expect(truncated).toBe(false);
    expect(items.map((i) => i.type)).toEqual([
      "rectangle",
      "diamond",
      "rectangle",
      "arrow",
      "arrow",
      "noteCard",
      "noteCard",
    ]);
    expect(items[0]).toMatchObject({ id: "pro", text: "Prophase", x: 0, y: 0 });
    expect(items[3]).toMatchObject({ from: "pro", to: "meta", label: "then" });
    expect(items[5]).toMatchObject({ note: "School/Bio.md" });
    expect(items[6]).toEqual(expect.objectContaining({ private: true }));
    expect(JSON.stringify(items)).not.toContain("Journal");
  });
});

describe("draw answers", () => {
  const answer = JSON.stringify({ ops: MITOSIS, reply: "Drew the phases." });

  it("parses the finished answer, refusing other shapes", () => {
    expect(parseDrawAnswer("```json\n" + answer + "\n```")).toEqual({
      ops: MITOSIS,
      reply: "Drew the phases.",
    });
    expect(() => parseDrawAnswer('{"ops": [{"op": "paint"}]}')).toThrow(InvalidAnswer);
    expect(() => parseDrawAnswer('{"reply": "no ops"}')).toThrow(/"ops" must be an array/);
  });

  it("reads the complete operations of an answer still arriving", () => {
    const counts: number[] = [];
    for (let i = 0; i <= answer.length; i += 7)
      counts.push(partialDraw(answer.slice(0, i)).ops.length);
    expect(counts[0]).toBe(0);
    expect([...counts].sort((a, b) => a - b)).toEqual(counts); // never goes backwards
    // An operation counts once its closing brace has arrived.
    const firstEnd = answer.indexOf("}") + 1;
    expect(partialDraw(answer.slice(0, firstEnd - 1)).ops).toHaveLength(0);
    expect(partialDraw(answer.slice(0, firstEnd)).ops).toEqual([MITOSIS[0]]);
    expect(partialDraw(answer).ops).toEqual(MITOSIS);
    expect(partialDraw(answer.slice(0, answer.indexOf("phases.") + 3)).reply).toBe("Drew the pha");
  });

  it("puts a draft over the current scene and takes it back without touching other edits", () => {
    const base = applyOps(
      [],
      [{ op: "add", id: "keep", text: "Keep", x: 0, y: 0 }],
      notes,
    ).elements;
    const first = applyOps(base, [MITOSIS[0]!], notes).elements;
    const t1 = touchedIds(base, first);
    expect([...t1]).toContain("pro");
    expect([...t1]).not.toContain("keep");
    // The user edits "keep" while the AI is drawing.
    const edited = base.map((e) => (e.id === "keep" ? { ...e, x: 50, version: 9 } : e));
    const shown = overlay(edited, base, first, t1, new Set());
    expect(byId(shown, "keep").x).toBe(50);
    expect(shown.some((e) => e.id === "pro")).toBe(true);
    // Taken back: the draft goes, the user's edit stays.
    const back = overlay(shown, base, base, new Set(), t1);
    expect(back.some((e) => e.id === "pro")).toBe(false);
    expect(byId(back, "keep").x).toBe(50);
  });
});
