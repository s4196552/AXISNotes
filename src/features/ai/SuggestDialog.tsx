import { useEffect, useRef, useState } from "react";
import { HardDrive, Square, Tags, X } from "lucide-react";
import { type AiPlan, type AiRunRequest, backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { editNote } from "../files/editNote";
import { renameEntry } from "../files/renameEntry";
import { AiRun, askValidated, errorMessage, isCancelled } from "./runAi";
import {
  addLinks,
  addTags,
  type LinkCandidate,
  linkCandidates,
  parseSuggestions,
  suggestRequest,
  type Suggestions,
} from "./suggest";
import "./ai.css";

// "Suggest tags, title and links" for a note: a cheap model proposes, the user ticks what
// to keep, and only that is applied (tags into the frontmatter, the title as a rename that
// updates links, links in place of plain mentions).

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/i, "");

type Phase =
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "running" }
  | { kind: "review"; s: Suggestions }
  | { kind: "error"; message: string };

export function SuggestDialog({ path, onClose }: { path: string; onClose(): void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [request, setRequest] = useState<AiRunRequest | null>(null);
  const ctx = useRef<{ noteText: string; candidates: LinkCandidate[] } | null>(null);
  const run = useRef<AiRun | null>(null);
  const [tags, setTags] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState(false);
  const [links, setLinks] = useState<Set<number>>(new Set());

  // Gather what the model needs: the vault's tags and the notes this one mentions.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [file, notes, tagCounts] = await Promise.all([
          backend.readFile(path),
          backend.listNotes(),
          backend.listTags(),
        ]);
        if (!live) return;
        const candidates = linkCandidates(path, file.content, notes);
        ctx.current = { noteText: file.content, candidates };
        const req = suggestRequest(
          path,
          [...tagCounts].sort((a, b) => b.count - a.count).map((t) => t.tag),
          candidates,
        );
        setRequest(req);
        setPhase({ kind: "ready" });
        backend.aiPlan(req).then(
          (p) => live && setPlan(p),
          (e: unknown) => live && setPhase({ kind: "error", message: errorMessage(e) }),
        );
      } catch (e) {
        if (live) setPhase({ kind: "error", message: errorMessage(e) });
      }
    })();
    return () => {
      live = false;
      run.current?.cancel();
    };
  }, [path]);

  async function suggest() {
    if (!request || !ctx.current) return;
    const r = new AiRun();
    run.current = r;
    setPhase({ kind: "running" });
    try {
      const { value } = await askValidated(
        request,
        (answer) =>
          parseSuggestions(answer, {
            noteText: ctx.current!.noteText,
            currentTitle: nameOf(path),
            candidates: ctx.current!.candidates,
          }),
        { run: r },
      );
      setTags(new Set(value.tags));
      setTitle(Boolean(value.title));
      setLinks(new Set(value.links.map((_, i) => i)));
      setPhase({ kind: "review", s: value });
    } catch (e) {
      if (isCancelled(e)) setPhase({ kind: "ready" });
      else setPhase({ kind: "error", message: errorMessage(e) });
    }
  }

  async function apply(s: Suggestions) {
    try {
      const pickedLinks = s.links.filter((_, i) => links.has(i));
      const pickedTags = s.tags.filter((t) => tags.has(t));
      if (pickedTags.length || pickedLinks.length)
        await editNote(path, (text) => addLinks(addTags(text, pickedTags), pickedLinks));
      let to = path;
      if (title && s.title) {
        const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
        const clean = s.title
          .replace(/[\\/:*?"<>|#^[\]]+/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        if (clean) {
          to = `${dir}${clean}.md`;
          await renameEntry(path, to);
        }
      }
      const done = pickedTags.length + pickedLinks.length + (to !== path ? 1 : 0);
      useAppStore
        .getState()
        .notify(done ? `Applied ${done} suggestion${done === 1 ? "" : "s"}.` : "Nothing applied.");
      onClose();
    } catch (e) {
      setPhase({ kind: "error", message: errorMessage(e) });
    }
  }

  const toggle = <T,>(set: Set<T>, v: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(v);
    else next.delete(v);
    return next;
  };

  const running = phase.kind === "running";
  return (
    <div className="modal-backdrop" onMouseDown={() => !running && onClose()}>
      <div
        className="modal ask-ai suggest"
        role="dialog"
        aria-label="Suggest tags, title and links"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !running && onClose()}
      >
        <header className="ask-ai-header">
          <Tags size={15} /> <strong>Suggest tags, title and links</strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose} disabled={running}>
            <X size={15} />
          </button>
        </header>
        <div className="ask-ai-body">
          <p className="muted">
            For “{nameOf(path)}”. Nothing changes until you tick suggestions and apply them.
          </p>
          <div className="ask-ai-plan" aria-label="Destination">
            {plan && (
              <>
                {plan.local && <HardDrive size={12} aria-label="On this device" />}
                <span>
                  → {plan.providerName} · {plan.model}
                </span>
              </>
            )}
          </div>
          {phase.kind === "running" && <p className="muted">Thinking…</p>}
          {phase.kind === "error" && (
            <p className="ai-error" role="alert">
              {phase.message}
            </p>
          )}
          {phase.kind === "review" && (
            <div className="suggest-list">
              {phase.s.tags.length + phase.s.links.length === 0 && !phase.s.title && (
                <p className="muted">No suggestions: this note looks well organised already.</p>
              )}
              {phase.s.tags.length > 0 && (
                <fieldset aria-label="Tags">
                  <legend>Tags</legend>
                  {phase.s.tags.map((t) => (
                    <label key={t}>
                      <input
                        type="checkbox"
                        checked={tags.has(t)}
                        onChange={(e) => setTags((s) => toggle(s, t, e.target.checked))}
                      />
                      #{t}
                    </label>
                  ))}
                </fieldset>
              )}
              {phase.s.title && (
                <fieldset aria-label="Title">
                  <legend>Title</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={title}
                      onChange={(e) => setTitle(e.target.checked)}
                    />
                    Rename to “{phase.s.title}” (links to it are updated)
                  </label>
                </fieldset>
              )}
              {phase.s.links.length > 0 && (
                <fieldset aria-label="Links">
                  <legend>Links</legend>
                  {phase.s.links.map((l, i) => (
                    <label key={i}>
                      <input
                        type="checkbox"
                        checked={links.has(i)}
                        onChange={(e) => setLinks((s) => toggle(s, i, e.target.checked))}
                      />
                      “{l.text}” → [[{l.target.replace(/\.md$/i, "")}]]
                    </label>
                  ))}
                </fieldset>
              )}
            </div>
          )}
        </div>
        <footer className="ask-ai-footer">
          <span className="ask-ai-spacer" />
          {running ? (
            <button onClick={() => run.current?.cancel()}>
              <Square size={12} /> Stop
            </button>
          ) : phase.kind === "review" ? (
            <button className="primary" onClick={() => void apply(phase.s)}>
              Apply selected
            </button>
          ) : (
            <button
              className="primary"
              disabled={phase.kind !== "ready" && phase.kind !== "error"}
              onClick={() => void suggest()}
            >
              Suggest
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
