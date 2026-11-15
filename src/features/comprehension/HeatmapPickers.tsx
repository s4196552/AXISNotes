import { useMemo } from "react";
import { FileText, Folder, Grid3x3, Plus } from "lucide-react";
import type { VaultEntry } from "../../ipc";
import { useAppStore } from "../../app/store";
import { isNotePath } from "../../lib/markdown";
import { Picker, type PickerItem } from "../commands/Picker";
import { useUi } from "../commands/ui";
import { getActiveEditor } from "../editor/activeEditor";
import { addSources, addToHeatmap, baseName, createTopic } from "./actions";
import { blockText } from "./model";
import { useComprehensionFile } from "./store";

// Pickers for the comprehension heatmap (T-261): add vault notes and folders to a topic,
// choose the topic for items picked in the file tree, and insert a topic's block in a note.

/** Every folder and note in the vault, folders first. */
function useVaultItems(): PickerItem[] {
  const tree = useAppStore((s) => s.tree);
  return useMemo(() => {
    const dirs: PickerItem[] = [];
    const notes: PickerItem[] = [];
    const walk = (e: VaultEntry | null) => {
      for (const c of e?.children ?? []) {
        if (c.kind === "dir") {
          dirs.push({ id: c.path, label: c.path, icon: Folder, section: "Folders" });
          walk(c);
        } else if (isNotePath(c.path))
          notes.push({ id: c.path, label: c.path, icon: FileText, section: "Notes" });
      }
    };
    walk(tree);
    return [...dirs, ...notes];
  }, [tree]);
}

/** Add a vault note or folder to a topic. */
export function AddSourcePicker({ topic }: { topic: string }) {
  const close = useUi((s) => s.close);
  const file = useComprehensionFile();
  const have = new Set(file.topics.find((t) => t.id === topic)?.sources ?? []);
  const items = useVaultItems().filter((i) => !have.has(i.id));
  return (
    <Picker
      title="Add to the topic"
      placeholder="Find a folder or note…"
      items={items}
      footer={["↑↓ choose", "Enter add", "Esc close"]}
      onClose={close}
      onPick={(item) => {
        close();
        void addSources(topic, [item.id]);
      }}
    />
  );
}

/** The topic for items picked in the file tree, or a new one. */
export function TopicPicker({ paths }: { paths: string[] }) {
  const close = useUi((s) => s.close);
  const file = useComprehensionFile();
  const items: PickerItem[] = [
    {
      id: "",
      label: `New topic “${baseName(paths[0] ?? "") || "New topic"}”`,
      icon: Plus,
    },
    ...file.topics.map((t) => ({ id: t.id, label: t.title, icon: Grid3x3 })),
  ];
  return (
    <Picker
      title={`Add ${paths.length === 1 ? `“${baseName(paths[0]!)}”` : `${paths.length} items`} to a heatmap topic`}
      placeholder="Choose a topic…"
      items={items}
      footer={["↑↓ choose", "Enter add", "Esc close"]}
      onClose={close}
      onPick={(item) => {
        close();
        void addToHeatmap(item.id || null, paths);
      }}
    />
  );
}

/** Insert a topic's heatmap block at the cursor of the open note. */
export function InsertHeatmapPicker() {
  const close = useUi((s) => s.close);
  const file = useComprehensionFile();
  const items: PickerItem[] = [
    { id: "", label: "New topic from this note's folder", icon: Plus },
    ...file.topics.map((t) => ({ id: t.id, label: t.title, icon: Grid3x3 })),
  ];
  const insert = async (id: string) => {
    const view = getActiveEditor()?.view;
    const path = useAppStore.getState().activePath;
    if (!view || !path) return;
    let topic = file.topics.find((t) => t.id === id);
    if (!topic) {
      const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
      const title = baseName(folder) || "Vault";
      const newId = await createTopic(title, [folder]);
      topic = { id: newId, title, sources: [folder], unit: "sections" };
    }
    const line = view.state.doc.lineAt(view.state.selection.main.head);
    const text = blockText(topic);
    const insertText = line.text.trim() ? `\n\n${text}\n` : `${text}\n`;
    const at = line.text.trim() ? line.to : line.from;
    view.dispatch({
      changes: { from: at, to: line.text.trim() ? at : line.to, insert: insertText },
      selection: { anchor: at + insertText.length },
      scrollIntoView: true,
    });
    view.focus();
  };
  return (
    <Picker
      title="Insert a comprehension heatmap"
      placeholder="Choose a topic…"
      items={items}
      footer={["↑↓ choose", "Enter insert", "Esc close"]}
      onClose={close}
      onPick={(item) => {
        close();
        void insert(item.id);
      }}
    />
  );
}
