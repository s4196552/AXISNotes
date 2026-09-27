import mermaid from "mermaid";
import { describe, expect, it } from "vitest";
import { InvalidAnswer } from "./aiJson";
import {
  checkGraph,
  type DiagramGraph,
  graphToMermaid,
  graphToSkeleton,
  layoutGraph,
  linksToGraph,
  outlineToGraph,
  parseGraph,
  plainLabel,
} from "./diagram";

const flow: DiagramGraph = {
  kind: "flowchart",
  direction: "down",
  nodes: [
    { id: "a", label: "Start" },
    { id: "b", label: 'Is it "ready"?', shape: "diamond" },
    { id: "c", label: "Ship", shape: "round" },
    { id: "d", label: "Fix (again)" },
  ],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c", label: "yes" },
    { from: "b", to: "d", label: "no" },
    { from: "d", to: "b" },
  ],
};

describe("graph checks", () => {
  it("accepts a valid graph", () => {
    expect(checkGraph(flow)).toEqual([]);
  });

  it("reports duplicate ids, dangling edges and broken mind maps", () => {
    expect(
      checkGraph({
        kind: "flowchart",
        nodes: [
          { id: "a", label: "A" },
          { id: "a", label: "" },
        ],
        edges: [{ from: "a", to: "zz" }],
      }),
    ).toEqual([
      'node id "a" is used twice',
      "nodes[1].label is empty",
      'edges[0].to "zz" is not a node id',
    ]);
    expect(
      checkGraph({
        kind: "mindmap",
        nodes: [
          { id: "r", label: "R" },
          { id: "x", label: "X" },
          { id: "y", label: "Y" },
        ],
        edges: [
          { from: "r", to: "x" },
          { from: "y", to: "x" },
        ],
      }),
    ).toEqual([
      'mind map node "x" has 2 parents; each node needs one',
      'mind map node "y" is not connected to the center',
    ]);
  });

  it("parseGraph combines the schema and graph checks", () => {
    expect(() => parseGraph('{"kind":"pie","nodes":[],"edges":[]}')).toThrow(InvalidAnswer);
    expect(() =>
      parseGraph(
        '{"kind":"flowchart","nodes":[{"id":"a","label":"A"}],"edges":[{"from":"a","to":"b"}]}',
      ),
    ).toThrow(/edges\[0\]\.to "b" is not a node id/);
  });
});

describe("Mermaid output", () => {
  it("writes flowcharts with quoted labels and shapes", async () => {
    const code = graphToMermaid(flow);
    expect(code).toBe(
      [
        "flowchart TD",
        '  n0["Start"]',
        '  n1{"Is it #quot;ready#quot;?"}',
        '  n2("Ship")',
        '  n3["Fix (again)"]',
        "  n0 --> n1",
        '  n1 -->|"yes"| n2',
        '  n1 -->|"no"| n3',
        "  n3 --> n1",
      ].join("\n"),
    );
    await expect(mermaid.parse(code)).resolves.toBeTruthy();
  });

  it("writes mind maps as an indented tree", async () => {
    const g = outlineToGraph(
      "---\ntags: [x]\n---\n# Cells\n\n## Parts\n- Nucleus (control)\n  - DNA\n- [[Mitochondria|Mito]]\n\n## Division\n1. Mitosis\n",
      "Bio",
    );
    const code = graphToMermaid(g);
    expect(code).toBe(
      [
        "mindmap",
        "  n0((Cells))",
        "    n1[Parts]",
        "      n2[Nucleus control]",
        "        n3[DNA]",
        "      n4[Mito]",
        "    n5[Division]",
        "      n6[Mitosis]",
      ].join("\n"),
    );
    await expect(mermaid.parse(code)).resolves.toBeTruthy();
  });
});

describe("structure without AI", () => {
  it("uses the title as the center when there is no H1, and skips code", () => {
    const g = outlineToGraph("Intro text\n- one\n```\n- not a bullet\n```\n- two\n", "Notes");
    expect(g.nodes.map((n) => n.label)).toEqual(["Notes", "one", "two"]);
    expect(g.edges).toEqual([
      { from: "n0", to: "n1" },
      { from: "n0", to: "n2" },
    ]);
  });

  it("cleans Markdown out of labels", () => {
    expect(plainLabel("**Bold** and `code` [[Note#H|alias]] [site](http://x) ^id")).toBe(
      "Bold and code alias site",
    );
    expect(plainLabel("[x] done task")).toBe("done task");
  });

  it("maps a note's links both ways", () => {
    const g = linksToGraph("A.md", {
      nodes: [
        { id: "A.md", name: "A", tags: [], unresolved: false },
        { id: "B.md", name: "B", tags: [], unresolved: false },
        { id: "C.md", name: "C", tags: [], unresolved: false },
        { id: "?Missing", name: "Missing", tags: [], unresolved: true },
        { id: "Far.md", name: "Far", tags: [], unresolved: false },
      ],
      edges: [
        { source: "A.md", target: "B.md" },
        { source: "C.md", target: "A.md" },
        { source: "A.md", target: "?Missing" },
        { source: "B.md", target: "C.md" },
        { source: "B.md", target: "Far.md" },
      ],
    });
    expect(g.nodes.map((n) => [n.label, n.shape])).toEqual([
      ["A", "round"],
      ["B", "box"],
      ["C", "box"],
      ["Missing", "circle"],
    ]);
    expect(g.edges).toHaveLength(4); // includes B → C, not B → Far
  });
});

describe("canvas layout", () => {
  it("lays a flowchart out in layers without overlaps", () => {
    const placed = layoutGraph(flow);
    const at = new Map(placed.map((n) => [n.id, n]));
    expect(at.get("a")!.y).toBeLessThan(at.get("b")!.y);
    expect(at.get("b")!.y).toBeLessThan(at.get("c")!.y);
    expect(at.get("c")!.y).toBe(at.get("d")!.y);
    for (const p of placed)
      for (const q of placed)
        if (p !== q)
          expect(
            p.x + p.width <= q.x ||
              q.x + q.width <= p.x ||
              p.y + p.height <= q.y ||
              q.y + q.height <= p.y,
          ).toBe(true);
    expect(Math.min(...placed.map((n) => n.x))).toBe(0);
  });

  it("lays a mind map out left to right", () => {
    const placed = layoutGraph(outlineToGraph("- a\n  - a1\n  - a2\n- b\n", "Root"));
    const at = new Map(placed.map((n) => [n.label, n]));
    expect(at.get("Root")!.x).toBe(0);
    expect(at.get("a")!.x).toBeGreaterThan(0);
    expect(at.get("a1")!.x).toBeGreaterThan(at.get("a")!.x);
    expect(at.get("a2")!.y).toBeGreaterThan(at.get("a1")!.y);
  });

  it("produces labelled shapes and bound arrows", () => {
    const els = graphToSkeleton(flow, { x: 100, y: 50 }) as {
      type: string;
      id?: string;
      x: number;
      start?: { id: string };
      label?: { text: string };
    }[];
    const shapes = els.filter((e) => e.type !== "arrow");
    expect(shapes.map((e) => e.type)).toEqual(["rectangle", "diamond", "rectangle", "rectangle"]);
    expect(shapes[0]!.label!.text).toBe("Start");
    const arrows = els.filter((e) => e.type === "arrow");
    expect(arrows).toHaveLength(4);
    expect(arrows[0]!.start!.id).toBe(shapes[0]!.id);
    expect(Math.min(...shapes.map((e) => e.x))).toBe(100);
  });
});
