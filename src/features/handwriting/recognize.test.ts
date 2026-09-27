import { describe, expect, it } from "vitest";
import type { Speller } from "../spellcheck/engine";
import { flagWords, handwritingRequest, joinPieces, type Piece } from "./recognize";

const speller = (bad: string[], suggestions: Record<string, string[]> = {}): Speller => ({
  check: (words) => Promise.resolve(words.map((w) => !bad.includes(w))),
  suggest: (w) => Promise.resolve(suggestions[w] ?? []),
});

const flags = (pieces: Piece[]) =>
  pieces.flatMap((p) => (p.kind === "flag" ? [[p.word, p.reason, p.alternatives]] : []));

describe("handwritingRequest", () => {
  it("sends the image to the handwriting task in JSON mode", () => {
    const req = handwritingRequest({ mime: "image/png", data: "AAAA" }, ["Board.axcanvas"]);
    expect(req).toMatchObject({ task: "handwriting", json: true, sources: ["Board.axcanvas"] });
    expect(req.messages[1]!.content[0]).toEqual({ type: "image", mime: "image/png", data: "AAAA" });
  });
});

describe("flagWords", () => {
  it("flags the model's uncertain words at the right occurrence", async () => {
    const pieces = await flagWords({
      text: "the cat saw the cot",
      uncertain: [
        { word: "the", occurrence: 2, alternatives: ["thy", "the"], reason: "unclear" },
        { word: "cot", alternatives: ["cat", "cut"], reason: "unclear" },
        { word: "dog", alternatives: [], reason: "unclear" }, // not in the text: ignored
      ],
    });
    expect(pieces).toEqual([
      { kind: "text", text: "the cat saw " },
      { kind: "flag", id: 0, word: "the", alternatives: ["thy"], reason: "unclear" },
      { kind: "text", text: " " },
      { kind: "flag", id: 1, word: "cot", alternatives: ["cat", "cut"], reason: "unclear" },
    ]);
  });

  it("adds words the dictionary doesn't know, without double-flagging", async () => {
    const pieces = await flagWords(
      {
        text: "Mitocondria make ATP\n- recieve energy",
        uncertain: [{ word: "Mitocondria", alternatives: ["Mitochondria"], reason: "misspelled" }],
      },
      speller(["Mitocondria", "recieve"], { recieve: ["receive"] }),
    );
    expect(flags(pieces)).toEqual([
      ["Mitocondria", "misspelled", ["Mitochondria"]],
      ["recieve", "spelling", ["receive"]],
    ]);
  });

  it("joins the text back with the chosen fixes", async () => {
    const pieces = await flagWords({
      text: "one twa three",
      uncertain: [{ word: "twa", alternatives: ["two"], reason: "unclear" }],
    });
    expect(joinPieces(pieces, new Map())).toBe("one twa three");
    expect(joinPieces(pieces, new Map([[0, "two"]]))).toBe("one two three");
  });

  it("matches whole words only", async () => {
    const pieces = await flagWords({
      text: "cathedral cat",
      uncertain: [{ word: "cat", alternatives: ["cot"], reason: "unclear" }],
    });
    expect(pieces[0]).toEqual({ kind: "text", text: "cathedral " });
  });
});
