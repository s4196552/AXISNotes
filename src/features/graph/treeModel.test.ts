import { describe, expect, it } from "vitest";
import type { GraphData } from "../../ipc";
import {
  buildTree,
  busiestNote,
  layoutTree,
  levelTitle,
  pathTo,
  TREE_DIMS,
  type TreeNode,
} from "./treeModel";

const node = (id: string, unresolved = false) => ({
  id,
  name: id.replace(/^\?/, "").replace(/\.md$/, "").split("/").pop()!,
  tags: [],
  unresolved,
});

// Product → three features → two developments each; one loop back to Product.
const DATA: GraphData = {
  nodes: [
    node("Product.md"),
    node("Plan/Import.md"),
    node("Plan/Visual.md"),
    node("Plan/UX.md"),
    node("Plan/Dev/Rapid.md"),
    node("Plan/Dev/Thorough.md"),
    node("Lonely.md"),
    node("?Ghost", true),
  ],
  edges: [
    { source: "Product.md", target: "Plan/Import.md" },
    { source: "Product.md", target: "Plan/Visual.md" },
    { source: "Product.md", target: "Plan/UX.md" },
    { source: "Plan/Visual.md", target: "Plan/Dev/Rapid.md" },
    { source: "Plan/Visual.md", target: "Plan/Dev/Thorough.md" },
    { source: "Plan/UX.md", target: "Plan/Dev/Rapid.md" },
    { source: "Plan/Dev/Rapid.md", target: "Product.md" },
    { source: "Plan/Import.md", target: "?Ghost" },
  ],
};

const outline = (t: TreeNode | null, depth = 0): string[] =>
  t ? [`${"  ".repeat(depth)}${t.label}`, ...t.children.flatMap((c) => outline(c, depth + 1))] : [];

const base = { direction: "links" as const, root: "Product.md", depth: 3, showUnresolved: false };

describe("tree model", () => {
  it("follows links breadth first, placing each note once at its shallowest level", () => {
    const { root, count, truncated } = buildTree(DATA, base);
    // Siblings are alphabetical, so UX reaches Rapid before Visual does.
    expect(outline(root)).toEqual([
      "Product",
      "  Import",
      "  UX",
      "    Rapid",
      "  Visual",
      "    Thorough",
    ]);
    expect(count).toBe(6);
    expect(truncated).toBe(false);
    // Visual → Rapid and Rapid → Product are already drawn: counted, not repeated.
    const visual = root!.children.find((c) => c.label === "Visual")!;
    expect(visual.elsewhere).toBe(1);
    const rapid = root!.children.find((c) => c.label === "UX")!.children[0]!;
    expect(rapid.elsewhere).toBe(1);
  });

  it("shows unresolved links on request and stops at the depth limit", () => {
    const withGhost = buildTree(DATA, { ...base, showUnresolved: true });
    const imp = withGhost.root!.children.find((c) => c.label === "Import")!;
    expect(imp.children.map((c) => [c.label, c.unresolved])).toEqual([["Ghost", true]]);

    const shallow = buildTree(DATA, { ...base, depth: 1 });
    expect(outline(shallow.root)).toEqual(["Product", "  Import", "  UX", "  Visual"]);
    const visual = shallow.root!.children.find((c) => c.label === "Visual")!;
    expect(visual.beyond).toBe(2);
  });

  it("follows backlinks", () => {
    const { root } = buildTree(DATA, {
      ...base,
      direction: "backlinks",
      root: "Plan/Dev/Rapid.md",
    });
    expect(outline(root)).toEqual(["Rapid", "  UX", "    Product", "  Visual"]);
  });

  it("has no tree without a valid root, and caps big trees", () => {
    expect(buildTree(DATA, { ...base, root: null }).root).toBeNull();
    expect(buildTree(DATA, { ...base, root: "Gone.md" }).root).toBeNull();
    const capped = buildTree(DATA, { ...base, maxNodes: 3 });
    expect(capped.count).toBe(3);
    expect(capped.truncated).toBe(true);
  });

  it("draws the folder hierarchy, folders before notes, with a depth limit", () => {
    const { root, count } = buildTree(DATA, { ...base, direction: "folders" });
    expect(outline(root)).toEqual([
      "Vault",
      "  Plan",
      "    Dev",
      "      Rapid",
      "      Thorough",
      "    Import",
      "    UX",
      "    Visual",
      "  Lonely",
      "  Product",
    ]);
    expect(count).toBe(10);
    expect(root!.children[0]).toMatchObject({ id: "Plan/", folder: true });

    const two = buildTree(DATA, { ...base, direction: "folders", depth: 2 });
    const plan = two.root!.children[0]!;
    expect(plan.children.map((c) => c.label)).toEqual(["Dev", "Import", "UX", "Visual"]);
    expect(plan.children[0]).toMatchObject({ children: [], beyond: 2 });
  });

  it("picks the busiest resolved note as a default root", () => {
    expect(busiestNote(DATA)).toBe("Product.md");
    expect(busiestNote({ nodes: [], edges: [] })).toBeNull();
  });
});

