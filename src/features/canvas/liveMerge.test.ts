import { describe, expect, it } from "vitest";
import type { Lib } from "./loadExcalidraw";
import { mergeOutside, needsRemeasure, REMEASURE, remeasure } from "./liveMerge";

type El = Record<string, unknown> & { id: string; version?: number };

// A stand-in for Excalidraw: "measuring" makes text 10 px per character and 20 px a line.
const lib = {
  restoreElements: (els: El[], _local: unknown, opts?: { refreshDimensions?: boolean }) =>
    els.map((e) =>
      opts?.refreshDimensions && e.type === "text"
        ? { ...e, width: String(e.text).length * 10, height: 20 }
        : { ...e },
    ),
  reconcileElements: (local: El[], remote: El[]) => {
    const out = new Map(local.map((e) => [e.id, e]));
    for (const r of remote) {
      const l = out.get(r.id);
      if (!l || (r.version ?? 1) > (l.version ?? 1)) out.set(r.id, r);
    }
    return [...out.values()];
  },
} as unknown as Lib;

const flag = { [REMEASURE]: true };

describe("remeasure", () => {
  it("measures flagged labels, centres them and grows shapes that are too small", () => {
    const els: El[] = [
      { id: "box", type: "rectangle", x: 0, y: 0, width: 100, height: 20, version: 1 },
      {
        id: "lbl",
        type: "text",
        text: "Prophase",
        containerId: "box",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        version: 1,
        customData: flag,
      },
      { id: "free", type: "text", text: "kept as is", width: 5, height: 5, version: 1 },
    ];
    expect(needsRemeasure(els)).toBe(true);
    const out = remeasure(lib, els) as El[];
    const by = (id: string) => out.find((e) => e.id === id)!;
    expect(by("lbl")).toMatchObject({ width: 80, height: 20, x: 10, version: 2 });
    expect(by("lbl").customData).toEqual({});
    expect(by("box")).toMatchObject({ height: 30, version: 2 }); // 20 + padding
    expect(by("lbl").y).toBe(5); // centred in the grown box
    expect(by("free")).toMatchObject({ width: 5, height: 5 }); // not flagged: untouched
    expect(needsRemeasure(out)).toBe(false);
  });

  it("centres an arrow's label on its midpoint", () => {
    const out = remeasure(lib, [
      {
        id: "a",
        type: "arrow",
        x: 0,
        y: 0,
        points: [
          [0, 0],
          [200, 100],
        ],
        version: 1,
      },
      { id: "l", type: "text", text: "then", containerId: "a", customData: flag, version: 1 },
    ]) as El[];
    expect(out[1]).toMatchObject({ x: 100 - 20, y: 50 - 10 });
  });
});

describe("mergeOutside", () => {
  const prev: El[] = [
    { id: "a", type: "rectangle", version: 1 },
    { id: "b", type: "rectangle", version: 1 },
  ];

  it("takes the file as it is when nothing is unsaved", () => {
    const out = mergeOutside(
      lib,
      prev,
      prev,
      [{ id: "c", type: "ellipse", version: 1 }],
      {},
      false,
    );
    expect((out as El[]).map((e) => e.id)).toEqual(["c"]);
  });

  it("keeps unsaved edits and newer outside changes, and removes what the file dropped", () => {
    const local: El[] = [
      { id: "a", type: "rectangle", version: 1 },
      { id: "b", type: "rectangle", version: 4, x: 50 }, // moved here
      { id: "ink", type: "freedraw", version: 1 }, // drawn here
    ];
    // Outside: "a" deleted, "b" also dropped (but edited here, so kept), "c" added.
    const out = mergeOutside(
      lib,
      local,
      prev,
      [{ id: "c", type: "diamond", version: 1 }],
      {},
      true,
    ) as El[];
    const live = out.filter((e) => !e.isDeleted).map((e) => e.id);
    expect(live).toEqual(["b", "ink", "c"]);
    expect(out.find((e) => e.id === "b")).toMatchObject({ x: 50 });
  });
});
