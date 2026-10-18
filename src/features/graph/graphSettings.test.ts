import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import * as d3 from "d3-force";
import {
  DEFAULT_SETTINGS,
  loadGraphSettings,
  sanitizeSettings,
  useGraphSettings,
} from "./graphSettings";
import { applyForces, createSimulation, preTick, type SimNode } from "./forces";

describe("graph settings", () => {
  beforeEach(() => localStorage.clear());

  it("falls back to defaults for missing, wrong-typed or out-of-range values", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings("nope")).toEqual(DEFAULT_SETTINGS);
    const s = sanitizeSettings({
      mode: "tree",
      query: 5,
      showOrphans: false,
      groups: [
        { query: "tag:a", color: "#AABBCC" },
        { query: "tag:b", color: "red" },
        null,
        { color: "#000000" },
      ],
      display: { arrows: "yes", textFade: 99, nodeSize: Number.NaN, linkThickness: 2 },
      forces: { center: -1, repel: 4, linkDistance: "far" },
      tree: { direction: "sideways", depth: 2.6 },
    });
    expect(s).toEqual({
      ...DEFAULT_SETTINGS,
      mode: "tree",
      showOrphans: false,
      groups: [{ query: "tag:a", color: "#AABBCC" }],
      display: { ...DEFAULT_SETTINGS.display, textFade: 20, linkThickness: 2 },
      forces: { ...DEFAULT_SETTINGS.forces, center: 0, repel: 4 },
      tree: { direction: "links", depth: 3 },
    });
  });

  it("survives unreadable storage and saves changes", () => {
    localStorage.setItem("axisnotes.graph", "{not json");
    expect(loadGraphSettings()).toEqual(DEFAULT_SETTINGS);

    const { result } = renderHook(() => useGraphSettings());
    act(() => result.current[1]((s) => ({ ...s, mode: "tree" })));
    expect(result.current[0].mode).toBe("tree");
    expect(loadGraphSettings().mode).toBe("tree");
  });
});

describe("graph forces", () => {
  const nodes = (): SimNode[] =>
    ["a", "b", "c", "d"].map((id, i) => ({ id, x: i * 37 - 50, y: (i % 2) * 41 - 20 }));
  const links = () => [
    { source: "a", target: "b" },
    { source: "b", target: "c" },
  ];
  const dist = (p: SimNode, q: SimNode) => Math.hypot(p.x! - q.x!, p.y! - q.y!);

  it("settles: linked notes end up closer than unlinked ones, and it stops", () => {
    const ns = nodes();
    const sim = createSimulation(d3, ns, links(), DEFAULT_SETTINGS.forces);
    const ticks = preTick(sim, 5000);
    expect(ticks).toBeGreaterThan(0);
    expect(sim.alpha()).toBeLessThan(sim.alphaMin());
    const [a, b, , d] = ns as [SimNode, SimNode, SimNode, SimNode];
    expect(dist(a, b)).toBeLessThan(dist(a, d));
  });

  it("link distance and repel change the spread", () => {
    const spread = (f: typeof DEFAULT_SETTINGS.forces) => {
      const ns = nodes();
      const sim = createSimulation(d3, ns, links(), f);
      preTick(sim, 5000);
      return dist(ns[0]!, ns[1]!);
    };
    const near = spread({ ...DEFAULT_SETTINGS.forces, linkDistance: 30, repel: 1 });
    const far = spread({ ...DEFAULT_SETTINGS.forces, linkDistance: 500, repel: 20 });
    expect(far).toBeGreaterThan(near * 2);
  });

  it("applies new forces to the same simulation, keeping its links", () => {
    const ns = nodes();
    const sim = createSimulation(d3, ns, links(), DEFAULT_SETTINGS.forces);
    applyForces(d3, sim, { ...DEFAULT_SETTINGS.forces, linkDistance: 400 }, ns.length);
    const link = sim.force<d3.ForceLink<SimNode, d3.SimulationLinkDatum<SimNode>>>("link")!;
    expect(link.links()).toHaveLength(2);
    expect(link.distance()(link.links()[0]!, 0, link.links())).toBe(80);
  });
});
