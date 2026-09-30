import { useFeatureEnabled } from "../modules/features";
import { useEffect, useMemo, useRef, useState } from "react";
import { HardDrive, Network, Sparkles, Square, X } from "lucide-react";
import { type AiPlan, backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { isNotePath, noteName } from "../../lib/markdown";
import {
  type DiagramGraph,
  graphToMermaid,
  linksToGraph,
  outlineToGraph,
  parseGraph,
} from "../../lib/diagram";
import { AiRun, askValidated, errorMessage, isCancelled } from "../ai/runAi";
import {
  graphRequest,
  MERMAID_KINDS,
  type MermaidKind,
  mermaidRequest,
  parseMermaidAnswer,
} from "./diagramPrompt";
import { renderMermaid } from "./mermaid";
import "../ai/ai.css";
import "./diagrams.css";

// The smart diagram maker. "Describe" asks the diagrams model (Mermaid for notes, a JSON
// graph for canvases; either is validated and retried once). "From notes" builds a mind
// map from a note's outline or a flowchart of its links, without AI. The result is
// previewed, can be edited, and is inserted as a ```mermaid block or as canvas shapes.

export type DiagramResult = { mermaid: string } | { graph: DiagramGraph };

export interface DiagramMakerProps {
  target: "note" | "canvas";
  /** The note or canvas the diagram goes into. */
  path: string;
  /** Text selected in the note, used as the description. */
  selection?: string;
  onInsert(result: DiagramResult): void | Promise<void>;
  onClose(): void;
}

type Tab = "ai" | "structure";
type Phase =
  { kind: "idle" } | { kind: "running"; retrying: boolean } | { kind: "error"; message: string };

/** Renders Mermaid code (debounced), showing the parser's error if it doesn't render. */
function Preview({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      renderMermaid(code).then(
        (s) => live && (setSvg(s), setError(null)),
        (e: unknown) =>
          live && (setSvg(null), setError(e instanceof Error ? e.message : String(e))),
      );
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [code]);
  return (
    <div className="dg-preview" aria-label="Diagram preview" aria-busy={!svg && !error}>
      {error ? (
        <span className="ai-error" role="alert">
          {error.split("\n").slice(0, 4).join(" ")}
        </span>
      ) : svg ? (
        <div dangerouslySetInnerHTML={{ __html: svg }} />
      ) : (
        <span className="muted">Rendering…</span>
      )}
    </div>
  );
}

export function DiagramMaker({ target, path, selection, onInsert, onClose }: DiagramMakerProps) {
  const notes = useAppStore((s) => s.notes);
  const aiEnabled = useFeatureEnabled("aiAssist");
  const [tab, setTab] = useState<Tab>(aiEnabled ? "ai" : "structure");
  const selectedTab = !aiEnabled && tab === "ai" ? "structure" : tab;
  const [prompt, setPrompt] = useState(selection?.trim() ?? "");
  const [kind, setKind] = useState<MermaidKind>("auto");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  // The result: Mermaid code (editable) and, for canvases, the graph behind it.
  const [code, setCode] = useState("");
  const [graph, setGraph] = useState<DiagramGraph | null>(null);
  const [source, setSource] = useState<"outline" | "links">("outline");
  const [notePath, setNotePath] = useState(target === "note" ? path : "");
  const run = useRef<AiRun | null>(null);
  useEffect(() => () => run.current?.cancel(), []);

  const canvasKind: "auto" | "flowchart" | "mindmap" =
    kind === "flowchart" || kind === "mindmap" ? kind : "auto";
  const sources = useMemo(() => [path], [path]);
  const request = useMemo(
    () =>
      target === "note"
        ? mermaidRequest(prompt, kind, sources)
        : graphRequest(prompt, canvasKind, sources),
    [target, prompt, kind, canvasKind, sources],
  );

  useEffect(() => {
    if (selectedTab !== "ai") return;
    let live = true;
    const t = setTimeout(() => {
      backend.aiPlan(request).then(
        (p) => live && (setPlan(p), setPlanError(null)),
        (e: unknown) => live && (setPlan(null), setPlanError(errorMessage(e))),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [request, selectedTab]);

  async function generate() {
    if (!prompt.trim()) return;
    const r = new AiRun();
    run.current = r;
    setPhase({ kind: "running", retrying: false });
    const onRetry = () => setPhase({ kind: "running", retrying: true });
    try {
      if (target === "note") {
        const { value } = await askValidated(request, parseMermaidAnswer, { run: r, onRetry });
        setGraph(null);
        setCode(value);
      } else {
        const { value } = await askValidated(request, parseGraph, { run: r, onRetry });
        setGraph(value);
        setCode(graphToMermaid(value));
      }
      setPhase({ kind: "idle" });
    } catch (e) {
      setPhase(isCancelled(e) ? { kind: "idle" } : { kind: "error", message: errorMessage(e) });
    }
  }

  // "From notes": rebuild whenever the choice changes.
  useEffect(() => {
    if (selectedTab !== "structure" || !notePath) return;
    let live = true;
    const title = noteName(notePath);
    const build =
      source === "outline"
        ? backend.readFile(notePath).then((f) => outlineToGraph(f.content, title))
        : backend.graph().then((data) => linksToGraph(notePath, data));
    build.then(
      (g) => {
        if (!live) return;
        setGraph(g);
        setCode(graphToMermaid(g));
        setPhase({ kind: "idle" });
      },
      (e: unknown) => live && setPhase({ kind: "error", message: errorMessage(e) }),
    );
    return () => {
      live = false;
    };
  }, [selectedTab, source, notePath]);

  const switchTab = (t: Tab) => {
    setTab(t);
    setCode("");
    setGraph(null);
    setPhase({ kind: "idle" });
  };

  const running = phase.kind === "running";
  const noteChoices = useMemo(() => notes.filter((n) => isNotePath(n.path)), [notes]);
  const canInsert = target === "note" ? Boolean(code.trim()) : graph !== null;

  return (
    <div className="modal-backdrop" onMouseDown={() => !running && onClose()}>
      <div
        className="modal ask-ai dg-dialog"
        role="dialog"
        aria-label="Make a diagram"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !running && onClose()}
      >
        <header className="ask-ai-header">
          <Network size={15} /> <strong>Make a diagram</strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose} disabled={running}>
            <X size={15} />
          </button>
        </header>
        <div className="dg-tabs" role="tablist">
          {aiEnabled && (
            <button
              role="tab"
              aria-selected={selectedTab === "ai"}
              onClick={() => switchTab("ai")}
              disabled={running}
            >
              Describe it (AI)
            </button>
          )}
          <button
            role="tab"
            aria-selected={selectedTab === "structure"}
            onClick={() => switchTab("structure")}
            disabled={running}
          >
            From notes (no AI)
          </button>
        </div>

        <div className="ask-ai-body">
          {selectedTab === "ai" ? (
            <>
              <textarea
                className="ask-ai-input"
                aria-label="Describe the diagram"
                placeholder="e.g. flowchart of mitosis, or paste an outline…"
                rows={3}
                autoFocus
                value={prompt}
                disabled={running}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    void generate();
                  }
                }}
              />
              <div className="dg-row">
                <label>
                  Type{" "}
                  <select
                    aria-label="Diagram type"
                    value={target === "canvas" ? canvasKind : kind}
                    disabled={running}
                    onChange={(e) => setKind(e.target.value as MermaidKind)}
                  >
                    {Object.entries(MERMAID_KINDS)
                      .filter(
                        ([k]) => target === "note" || ["auto", "flowchart", "mindmap"].includes(k),
                      )
                      .map(([k, label]) => (
                        <option key={k} value={k}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
                <span className="muted">
                  {target === "note"
                    ? "Inserted as a Mermaid code block you can edit."
                    : "Added as shapes and arrows you can move and edit."}
                </span>
              </div>
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
            </>
          ) : (
            <div className="dg-row">
              <label>
                Make a{" "}
                <select
                  aria-label="Diagram source"
                  value={source}
                  onChange={(e) => setSource(e.target.value as "outline" | "links")}
                >
                  <option value="outline">mind map of the headings and lists</option>
                  <option value="links">flowchart of the linked notes</option>
                </select>
              </label>
              <label>
                in{" "}
                <select
                  aria-label="Note"
                  value={notePath}
                  onChange={(e) => setNotePath(e.target.value)}
                >
                  {!notePath && <option value="">Choose a note…</option>}
                  {noteChoices.map((n) => (
                    <option key={n.path} value={n.path}>
                      {n.title ?? n.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {phase.kind === "error" && (
            <p className="ai-error ask-ai-error" role="alert">
              {phase.message}
            </p>
          )}
          {running && (
            <p className="dg-status" role="status">
              {phase.retrying
                ? "The diagram wasn't valid; asking once more with the errors…"
                : "Drawing the diagram…"}
            </p>
          )}

          {code && !running && (
            <>
              <Preview code={code} />
              {target === "note" && (
                <textarea
                  className="dg-code"
                  aria-label="Mermaid code"
                  spellCheck={false}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </>
          )}
        </div>

        <footer className="ask-ai-footer">
          <span className="ask-ai-spacer" />
          {running ? (
            <button onClick={() => run.current?.cancel()}>
              <Square size={12} /> Stop
            </button>
          ) : (
            <>
              {selectedTab === "ai" && (
                <button
                  onClick={() => void generate()}
                  disabled={!prompt.trim()}
                  title="Ctrl+Enter"
                >
                  <Sparkles size={13} /> {code ? "Regenerate" : "Generate"}
                </button>
              )}
              <button
                className="primary"
                disabled={!canInsert}
                onClick={() =>
                  void Promise.resolve(
                    onInsert(target === "note" ? { mermaid: code.trim() } : { graph: graph! }),
                  ).then(onClose)
                }
              >
                {target === "note" ? "Insert into note" : "Add to canvas"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
