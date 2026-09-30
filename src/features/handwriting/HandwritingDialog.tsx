import { useEffect, useMemo, useRef, useState } from "react";
import { Eraser, HardDrive, Loader, PenLine, Square, Undo2, X } from "lucide-react";
import { type AiPlan, type AiRunResult, backend } from "../../ipc";
import { AiRun, errorMessage, isCancelled } from "../ai/runAi";
import { getSpeller, retainSpeller } from "../spellcheck/engine";
import { HandwritingPad } from "./HandwritingPad";
import { type Stroke, strokesToImage } from "./pad";
import {
  flagWords,
  handwritingRequest,
  type Image,
  joinPieces,
  type Piece,
  recognize,
} from "./recognize";
import "./handwriting.css";

// Handwriting to text. Either the user writes on the pad here (notes), or the canvas
// passes an image of the selected strokes. The vision model's transcription is shown with
// uncertain words underlined; each one offers quick fixes (alternatives, keep, or type a
// correction) before the text is inserted.

export interface HandwritingDialogProps {
  /** Image to read (from the canvas); without it, the dialog shows a writing pad. */
  image?: Image;
  /** Files whose content is in the image (for the folder AI rules). */
  sources: string[];
  /** e.g. "Insert into note" / "Add to canvas". */
  insertLabel: string;
  /** Offer "remove the handwriting" (canvas). */
  offerReplace?: boolean;
  onInsert(text: string, opts: { replace: boolean }): void | Promise<void>;
  onClose(): void;
}

type Phase =
  | { kind: "write" }
  | { kind: "reading"; retrying: boolean }
  | { kind: "review"; pieces: Piece[]; result: AiRunResult }
  | { kind: "error"; message: string };

const REASON: Record<Extract<Piece, { kind: "flag" }>["reason"], string> = {
  unclear: "Hard to read",
  misspelled: "Misspelled",
  spelling: "Not in the dictionary",
};

