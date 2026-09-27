import { useState } from "react";
import { FolderInput, Loader, X } from "lucide-react";
import { backend, type ImportPreview, type ImportReport, isBackendError } from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import "./import.css";

// Import an Obsidian vault (or any folder of Markdown) into the open vault. Notes are
// copied as they are: AXISNotes reads Obsidian's Markdown natively. Nothing is overwritten.

type Step =
  | { kind: "pick" }
  | { kind: "ready"; source: string; preview: ImportPreview }
  | { kind: "importing" }
  | { kind: "done"; report: ImportReport }
  | { kind: "error"; message: string };

const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function ImportDialog({ onClose }: { onClose(): void }) {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [target, setTarget] = useState("");
  const [useTemplates, setUseTemplates] = useState(true);
  const [useDaily, setUseDaily] = useState(true);

  async function pick() {
    const source = await backend.pickFolder();
    if (!source) return;
    try {
      const preview = await backend.inspectImport(source);
      setTarget(preview.name);
      setStep({ kind: "ready", source, preview });
    } catch (e) {
      setStep({ kind: "error", message: message(e) });
    }
  }

  async function run(source: string) {
    setStep({ kind: "importing" });
    try {
      const report = await backend.importObsidian(source, target);
      await useAppStore.getState().refreshTree();
      setStep({ kind: "done", report });
    } catch (e) {
      setStep({ kind: "error", message: message(e) });
    }
  }

  function finish(report: ImportReport) {
    const s = report.settings;
    const apply = (useTemplates && s.templatesFolder) || (useDaily && s.dailyFolder);
    if (apply) {
      void useConfig.getState().update((c) => ({
        ...c,
        templatesFolder: useTemplates && s.templatesFolder ? s.templatesFolder : c.templatesFolder,
        dailyNotes:
          useDaily && s.dailyFolder
            ? {
                ...c.dailyNotes,
                folder: s.dailyFolder,
                format: s.dailyFormat ?? c.dailyNotes.format,
                template: s.dailyTemplate ?? c.dailyNotes.template,
              }
            : c.dailyNotes,
      }));
    }
    onClose();
  }

  const busy = step.kind === "importing";
  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div
        className="modal ask-ai import-dialog"
        role="dialog"
        aria-label="Import from Obsidian"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <header className="ask-ai-header">
          <FolderInput size={15} /> <strong>Import from Obsidian</strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={15} />
          </button>
        </header>
        <div className="ask-ai-body">
          {(step.kind === "pick" || step.kind === "error") && (
            <>
              <p>
                Copies an Obsidian vault into this vault: notes, attachments and canvases. Links,
                embeds, tags, block references and frontmatter work as they are. Your Obsidian vault
                isn’t changed, and nothing here is overwritten.
              </p>
              <p className="muted">
                Tip: you can also open an Obsidian vault directly as an AXISNotes vault.
              </p>
              {step.kind === "error" && (
                <p className="ai-error" role="alert">
                  {step.message}
                </p>
              )}
            </>
          )}

          {step.kind === "ready" && (
            <>
              <p>
                <strong>{step.preview.name}</strong>
                {step.preview.obsidian ? (
                  <span className="muted"> · Obsidian vault</span>
                ) : (
                  <span className="ai-error">
                    {" "}
                    · no .obsidian folder here; its files will still be copied
                  </span>
                )}
              </p>
              <label className="import-row">
                Into folder
                <input
                  aria-label="Import into folder"
                  value={target}
                  placeholder="(vault root)"
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
            </>
          )}

          {busy && (
            <p className="dg-status" role="status">
              <Loader size={14} className="spin" /> Copying files…
            </p>
          )}

          {step.kind === "done" && (
            <div role="status" aria-label="Import result">
              <p>
                Imported {plural(step.report.notes, "note")},{" "}
                {plural(step.report.attachments, "attachment")} and{" "}
                {plural(step.report.canvases, "canvas", "canvases")}
                {step.report.target ? ` into “${step.report.target}”` : ""}.
              </p>
              {step.report.skipped.length > 0 && (
                <details>
                  <summary>{plural(step.report.skipped.length, "file")} skipped</summary>
                  <ul className="import-skipped">
                    {step.report.skipped.map((s) => (
                      <li key={s.path}>
                        <code>{s.path}</code> <span className="muted">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {step.report.settings.templatesFolder && (
                <label className="import-row">
                  <input
                    type="checkbox"
                    checked={useTemplates}
                    onChange={(e) => setUseTemplates(e.target.checked)}
                  />
                  Use “{step.report.settings.templatesFolder}” as the templates folder
                </label>
              )}
              {step.report.settings.dailyFolder && (
                <label className="import-row">
                  <input
                    type="checkbox"
                    checked={useDaily}
                    onChange={(e) => setUseDaily(e.target.checked)}
                  />
                  Put daily notes in “{step.report.settings.dailyFolder}”
                  {step.report.settings.dailyFormat && ` (${step.report.settings.dailyFormat})`}
                </label>
              )}
            </div>
          )}
        </div>
        <footer className="ask-ai-footer">
          <span className="ask-ai-spacer" />
          {step.kind === "ready" ? (
            <>
              <button onClick={() => void pick()}>Choose another folder</button>
              <button className="primary" onClick={() => void run(step.source)}>
                Import
              </button>
            </>
          ) : step.kind === "done" ? (
            <button className="primary" onClick={() => finish(step.report)}>
              Done
            </button>
          ) : (
            <button className="primary" onClick={() => void pick()} disabled={busy}>
              Choose a folder…
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
