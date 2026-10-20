import { useState } from "react";
import { FolderInput, Loader, X } from "lucide-react";
import {
  backend,
  type ImportPreview,
  type ImportProgress,
  type ImportReport,
  isBackendError,
} from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { formatDate } from "../../lib/dates";
import {
  articleFor,
  countsText,
  plural,
  type Pick,
  type Source,
  SOURCES,
  sourceOf,
} from "./sources";
import "./import.css";

// Import notes from another app into a new folder of the open vault (T-103). The Rust side
// does the work (src-tauri/src/import): Notion's IDs dropped and links rewritten, databases
// made grids, Evernote notes converted. Nothing in the vault is overwritten.

const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));

type Step =
  | { kind: "choose"; error?: string }
  | { kind: "ready"; source: Source; path: string; preview: ImportPreview }
  | { kind: "importing"; progress: ImportProgress | null }
  | { kind: "done"; report: ImportReport };

const defaultTarget = (source: Source) =>
  `Imported/${source.kind === "markdown" ? "Markdown" : source.name} ${formatDate(new Date(), "YYYY-MM-DD")}`;

export function ImportDialog({ onClose }: { onClose(): void }) {
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [target, setTarget] = useState("");
  const [tablesAsMarkdown, setTablesAsMarkdown] = useState(false);
  const [useTemplates, setUseTemplates] = useState(true);
  const [useDaily, setUseDaily] = useState(true);

  async function inspect(source: Source, path: string) {
    try {
      const preview = await backend.inspectImport(source.kind, path);
      setTarget(defaultTarget(source));
      setStep({ kind: "ready", source, path, preview });
    } catch (e) {
      setStep({ kind: "choose", error: message(e) });
    }
  }

  async function pick(source: Source, how: Pick) {
    const path = how.folder
      ? await backend.pickFolder()
      : await backend.pickImportFile(`${source.name} export`, how.ext);
    if (path) await inspect(source, path);
  }

  async function run(source: Source, path: string) {
    setStep({ kind: "importing", progress: null });
    try {
      const report = await backend.importNotes(
        source.kind,
        path,
        target,
        { tablesAsMarkdown: source.kind === "notion" && tablesAsMarkdown },
        (progress) => setStep({ kind: "importing", progress }),
      );
      await useAppStore.getState().refreshTree();
      setStep({ kind: "done", report });
    } catch (e) {
      setStep({ kind: "choose", error: message(e) });
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
        aria-label="Import notes"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
      >
        <header className="ask-ai-header">
          <FolderInput size={15} />{" "}
          <strong>
            {step.kind === "ready" ? `Import from ${step.source.name}` : "Import notes"}
          </strong>
          <button className="ai-icon" aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={15} />
          </button>
        </header>
        <div className="ask-ai-body">
          {step.kind === "choose" && (
            <>
              <p className="muted">
                Bring notes from another app into a new folder in this vault. The export isn’t
                changed, and nothing in your vault is overwritten.
              </p>
              {step.error && (
                <p className="ai-error" role="alert">
                  {step.error}
                </p>
              )}
              <ul className="import-sources" aria-label="Import from">
                {SOURCES.map((s) => (
                  <li key={s.kind} className="import-source">
                    <s.icon size={20} className="import-source-icon" aria-hidden />
                    <div className="import-source-text">
                      <strong>{s.name}</strong>
                      <span className="muted">{s.how}</span>
                    </div>
                    <div className="import-source-actions">
                      {s.picks.map((p, i) => (
                        <button
                          key={p.label}
                          className={i === 0 ? "primary" : undefined}
                          aria-label={`${s.name}: ${p.label}`}
                          onClick={() => void pick(s, p)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {step.kind === "ready" && (
            <>
              <p>
                <strong>{step.preview.name}</strong>
                <span className="muted"> · {countsText(step.preview)}</span>
              </p>
              {step.preview.looksLike && (
                <p className="import-hint" role="note">
                  This looks like {articleFor(step.preview.looksLike)}{" "}
                  {sourceOf(step.preview.looksLike).name} export.{" "}
                  <button
                    className="link-button"
                    onClick={() => void inspect(sourceOf(step.preview.looksLike!), step.path)}
                  >
                    Import it as {sourceOf(step.preview.looksLike).name} instead
                  </button>
                </p>
              )}
              {step.preview.warnings.length > 0 && (
                <ul className="import-warnings" aria-label="Warnings">
                  {step.preview.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              <label className="import-row">
                Into new folder
                <input
                  aria-label="Import into folder"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                />
              </label>
              {step.source.kind === "notion" && step.preview.tables > 0 && (
                <label className="import-row">
                  Databases as
                  <select
                    aria-label="Databases as"
                    value={tablesAsMarkdown ? "markdown" : "grid"}
                    onChange={(e) => setTablesAsMarkdown(e.target.value === "markdown")}
                  >
                    <option value="grid">Grids (spreadsheets)</option>
                    <option value="markdown">Markdown tables linking to their pages</option>
                  </select>
                </label>
              )}
              <p className="muted">If that folder exists, a new one is made beside it (“… 2”).</p>
            </>
          )}

          {step.kind === "importing" && (
            <div className="import-progress" role="status" aria-label="Import progress">
              <p className="dg-status">
                <Loader size={14} className="spin" />{" "}
                {!step.progress
                  ? "Reading the export…"
                  : step.progress.done < step.progress.total
                    ? `Importing ${step.progress.done.toLocaleString()} of ${plural(step.progress.total, "file")}…`
                    : "Updating search and links…"}
              </p>
              <progress
                max={step.progress?.total || 1}
                value={step.progress ? step.progress.done : undefined}
              />
            </div>
          )}

          {step.kind === "done" && (
            <div role="status" aria-label="Import result">
              <p>
                Imported {countsText(step.report)} into “{step.report.target}”.
                {step.report.links > 0 && ` ${plural(step.report.links, "link")} updated.`}
              </p>
              {step.report.warnings.length > 0 && (
                <ul className="import-warnings" aria-label="Warnings">
                  {step.report.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
              {step.report.skipped.length > 0 && (
                <details>
                  <summary>{plural(step.report.skipped.length, "file")} skipped</summary>
                  <ul className="import-skipped">
                    {step.report.skipped.map((s, i) => (
                      <li key={`${s.path}-${i}`}>
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
              <button onClick={() => setStep({ kind: "choose" })}>Back</button>
              <button
                className="primary"
                disabled={!target.trim()}
                onClick={() => void run(step.source, step.path)}
              >
                Import
              </button>
            </>
          ) : step.kind === "done" ? (
            <button className="primary" onClick={() => finish(step.report)}>
              Done
            </button>
          ) : (
            <button onClick={onClose} disabled={busy}>
              Cancel
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