describe("tree layout", () => {
  const tree = buildTree(DATA, base).root;

  it("puts levels in columns, leaves on rows and parents centred on their children", () => {
    const layout = layoutTree(tree, new Set());
    const at = (label: string) => layout.nodes.find((n) => n.node.label === label)!;
    expect(layout.levels).toBe(3);
    // Depth-first: reading order, top to bottom.
    expect(layout.nodes.map((n) => n.node.label)).toEqual([
      "Product",
      "Import",
      "UX",
      "Rapid",
      "Visual",
      "Thorough",
    ]);
    expect(at("Import").x - at("Product").x).toBe(TREE_DIMS.column);
    expect(at("Rapid").x - at("Import").x).toBe(TREE_DIMS.column);
    expect(at("Thorough").y - at("Rapid").y).toBe(TREE_DIMS.row);
    expect(at("UX").y).toBe(at("Rapid").y);
    expect(at("Product").y).toBe((at("Import").y + at("Visual").y) / 2);
    expect(layout.width).toBe(TREE_DIMS.pad * 2 + 3 * TREE_DIMS.column);

    // Elbows leave the parent from its middle (up or down); level children go straight.
    expect(layout.edges).toHaveLength(5);
    const toRapid = layout.edges.find((e) => e.to === "Plan/Dev/Rapid.md")!;
    expect(toRapid.d).toMatch(/^M[\d.]+,[\d.]+ H[\d.]+$/);
    const toImport = layout.edges.find((e) => e.to === "Plan/Import.md")!;
    expect(toImport.d).toMatch(/^M[\d.]+,[\d.]+ V[\d.]+ H[\d.]+$/);
  });

  it("hides collapsed subtrees", () => {
    const layout = layoutTree(tree, new Set(["Plan/Visual.md", "Plan/UX.md"]));
    expect(layout.nodes.map((n) => n.node.label)).toEqual(["Product", "Import", "UX", "Visual"]);
    expect(layout.nodes.find((n) => n.node.label === "Visual")!.collapsed).toBe(true);
    expect(layout.levels).toBe(2);
    // A leaf can't be collapsed.
    expect(layoutTree(tree, new Set(["Plan/Import.md"])).nodes).toHaveLength(6);
  });

  it("finds the path from the root to a note", () => {
    const layout = layoutTree(tree, new Set());
    expect([...pathTo(layout, "Plan/Dev/Thorough.md")]).toEqual([
      "Plan/Dev/Thorough.md",
      "Plan/Visual.md",
      "Product.md",
    ]);
    expect(pathTo(layout, "Lonely.md").size).toBe(0);
    expect(pathTo(layout, null).size).toBe(0);
    expect(layoutTree(null, new Set())).toMatchObject({ nodes: [], levels: 0 });
  });

  it("titles the columns", () => {
    expect(levelTitle("links", 0)).toBe("Root");
    expect(levelTitle("links", 1)).toBe("Links · 1 step");
    expect(levelTitle("backlinks", 2)).toBe("Backlinks · 2 steps");
    expect(levelTitle("folders", 0)).toBe("Vault");
    expect(levelTitle("folders", 3)).toBe("Level 3");
  });
});
