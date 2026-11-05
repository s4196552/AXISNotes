import { useState } from "react";
import { ExternalLink, FilePlus2, FileText, FolderInput, Trash2 } from "lucide-react";
import { backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { createDraft, folderOf } from "../drafts/drafts";
import type { Skill, SkillFiles } from "./skills";
import { planFiles, savePageNextTo, transcript, type Turn, writeFiles } from "./skillRun";

// What a finished skill run offers, by kind: a web page (open, keep as a draft, or save
// beside the note), a Teach session's files (save into the folder), or a Grill me
// conversation (keep it as a draft).

const say = (m: string) => useAppStore.getState().notify(m);
const fail = (e: unknown) => say(isBackendError(e) || e instanceof Error ? e.message : String(e));

export function PageResult({
  skill,
  html,
  path,
  onDone,
}: {
  skill: Skill;
  html: string;
  path: string;
  onDone(): void;
}) {
  const open = async () => {
    const draft = await createDraft({
      title: `${skill.title}`,
      content: html,
      ext: ".html",
      folder: folderOf(path),
      open: false,
    });
    await backend.openInBrowser(draft);
  };
  return (
    <>
      <p className="ai-block-summary muted">
        Made a web page ({Math.max(1, Math.round(html.length / 1024))} KB).
      </p>
      <div className="ai-block-actions">
        <button type="button" className="primary" onClick={() => void open().catch(fail)}>
          <ExternalLink size={12} /> Open in browser
        </button>
        <button
          type="button"
          onClick={() =>
            void savePageNextTo(path, skill, html).then((p) => {
              say(`Saved ${p}.`);
              onDone();
              void backend.openInBrowser(p).catch(fail);
            }, fail)
          }
        >
          <FilePlus2 size={12} /> Save next to the note
        </button>
        <button
          type="button"
          onClick={() =>
            void createDraft({
              title: skill.title,
              content: html,
              ext: ".html",
              folder: folderOf(path),
            }).then(onDone, fail)
          }
        >
          <FileText size={12} /> Open as draft
        </button>
      </div>
    </>
  );
}

export function FilesResult({
  files,
  path,
  onDone,
}: {
  files: SkillFiles;
  path: string;
  onDone(): void;
}) {
  const folder = folderOf(path);
  const planned = planFiles(folder, files.files);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await writeFiles(planned);
      const lesson =
        planned.find((f) => /\.md$/i.test(f.path) && !/^progress\.md$/i.test(f.path)) ??
        planned.find((f) => /\.md$/i.test(f.path));
      say(
        `Saved ${planned.length} file${planned.length === 1 ? "" : "s"} to ${folder || "the vault"}.`,
      );
      onDone();
      if (lesson) useAppStore.getState().openFile(lesson.target);
    } catch (e) {
      fail(e);
      setBusy(false);
    }
  };
  const page = planned.find((f) => /\.html?$/i.test(f.path));
  return (
    <>
      {files.message && <p className="ai-block-summary">{files.message}</p>}
      <ul className="ai-block-files" aria-label="Files to save">
        {planned.map((f) => (
          <li key={f.target}>
            {f.path}{" "}
            <span className="muted">{f.replaces ? "(replaces the current one)" : "(new)"}</span>
          </li>
        ))}
      </ul>
      <div className="ai-block-actions">
        <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
          <FolderInput size={12} /> Save to {folder || "the vault"}
        </button>
        {page && (
          <button
            type="button"
            onClick={() =>
              void createDraft({
                title: page.path.replace(/\.html?$/i, ""),
                content: page.content,
                ext: ".html",
                folder,
                open: false,
              })
                .then((d) => backend.openInBrowser(d))
                .catch(fail)
            }
          >
            <ExternalLink size={12} /> Try the practice page
          </button>
        )}
      </div>
    </>
  );
}

export function ChatTranscript({ turns, answer }: { turns: Turn[]; answer: string }) {
  return (
    <div className="ai-block-chat" aria-label="Conversation">
      {turns.map((t, i) => (
        <p key={i} className={`ai-turn ai-turn-${t.role}`}>
          <strong>{t.role === "user" ? "You" : "AI"}:</strong> {t.text}
        </p>
      ))}
      {answer && (
        <p className="ai-turn ai-turn-assistant">
          <strong>AI:</strong> {answer}
        </p>
      )}
    </div>
  );
}

export function ChatActions({
  skill,
  turns,
  path,
  onWrapUp,
  onDone,
  onDiscard,
}: {
  skill: Skill;
  turns: Turn[];
  path: string;
  onWrapUp(): void;
  onDone(): void;
  onDiscard(): void;
}) {
  return (
    <div className="ai-block-actions">
      <button type="button" onClick={onWrapUp}>
        Wrap up
      </button>
      <button
        type="button"
        onClick={() =>
          void createDraft({
            title: `${skill.title} - ${path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "")}`,
            content: transcript(skill, turns),
            folder: folderOf(path),
          }).then(onDone, fail)
        }
      >
        <FileText size={12} /> Open as draft
      </button>
      <button type="button" onClick={onDiscard}>
        <Trash2 size={12} /> Discard
      </button>
    </div>
  );
}
