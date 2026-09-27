import { useEffect, useState } from "react";
import { Check, Circle, Rocket, X } from "lucide-react";
import { backend } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useUi } from "../commands/ui";
import "./gettingStarted.css";

// A short checklist shown once for a new vault (and from the palette): the essentials,
// plus the optional extras with their current state.

const KEYS: [string, string][] = [
  ["Ctrl+N", "New note"],
  ["Ctrl+O", "Find a note"],
  ["Ctrl+P", "All commands"],
  ["/", "Insert anything (in a note)"],
  ["[[", "Link to a note"],
  ["Ctrl+J", "Ask AI"],
];

export function GettingStarted({ onClose }: { onClose(): void }) {
  const notes = useAppStore((s) => s.notes);
  const open = useUi((s) => s.open);
  const [ai, setAi] = useState(false);
  const [clipper, setClipper] = useState(false);

  useEffect(() => {
    backend.aiSettings().then(
      (v) => setAi(v.providers.length > 0),
      () => {},
    );
    backend.clipperStatus().then(
      (s) => setClipper(s.devices.length > 0),
      () => {},
    );
  }, []);

  const start = notes.find((n) => n.name === "Start here");
  const steps: { label: string; hint: string; done: boolean; action: string; run(): void }[] = [
    {
      label: "Read the guide",
      hint: "A one-page tour of AXISNotes.",
      done: false,
      action: start ? "Open" : "",
      run: () => {
        if (start) useAppStore.getState().openFile(start.path);
        onClose();
      },
    },
    {
      label: "Set up AI (optional)",
      hint: "Your own OpenAI, Claude or Gemini key, or a local model with Ollama.",
      done: ai,
      action: ai ? "Change" : "Set up",
      run: () => open({ kind: "settings", section: "ai" }),
    },
    {
      label: "Clip from your browser (optional)",
      hint: "Save pages and screenshots into this vault.",
      done: clipper,
      action: clipper ? "Manage" : "Pair",
      run: () => open({ kind: "settings", section: "clipper" }),
    },
    {
      label: "Bring notes from Obsidian (optional)",
      hint: "Copies a vault in; links and embeds keep working.",
      done: false,
      action: "Import",
      run: () => open({ kind: "import" }),
    },
    {
      label: "Make it yours",
      hint: "Theme, fonts, folder icons, keyboard shortcuts.",
      done: false,
      action: "Settings",
      run: () => open({ kind: "settings", section: "appearance" }),
    },
  ];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal getting-started"
        role="dialog"
        aria-label="Getting started"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="ask-ai-header">
          <Rocket size={16} /> <strong>Getting started</strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose}>
            <X size={15} />
          </button>
        </header>
        <div className="gs-body">
          <ol className="gs-steps">
            {steps
              .filter((s) => s.action)
              .map((s) => (
                <li key={s.label} className={s.done ? "done" : ""}>
                  {s.done ? (
                    <Check size={16} aria-label="Done" />
                  ) : (
                    <Circle size={16} aria-hidden />
                  )}
                  <div>
                    <strong>{s.label}</strong>
                    <span className="muted">{s.hint}</span>
                  </div>
                  {s.action && <button onClick={s.run}>{s.action}</button>}
                </li>
              ))}
          </ol>
          <h3>Keys worth knowing</h3>
          <dl className="gs-keys">
            {KEYS.map(([k, what]) => (
              <div key={k}>
                <dt>
                  <kbd>{k}</kbd>
                </dt>
                <dd>{what}</dd>
              </div>
            ))}
          </dl>
        </div>
        <footer className="ask-ai-footer">
          <span className="muted">Open this again from Ctrl+P → “Getting started”.</span>
          <span className="ask-ai-spacer" />
          <button className="primary" onClick={onClose}>
            Start writing
          </button>
        </footer>
      </div>
    </div>
  );
}
