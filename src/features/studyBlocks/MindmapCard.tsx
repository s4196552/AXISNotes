import { useMemo, type CSSProperties } from "react";
import { ChevronsDownUp, ChevronsUpDown, Copy, Network } from "lucide-react";
import { useAppStore } from "../../app/store";
import { layoutTree, TREE_DIMS, type TreeNode } from "../graph/treeModel";
import { type MindmapBlock, type MindNode, toMermaidMindmap } from "./model";
import type { StudyCardHost } from "./studyBlocks";
import { Shell, Text } from "./shared";
import { useSession } from "./session";

// A ```mindmap block (T-267): the nested list drawn as a tree with the graph view's tree
// layout (features/graph/treeModel.ts), each main branch in its own colour. Folding is
// for this sitting only; the note keeps just the list.

const BRANCH_COLORS = [
  "var(--callout-blue)",
  "var(--callout-green)",
  "var(--callout-orange)",
  "var(--callout-purple)",
  "var(--callout-red)",
  "var(--callout-cyan)",
];

/** The mind map as the tree layout's nodes, coloured by main branch. */
function toTree(root: MindNode): { tree: TreeNode; labels: Map<string, string> } {
  const labels = new Map<string, string>();
  const convert = (n: MindNode, color: string): TreeNode => {
    labels.set(n.id, n.label);
    return {
      id: n.id,
      label: n.label,
      color,
      unresolved: false,
      folder: false,
      children: n.children.map((c) => convert(c, color)),
      elsewhere: 0,
      beyond: 0,
    };
  };
  labels.set(root.id, root.label);
  const tree: TreeNode = {
    id: root.id,
    label: root.label,
    color: "var(--accent)",
    unresolved: false,
    folder: false,
    children: root.children.map((c, i) => convert(c, BRANCH_COLORS[i % BRANCH_COLORS.length]!)),
    elsewhere: 0,
    beyond: 0,
  };
  return { tree, labels };
}

const withChildren = (n: MindNode): string[] =>
  n.children.length ? [n.id, ...n.children.flatMap(withChildren)] : [];

export function MindmapView({ block, host }: { block: MindmapBlock; host: StudyCardHost }) {
  const { tree, labels } = useMemo(() => toTree(block.root), [block]);
  const [collapsed, setCollapsed] = useSession<string[]>(host, () => []);
  const folded = useMemo(() => new Set(collapsed), [collapsed]);
  const layout = useMemo(() => layoutTree(tree, folded), [tree, folded]);
  const colorOf = useMemo(
    () => new Map(layout.nodes.map((p) => [p.node.id, p.node.color] as const)),
    [layout],
  );
  const { boxWidth: W, boxHeight: H, header } = TREE_DIMS;
  const top = header; // the layout leaves room for column titles; mind maps have none

  const toggle = (id: string) =>
    setCollapsed(folded.has(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id]);
  const copyMermaid = () => {
    const text = "```mermaid\n" + toMermaidMindmap(block.root) + "\n```\n";
    const notify = useAppStore.getState().notify;
    void navigator.clipboard.writeText(text).then(
      () => notify("Copied the mind map as a Mermaid diagram."),
      () => notify("Couldn't copy to the clipboard."),
    );
  };

  return (
    <Shell
      kind="mindmap"
      icon={<Network size={18} />}
      title={block.header.title ?? (block.root.id === "root" ? null : block.root.label)}
      host={host}
      sub={
        <>
          {block.count} {block.count === 1 ? "idea" : "ideas"}
        </>
      }
      actions={
        <>
          <button
            type="button"
            aria-label="Expand all"
            title="Expand all"
            onClick={() => setCollapsed([])}
          >
            <ChevronsUpDown size={14} />
          </button>
          <button
            type="button"
            aria-label="Collapse all"
            title="Collapse all"
            onClick={() => setCollapsed(block.root.children.flatMap(withChildren))}
          >
            <ChevronsDownUp size={14} />
          </button>
          <button
            type="button"
            aria-label="Copy as Mermaid"
            title="Copy as a Mermaid mindmap block"
            onClick={copyMermaid}
          >
            <Copy size={14} />
          </button>
        </>
      }
    >
      <div className="mindmap-scroll">
        <div
          className="mindmap-canvas"
          style={{ width: layout.width, height: layout.height - top }}
          role="tree"
          aria-label={block.header.title ?? block.root.label}
        >
          <svg
            className="mindmap-edges"
            width={layout.width}
            height={layout.height - top}
            aria-hidden
          >
            <g transform={`translate(0,${-top})`}>
              {layout.edges.map((e) => {
                return (
                  <path key={e.to} d={e.d} style={{ stroke: colorOf.get(e.to) } as CSSProperties} />
                );
              })}
            </g>
          </svg>
          {layout.nodes.map((p) => {
            const kids = p.node.children.length;
            return (
              <div
                key={p.node.id}
                className={`mindmap-node${p.depth === 0 ? " root" : ""}`}
                role="treeitem"
                aria-level={p.depth + 1}
                aria-expanded={kids ? !p.collapsed : undefined}
                style={
                  {
                    left: p.x,
                    top: p.y - top,
                    width: W,
                    height: H,
                    "--branch": p.node.color,
                  } as CSSProperties
                }
                title={labels.get(p.node.id)}
              >
                <span className="mindmap-label">
                  <Text text={labels.get(p.node.id) ?? ""} from={host.path} />
                </span>
                {kids > 0 && (
                  <button
                    type="button"
                    className="mindmap-fold"
                    aria-label={p.collapsed ? `Show ${kids} under this` : "Hide what's under this"}
                    title={p.collapsed ? `Show ${kids}` : "Fold"}
                    onClick={() => toggle(p.node.id)}
                  >
                    {p.collapsed ? `+${kids}` : "−"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
