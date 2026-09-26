// STUB — replaced by task T-003 (Codex). Contract: see .agents/briefs/T-003.md.
import { useAppStore } from "../../app/store";
import type { VaultEntry } from "../../ipc";

function flatten(e: VaultEntry): VaultEntry[] {
  return (e.children ?? []).flatMap((c) => (c.kind === "file" ? [c] : flatten(c)));
}

export function FileTree() {
  const tree = useAppStore((s) => s.tree);
  const openFile = useAppStore((s) => s.openFile);
  if (!tree) return null;
  return (
    <ul>
      {flatten(tree).map((f) => (
        <li key={f.path}>
          <button onClick={() => openFile(f.path)}>{f.path}</button>
        </li>
      ))}
    </ul>
  );
}
