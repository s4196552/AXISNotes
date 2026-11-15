import { type DragEvent, useEffect, useRef, useState } from "react";
import {
  ClipboardCopy,
  FileText,
  Folder,
  FolderUp,
  Grid3x3,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { PATH_MIME } from "../../lib/fileKinds";
import { useUi } from "../commands/ui";
import {
  addSources,
  baseName,
  createTopic,
  deleteTopic,
  updateTopic,
  uploadFolder,
  uploadToTopic,
} from "./actions";
import { HeatmapCard } from "./HeatmapCard";
import { blockText, type Topic } from "./model";
import { useComprehensionFile } from "./store";
import "./comprehension.css";

// The comprehension heatmap as a view (T-261): the user's topics, each a set of notes and
// folders, with the card. Notes come from the vault (a picker, dragging from the file
// tree, or the tree's "Add to comprehension heatmap"), or from disk (Upload, or dropping
// files and folders from Explorer here), copied into the topic's folder.

export function HeatmapView({ topic: wanted }: { topic: string | null }) {
  const file = useComprehensionFile();
  const topics = file.topics;
  const topic = topics.find((t) => t.id === wanted) ?? topics[0] ?? null;
  const show = (id: string) => useAppStore.getState().openHeatmap(id);
  const add = async () => show(await createTopic("New topic"));

  return (
    <div className="heatmap-view" data-own-file-drops>
      <header className="heatmap-view-head">
        <span className="heatmap-view-icon" aria-hidden>
          <Grid3x3 size={22} />
        </span>
        <div>
          <h2>Comprehension</h2>
          <p className="muted">
            How well you know each topic, from your practice tests, flash cards and lessons, or your
            own marks.
          </p>
        </div>
      </header>
      <nav className="heatmap-topics" aria-label="Topics">
        {topics.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-current={t.id === topic?.id || undefined}
            onClick={() => show(t.id)}
          >
            {t.title}
          </button>
        ))}
        <button type="button" className="heatmap-new" onClick={() => void add()}>
          <Plus size={14} aria-hidden /> New topic
        </button>
      </nav>
      {topic ? (
        <TopicPanel key={topic.id} topic={topic} />
      ) : (
        <div className="heatmap-start">
          <p>Make a topic for a subject, like a course, then add its notes or folders.</p>
          <button type="button" onClick={() => void add()}>
            <Plus size={14} aria-hidden /> New topic
          </button>
        </div>
      )}
    </div>
  );
}

function TopicPanel({ topic }: { topic: Topic }) {
  const [title, setTitle] = useState(topic.title);
  const [over, setOver] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  // A rename saved elsewhere (or undone) shows in the box.
  const [shownTitle, setShownTitle] = useState(topic.title);
  if (shownTitle !== topic.title) {
    setShownTitle(topic.title);
    setTitle(topic.title);
  }

  // Files and folders dropped here from Explorer are copied in (the editor leaves drops
  // over `[data-own-file-drops]` alone).
  useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void backend
      .onFilesDropped(({ x, y }) => {
        const r = zone.current?.closest(".heatmap-view")?.getBoundingClientRect();
        const cx = x / window.devicePixelRatio;
        const cy = y / window.devicePixelRatio;
        if (!r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom) return;
        void uploadToTopic(topic, "dropped");
      })
      .then((u) => (gone ? u() : (stop = u)));
    return () => {
      gone = true;
      stop?.();
    };
  }, [topic]);

  // Notes and folders dragged from the file tree.
  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(PATH_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "link";
    setOver(true);
  };
  const onDrop = (e: DragEvent) => {
    setOver(false);
    const path = e.dataTransfer.getData(PATH_MIME);
    if (!path) return;
    e.preventDefault();
    void addSources(topic.id, [path]);
  };

  const saveTitle = () => {
    const next = title.trim();
    if (next && next !== topic.title) void updateTopic(topic.id, (t) => ({ ...t, title: next }));
    else setTitle(topic.title);
  };
  const [confirming, setConfirming] = useState(false);
  const remove = async () => {
    await deleteTopic(topic.id);
    useAppStore.getState().openHeatmap(null);
  };
  const copyBlock = () =>
    void navigator.clipboard
      .writeText(blockText(topic))
      .then(() =>
        useAppStore.getState().notify("Copied. Paste it into a note to show this heatmap there."),
      );

  return (
    <div className="heatmap-topic">
      <div
        ref={zone}
        className="heatmap-sources"
        data-over={over || undefined}
        onDragOver={onDragOver}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
      >
        <label className="heatmap-title-field">
          <span>Topic</span>
          <input
            value={title}
            aria-label="Topic name"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
          />
        </label>
        <ul className="heatmap-source-list" aria-label="Notes and folders in this topic">
          {topic.sources.map((s) => (
            <li key={s} title={s}>
              {s.toLowerCase().endsWith(".md") ? (
                <FileText size={13} aria-hidden />
              ) : (
                <Folder size={13} aria-hidden />
              )}
              <span>{baseName(s) || "Vault"}</span>
              <button
                type="button"
                aria-label={`Remove ${baseName(s)} from the topic`}
                onClick={() =>
                  void updateTopic(topic.id, (t) => ({
                    ...t,
                    sources: t.sources.filter((x) => x !== s),
                  }))
                }
              >
                <X size={12} />
              </button>
            </li>
          ))}
          {!topic.sources.length && (
            <li className="muted heatmap-drop-hint">
              Drop notes or folders here, from the file tree or from your computer.
            </li>
          )}
        </ul>
        <div className="heatmap-source-actions">
          <button
            type="button"
            onClick={() => useUi.getState().open({ kind: "heatmap-add", topic: topic.id })}
          >
            <Plus size={14} aria-hidden /> Add from vault…
          </button>
          <button
            type="button"
            title={`Copies Markdown notes into ${uploadFolder(topic)}`}
            onClick={() => void uploadToTopic(topic, "files")}
          >
            <Upload size={14} aria-hidden /> Upload notes…
          </button>
          <button
            type="button"
            title={`Copies the folder's notes into ${uploadFolder(topic)}`}
            onClick={() => void uploadToTopic(topic, "folder")}
          >
            <FolderUp size={14} aria-hidden /> Upload folder…
          </button>
          <span className="heatmap-source-end">
            <button
              type="button"
              onClick={copyBlock}
              title="Copy a block that shows this heatmap in a note"
            >
              <ClipboardCopy size={14} aria-hidden /> Copy as block
            </button>
            {confirming ? (
              <span className="heatmap-confirm" role="group" aria-label="Delete topic?">
                Delete topic? Notes and levels stay.
                <button type="button" className="danger" onClick={() => void remove()}>
                  Delete
                </button>
                <button type="button" onClick={() => setConfirming(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button
                type="button"
                aria-label="Delete topic"
                title="Delete topic"
                onClick={() => setConfirming(true)}
              >
                <Trash2 size={14} />
              </button>
            )}
          </span>
        </div>
      </div>
      <HeatmapCard
        topic={topic}
        onUnitChange={(unit) => void updateTopic(topic.id, (t) => ({ ...t, unit }))}
      />
    </div>
  );
}
