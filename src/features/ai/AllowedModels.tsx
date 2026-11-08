import { useEffect, useState } from "react";
import { HardDrive, X } from "lucide-react";
import { type AiModel, type AiProviderStatus, backend } from "../../ipc";
import { useConfig } from "../../app/config";
import { modelsOf } from "./aiBlockStore";
import { changeSetting } from "../filetree/undo";
import "./ai.css";

// "Allowed models…" on a folder or note in the file tree: the only models its notes may
// be sent to (`ai.models` in the vault config, enforced by the Rust AI layer before any
// provider is contacted). Entries are "<provider id>/<model>" or "<provider id>/*".

const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1) || "Vault";

export function AllowedModels({ path, onClose }: { path: string; onClose(): void }) {
  const saved = useConfig((s) => s.config.ai.models[path]);
  const [picked, setPicked] = useState<Set<string>>(new Set(saved ?? []));
  const [providers, setProviders] = useState<AiProviderStatus[] | null>(null);
  const [models, setModels] = useState<Record<string, AiModel[]>>({});

  useEffect(() => {
    let live = true;
    void backend.aiSettings().then((v) => {
      if (!live) return;
      const usable = v.providers.filter((p) => p.enabled);
      setProviders(usable);
      for (const p of usable)
        void modelsOf(p.id).then((list) => live && setModels((m) => ({ ...m, [p.id]: list })));
    });
    return () => {
      live = false;
    };
  }, []);

  const toggle = (entry: string, on: boolean) =>
    setPicked((s) => {
      const next = new Set(s);
      if (on) next.add(entry);
      else next.delete(entry);
      return next;
    });

  const save = (list: string[] | null) => {
    void changeSetting(`Allowed models for “${nameOf(path)}”`, "ai.models", path, () =>
      useConfig.getState().update((c) => {
        const next = { ...c.ai.models };
        if (list === null) delete next[path];
        else next[path] = list;
        return { ...c, ai: { ...c.ai, models: next } };
      }),
    );
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal allowed-models"
        role="dialog"
        aria-label={`Allowed models for ${nameOf(path)}`}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <header className="ask-ai-header">
          <h2>Allowed models for “{nameOf(path)}”</h2>
          <button className="ai-icon" aria-label="Close" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        <p className="muted">
          Notes here can only be sent to the models you tick, by every AI feature and every
          fallback. A request that also reads notes from elsewhere must suit both. Leave everything
          unticked and save to block AI here.
        </p>
        {providers === null ? (
          <p className="muted">Loading providers…</p>
        ) : providers.length === 0 ? (
          <p className="muted">No AI providers are set up yet (Settings → AI).</p>
        ) : (
          <div className="allowed-models-list">
            {providers.map((p) => {
              const any = picked.has(`${p.id}/*`);
              return (
                <fieldset key={p.id}>
                  <legend>
                    {p.name}
                    {p.local && (
                      <span className="muted">
                        {" "}
                        <HardDrive size={11} aria-hidden /> on this computer
                      </span>
                    )}
                  </legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={any}
                      onChange={(e) => toggle(`${p.id}/*`, e.target.checked)}
                    />
                    Any {p.name} model
                  </label>
                  {(models[p.id] ?? []).map((m) => (
                    <label key={m.id}>
                      <input
                        type="checkbox"
                        disabled={any}
                        checked={any || picked.has(`${p.id}/${m.id}`)}
                        onChange={(e) => toggle(`${p.id}/${m.id}`, e.target.checked)}
                      />
                      {m.name}
                    </label>
                  ))}
                </fieldset>
              );
            })}
          </div>
        )}
        <footer className="ask-ai-footer">
          {saved && <button onClick={() => save(null)}>Allow any model</button>}
          <button className="primary" onClick={() => save([...picked].sort())}>
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}
