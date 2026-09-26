import type { TagCount } from "../../ipc";

export interface TagNode {
  name: string;
  /** Full tag path, e.g. `work/projects/alpha`. */
  tag: string;
  /** Notes with exactly this tag. */
  count: number;
  /** Notes with this tag or any child tag (upper bound: a note may have several). */
  total: number;
  children: TagNode[];
}

/** Build a hierarchy from flat nested tags (`a/b/c`). */
export function buildTagTree(tags: TagCount[]): TagNode[] {
  const root: TagNode = { name: "", tag: "", count: 0, total: 0, children: [] };
  for (const { tag, count } of tags) {
    let node = root;
    const parts = tag.split("/");
    parts.forEach((part, i) => {
      const full = parts.slice(0, i + 1).join("/");
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = { name: part, tag: full, count: 0, total: 0, children: [] };
        node.children.push(child);
      }
      child.total += count;
      if (i === parts.length - 1) child.count += count;
      node = child;
    });
  }
  const sort = (nodes: TagNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name));
    nodes.forEach((n) => sort(n.children));
  };
  sort(root.children);
  return root.children;
}