/** An uncertain word with its quick-fix menu. */
function FlagWord({
  piece,
  value,
  onChoose,
}: {
  piece: Extract<Piece, { kind: "flag" }>;
  value: string | undefined;
  onChoose(v: string): void;
}) {
  // Fixed position (from the word's box) so the menu isn't clipped by the scrolling body.
  const [open, setOpen] = useState<{ left: number; top: number } | null>(null);
  const [custom, setCustom] = useState("");
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("button, input")?.focus();
    const outside = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setOpen(null);
    };
    document.addEventListener("mousedown", outside, true);
    return () => document.removeEventListener("mousedown", outside, true);
  }, [open]);
  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    setOpen((o) =>
      o || !r
        ? null
        : { left: Math.max(8, Math.min(r.left, window.innerWidth - 230)), top: r.bottom + 4 },
    );
  };
  const choose = (v: string) => {
    onChoose(v);
    setOpen(null);
  };
  return (
    <span className="hw-flag-wrap">
      <button
        ref={button}
        type="button"
        className={`hw-flag hw-${piece.reason}${value !== undefined ? " resolved" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-label={`${value ?? piece.word} (${value !== undefined ? "checked" : REASON[piece.reason]})`}
        onClick={toggle}
      >
        {value ?? piece.word}
      </button>
      {open && (
        <div
          ref={menu}
          className="hw-menu"
          style={open}
          role="menu"
          aria-label={`Fix “${piece.word}”`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(null);
              button.current?.focus();
            }
          }}
        >
          <div className="hw-menu-note">{REASON[piece.reason]}</div>
          {piece.alternatives.map((a) => (
            <button key={a} role="menuitem" className="hw-alt" onClick={() => choose(a)}>
              {a}
            </button>
          ))}
          <button role="menuitem" onClick={() => choose(piece.word)}>
            Keep “{piece.word}”
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) choose(custom.trim());
            }}
          >
            <input
              aria-label="Type a correction"
              placeholder="Type a correction…"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
            />
          </form>
        </div>
      )}
    </span>
  );
}

export function HandwritingDialog({
  image,
  sources,
  insertLabel,
  offerReplace,
  onInsert,
  onClose,
}: HandwritingDialogProps) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [phase, setPhase] = useState<Phase>(
    image ? { kind: "reading", retrying: false } : { kind: "write" },
  );
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Map<number, string>>(new Map());
  const [replace, setReplace] = useState(false);
  const run = useRef<AiRun | null>(null);
  useEffect(() => {
    const release = retainSpeller();
    return () => {
      run.current?.cancel();
      release();
    };
  }, []);

  // Where the image will go (a placeholder image is enough to resolve the provider).
  const planRequest = useMemo(
    () => handwritingRequest(image ?? { mime: "image/png", data: "" }, sources),
    [image, sources],
  );
  useEffect(() => {
    let live = true;
    backend.aiPlan(planRequest).then(
      (p) => live && (setPlan(p), setPlanError(null)),
      (e: unknown) => live && (setPlan(null), setPlanError(errorMessage(e))),
    );
    return () => {
      live = false;
    };
  }, [planRequest]);

  async function read(img: Image) {
    const r = new AiRun();
    run.current = r;
    setChosen(new Map());
    setPhase({ kind: "reading", retrying: false });
    try {
      const { recognition, result } = await recognize(img, {
        sources,
        run: r,
        onRetry: () => setPhase({ kind: "reading", retrying: true }),
      });
      if (r.cancelled) return;
      const pieces = await flagWords(recognition, getSpeller());
      if (r.cancelled) return;
      setPhase({ kind: "review", pieces, result });
    } catch (e) {
      setPhase(
        isCancelled(e)
          ? image
            ? { kind: "error", message: "Stopped." }
            : { kind: "write" }
          : { kind: "error", message: errorMessage(e) },
      );
    }
  }

  // Canvas images are read right away.
  const started = useRef(false);
  useEffect(() => {
    if (image && !started.current) {
      started.current = true;
      void read(image);
    }
    // `read` is stable enough: it only closes over props that don't change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image]);

  const convert = () => {
    const img = strokesToImage(strokes);
    if (!img) {
      setPhase({ kind: "error", message: "Write something on the pad first." });
      return;
    }
    void read(img);
  };

  const pieces = phase.kind === "review" ? phase.pieces : [];
  const flags = pieces.filter((p) => p.kind === "flag");
  const open = flags.filter((f) => !chosen.has(f.id)).length;
  const finalText = joinPieces(pieces, chosen);
  const reading = phase.kind === "reading";

  return (
    <div className="modal-backdrop" onMouseDown={() => !reading && onClose()}>
      <div
        className="modal ask-ai hw-dialog"
        role="dialog"
        aria-label="Handwriting to text"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !reading && onClose()}
      >
        <header className="ask-ai-header">
          <PenLine size={15} /> <strong>Handwriting to text</strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose} disabled={reading}>
            <X size={15} />
          </button>
        </header>

        <div className="ask-ai-body">
          <div className="ask-ai-plan" aria-live="polite" aria-label="Destination">
            {plan && (
              <>
                {plan.local && <HardDrive size={12} aria-label="On this device" />}
                <span>
                  → {plan.providerName} · {plan.model}
                </span>
              </>
            )}
            {!plan && planError && <span className="ai-error">{planError}</span>}
          </div>

          {!image && (phase.kind === "write" || phase.kind === "error") && (
            <>
              <HandwritingPad strokes={strokes} onChange={setStrokes} />
              <div className="hw-tools">
                <button
                  onClick={() => setStrokes((s) => s.slice(0, -1))}
                  disabled={!strokes.length}
                >
                  <Undo2 size={13} /> Undo
                </button>
                <button onClick={() => setStrokes([])} disabled={!strokes.length}>
                  <Eraser size={13} /> Clear
                </button>
                <span className="muted">Write with a pen, finger or mouse.</span>
              </div>
            </>
          )}

          {phase.kind === "error" && (
            <p className="ai-error ask-ai-error" role="alert">
              {phase.message}
            </p>
          )}

          {reading && (
            <p className="hw-reading" role="status">
              <Loader size={14} className="spin" />
              {phase.retrying
                ? "The answer wasn't in the expected format; asking once more…"
                : "Reading the handwriting…"}
            </p>
          )}

          {phase.kind === "review" && (
            <>
              <p className="hw-summary" role="status">
                {flags.length === 0
                  ? "No uncertain words."
                  : open === 0
                    ? "All uncertain words checked."
                    : `${open} uncertain word${open === 1 ? "" : "s"} underlined · click one for quick fixes`}
              </p>
              <div className="ask-ai-answer hw-text" aria-label="Transcription">
                {pieces.map((p, i) =>
                  p.kind === "text" ? (
                    <span key={i}>{p.text}</span>
                  ) : (
                    <FlagWord
                      key={i}
                      piece={p}
                      value={chosen.get(p.id)}
                      onChoose={(v) => setChosen((m) => new Map(m).set(p.id, v))}
                    />
                  ),
                )}
                {pieces.length === 0 && <span className="muted">No text found.</span>}
              </div>
              <div className="ask-ai-meta muted">
                Read by {phase.result.providerName} · {phase.result.model}
                {phase.result.local && " (on this device)"}
              </div>
              {offerReplace && (
                <label className="hw-replace">
                  <input
                    type="checkbox"
                    checked={replace}
                    onChange={(e) => setReplace(e.target.checked)}
                  />
                  Remove the handwriting after adding the text
                </label>
              )}
            </>
          )}
        </div>

        <footer className="ask-ai-footer">
          <span className="ask-ai-spacer" />
          {reading ? (
            <button onClick={() => run.current?.cancel()}>
              <Square size={12} /> Stop
            </button>
          ) : phase.kind === "review" ? (
            <>
              {!image && (
                <button onClick={() => setPhase({ kind: "write" })}>Back to the pad</button>
              )}
              <button
                className="primary"
                disabled={!finalText.trim()}
                onClick={() => void Promise.resolve(onInsert(finalText, { replace })).then(onClose)}
              >
                {insertLabel}
              </button>
            </>
          ) : image ? (
            <button className="primary" onClick={() => void read(image)}>
              Try again
            </button>
          ) : (
            <button className="primary" onClick={convert} disabled={!strokes.length}>
              <PenLine size={13} /> Convert to text
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
