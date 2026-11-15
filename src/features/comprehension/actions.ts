import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { newTopicId, type Topic, withSources } from "./model";
import { useComprehension } from "./store";

// What the heatmap's commands, view and file-tree menu do to topics (T-261).

const notify = (m: string) => useAppStore.getState().notify(m);
const errorText = (e: unknown) =>
  isBackendError(e) ? e.message : e instanceof Error ? e.message : String(e);

/** The last part of a path, without `.md`. */
export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.md$/i, "");

/** Make a topic and return its id. */
export async function createTopic(title: string, sources: string[] = []): Promise<string> {
  const id = newTopicId();
  const topic = withSources(
    { id, title: title.trim() || "New topic", sources: [], unit: "sections" },
    sources,
  );
  await useComprehension.getState().change((f) => ({ ...f, topics: [...f.topics, topic] }));
  return id;
}

export async function updateTopic(id: string, fn: (t: Topic) => Topic) {
  await useComprehension
    .getState()
    .change((f) => ({ ...f, topics: f.topics.map((t) => (t.id === id ? fn(t) : t)) }));
}

/** Remove a topic. Its levels stay (they belong to the notes, not the topic). */
export async function deleteTopic(id: string) {
  await useComprehension
    .getState()
    .change((f) => ({ ...f, topics: f.topics.filter((t) => t.id !== id) }));
}

export async function addSources(id: string, paths: string[]) {
  await updateTopic(id, (t) => withSources(t, paths));
}

/**
 * Add vault items to a topic, or with `topic` null to a new topic named after the first
 * item, and show it.
 */
export async function addToHeatmap(topic: string | null, paths: string[]) {
  try {
    const id = topic ?? (await createTopic(baseName(paths[0] ?? "") || "New topic", paths));
    if (topic) await addSources(id, paths);
    useAppStore.getState().openHeatmap(id);
    notify(
      `Added ${paths.length === 1 ? `“${baseName(paths[0]!)}”` : `${paths.length} items`} to the heatmap.`,
    );
  } catch (e) {
    notify(`Couldn't add to the heatmap: ${errorText(e)}`);
  }
}

const safeName = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "") || "Topic";

/** Where notes from outside the vault go: the topic's folder, else Study/<title>. */
export function uploadFolder(t: Topic): string {
  const folder = t.sources.find((s) => !s.toLowerCase().endsWith(".md"));
  return folder ?? `Study/${safeName(t.title)}`;
}

/** Copy notes from disk (picked or dropped) into the topic's folder and add them. */
export async function uploadToTopic(t: Topic, from: "files" | "folder" | "dropped") {
  const root = useAppStore.getState().vault?.root;
  try {
    const out = await backend.importStudyNotes(uploadFolder(t), from, root);
    if (out.paths.length) {
      await addSources(t.id, out.paths);
      await useAppStore.getState().refreshTree();
    }
    const failed = out.failed.length
      ? ` ${out.failed.length} not added: ${out.failed
          .slice(0, 3)
          .map((f) => f.name)
          .join(", ")}${out.failed.length > 3 ? "…" : ""} (only Markdown notes can be).`
      : "";
    if (out.paths.length || failed)
      notify(
        `${out.paths.length ? `Added ${out.paths.length} to “${t.title}”.` : "Nothing added."}${failed}`,
      );
  } catch (e) {
    notify(`Couldn't add the notes: ${errorText(e)}`);
  }
}
