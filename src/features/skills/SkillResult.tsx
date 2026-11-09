import { useState } from "react";
import { Copy, ExternalLink, FilePlus2, FileText, FolderInput, Globe, Trash2 } from "lucide-react";
import { type AiRule, backend, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { copyPageText } from "./copyable";
import type { Skill, SkillFiles } from "./skills";
import {
  homeFolder,
  planFiles,
  saveConversation,
  savePageNextTo,
  type Turn,
  writeFiles,
} from "./skillRun";

// What a finished skill run shows, by kind. The result is already saved (next to the note,
// with the AI icon), so these offer opening it: a web page (in a tab or the browser), a
// Teach session's files, or a Grill me conversation (kept up to date after each reply).
// If saving failed, the button to save it is offered again.

const say = (m: string) => useAppStore.getState().notify(m);
const fail = (e: unknown) => say(isBackendError(e) || e instanceof Error ? e.message : String(e));
const nameOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);
const open = (p: string) => useAppStore.getState().openFile(p);

export function PageResult({
  skill,
  html,
  path,
  saved,
  onSaved,
  onDone,
}: {
  skill: Skill;
  html: string;
  path: string;
  /** Where the page was saved; empty if saving failed. */
  saved: string[];
  onSaved(saved: string[]): void;
  onDone(): void;
}) {
  const page = saved[0];
  return (
    <>
      <p className="ai-block-summary muted">
        {page
          ? `Made a web page and saved it as “${nameOf(page)}”.`
          : `Made a web page (${Math.max(1, Math.round(html.length / 1024))} KB), but it isn't saved yet.`}
      </p>
      <div className="ai-block-actions">
        {page ? (
          <>
            <button
              type="button"
              className="primary"
              onClick={() => {
                onDone();
                open(page);
              }}
            >
              <Globe size={12} /> Open page
            </button>
            <button type="button" onClick={() => void backend.openInBrowser(page).catch(fail)}>
              <ExternalLink size={12} /> Open in browser
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => void savePageNextTo(path, skill, html).then((p) => onSaved([p]), fail)}
          >
            <FilePlus2 size={12} /> Save next to the note
          </button>
        )}
        <button type="button" onClick={() => void copyPageText(html).then(say, fail)}>
          <Copy size={12} /> Copy text
        </button>
      </div>
    </>
  );
}

export function FilesResult({
  files,
  path,
  saved,
  onSaved,
  onDone,
}: {
  files: SkillFiles;
  path: string;
  /** Where the files were saved; empty if saving failed. */
  saved: string[];
  onSaved(saved: string[]): void;
  onDone(): void;
}) {
  const folder = homeFolder(path);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      const planned = planFiles(folder, files.files);
      await writeFiles(planned);
      onSaved(planned.map((f) => f.target));
    } catch (e) {
      fail(e);
    }
    setBusy(false);
  };
  const lesson =
    saved.find((p) => /\.md$/i.test(p) && !/(^|\/)progress\.md$/i.test(p)) ??
    saved.find((p) => /\.md$/i.test(p));
  const page = saved.find((p) => /\.html?$/i.test(p));
  return (
    <>
      {files.message && <p className="ai-block-summary">{files.message}</p>}
      {saved.length ? (
        <>
          <p className="ai-block-summary muted">
            Saved {saved.length} file{saved.length === 1 ? "" : "s"} to {folder || "the vault"}:
          </p>
          <ul className="ai-block-files" aria-label="Saved files">
            {saved.map((p) => (
              <li key={p}>{nameOf(p)}</li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="ai-block-files" aria-label="Files to save">
          {files.files.map((f) => (
            <li key={f.path}>{f.path}</li>
          ))}
        </ul>
      )}
      <div className="ai-block-actions">
        {saved.length ? (
          <>
            {lesson && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  onDone();
                  open(lesson);
                }}
              >
                <FileText size={12} /> Open the lesson
              </button>
            )}
            {page && (
              <button type="button" onClick={() => open(page)}>
                <Globe size={12} /> Try the practice page
              </button>
            )}
          </>
        ) : (
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            <FolderInput size={12} /> Save to {folder || "the vault"}
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
  format = "markdown",
  turns,
  path,
  rule = "any",
  saved,
  onSaved,
  onWrapUp,
  onDone,
  onDiscard,
}: {
  skill: Skill;
  /** The conversation is kept as a Markdown note or an HTML page. */
  format?: "markdown" | "html";
  turns: Turn[];
  path: string;
  /** The privacy rule of what the conversation read; the saved file is marked with it. */
  rule?: AiRule;
  /** Where the conversation is saved (updated after each reply); empty if it isn't. */
  saved: string[];
  onSaved(saved: string[]): void;
  onWrapUp(): void;
  onDone(): void;
  onDiscard(): void;
}) {
  const file = saved[0];
  return (
    <div className="ai-block-actions">
      <button type="button" onClick={onWrapUp}>
        Wrap up
      </button>
      {file ? (
        <button
          type="button"
          onClick={() => {
            onDone();
            open(file);
          }}
          title={`Saved as “${nameOf(file)}”`}
        >
          <FileText size={12} /> Open the saved conversation
        </button>
      ) : (
        <button
          type="button"
          onClick={() =>
            void saveConversation(path, skill, format === "html", turns, rule).then(onSaved, fail)
          }
        >
          <FilePlus2 size={12} /> Save the conversation
        </button>
      )}
      <button
        type="button"
        title={file ? "Close it and move the saved conversation to the trash" : undefined}
        onClick={() => {
          if (file)
            void backend.trashEntry(file).then(() => useAppStore.getState().refreshTree(), fail);
          onDiscard();
        }}
      >
        <Trash2 size={12} /> Discard
      </button>
    </div>
  );
}
