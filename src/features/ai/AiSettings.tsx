import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, KeyRound, Plus, RefreshCw, Trash, X } from "lucide-react";
import {
  type AiEffort,
  type AiLogEntry,
  type AiModel,
  type AiProviderConfig,
  type AiProviderKind,
  type AiProviderStatus,
  type AiRule,
  type AiSettings,
  type AiSettingsView,
  type AiTask,
  backend,
  isBackendError,
  type VaultEntry,
} from "../../ipc";
import { useAppStore } from "../../app/store";
import { useConfig } from "../../app/config";
import { KIND_LABELS, RULE_LABELS, TASK_LABELS } from "./labels";
import "./ai.css";

// Settings → AI. Provider settings are per user and saved by the Rust layer (keys go
// to the OS keychain and are never shown again); folder rules live in the vault config.

const KINDS = Object.keys(KIND_LABELS) as AiProviderKind[];
const TASKS = Object.keys(TASK_LABELS) as AiTask[];
const message = (e: unknown) => (isBackendError(e) ? e.message : String(e));

function uniqueId(kind: AiProviderKind, taken: AiProviderConfig[]): string {
  if (!taken.some((p) => p.id === kind)) return kind;
  for (let i = 2; ; i++) if (!taken.some((p) => p.id === `${kind}-${i}`)) return `${kind}-${i}`;
}

export function AiSettingsPanel() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    backend.aiSettings().then(setView, (e: unknown) => setError(message(e)));
  }, []);
  useEffect(reload, [reload]);

  const save = useCallback(
    (fn: (s: AiSettings) => AiSettings) => {
      if (!view) return;
      backend.aiSaveSettings(fn(view.settings)).then(
        (v) => {
          setView(v);
          setError(null);
        },
        (e: unknown) => setError(message(e)),
      );
    },
    [view],
  );

  if (!view) return <p className="muted">{error ?? "Loading…"}</p>;
  return (
    <div className="ai-settings">
      {error && (
        <p className="ai-error" role="alert">
          {error}
        </p>
      )}
      <Providers view={view} save={save} reload={reload} />
      <Tasks view={view} save={save} />
      <Fallback view={view} save={save} />
      <Limits settings={view.settings} save={save} />
      <FolderRules />
      <RequestLog enabled={view.settings.logRequests} save={save} />
    </div>
  );
}

type Save = (fn: (s: AiSettings) => AiSettings) => void;

function Providers({ view, save, reload }: { view: AiSettingsView; save: Save; reload(): void }) {
  const [adding, setAdding] = useState<AiProviderKind>("openai");
  const add = () =>
    save((s) => ({
      ...s,
      providers: [
        ...s.providers,
        {
          id: uniqueId(adding, s.providers),
          kind: adding,
          name: KIND_LABELS[adding],
          baseUrl: "",
          enabled: true,
        },
      ],
    }));
  const update = (id: string, patch: Partial<AiProviderConfig>) =>
    save((s) => ({
      ...s,
      providers: s.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  const remove = (id: string) =>
    save((s) => ({ ...s, providers: s.providers.filter((p) => p.id !== id) }));

  return (
    <section className="ai-section" aria-label="Providers">
      <h3>Providers</h3>
      <p className="settings-hint muted">
        Bring your own keys. Keys are stored in your system keychain and never leave the app except
        to the provider they belong to.
      </p>
      {view.providers.length === 0 && <p className="muted">No providers yet.</p>}
      {view.providers.map((p) => (
        <ProviderCard
          key={p.id}
          provider={p}
          onChange={(patch) => update(p.id, patch)}
          onRemove={() => remove(p.id)}
          onKeyChanged={reload}
        />
      ))}
      <div className="ai-add">
        <select
          aria-label="Provider type"
          value={adding}
          onChange={(e) => setAdding(e.target.value as AiProviderKind)}
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <button onClick={add}>
          <Plus size={14} /> Add provider
        </button>
      </div>
    </section>
  );
}

function ProviderCard(p: {
  provider: AiProviderStatus;
  onChange(patch: Partial<AiProviderConfig>): void;
  onRemove(): void;
  onKeyChanged(): void;
}) {
  const { provider } = p;
  const [key, setKey] = useState("");
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const label = provider.name;

  const saveKey = async (value: string) => {
    try {
      await backend.aiSetKey(provider.id, value);
      setKey("");
      setTest(null);
      p.onKeyChanged();
    } catch (e) {
      setTest({ ok: false, text: message(e) });
    }
  };

  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      const n = await backend.aiTestProvider(provider.id);
      setTest({ ok: true, text: `Connected · ${n} model${n === 1 ? "" : "s"}` });
    } catch (e) {
      setTest({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ai-provider" aria-label={`Provider ${label}`} role="group">
      <div className="ai-provider-head">
        <input
          className="ai-provider-name"
          aria-label={`Name of ${label}`}
          defaultValue={provider.name}
          onBlur={(e) => e.target.value.trim() && p.onChange({ name: e.target.value.trim() })}
        />
        <span className="ai-kind muted">{KIND_LABELS[provider.kind]}</span>
        {provider.local && <span className="ai-badge">On this device</span>}
        <label className="ai-enabled">
          <input
            type="checkbox"
            checked={provider.enabled}
            onChange={(e) => p.onChange({ enabled: e.target.checked })}
          />
          Enabled
        </label>
        <button className="ai-icon" aria-label={`Remove ${label}`} onClick={p.onRemove}>
          <Trash size={14} />
        </button>
      </div>
      <div className="ai-provider-row">
        <input
          aria-label={`Endpoint of ${label}`}
          placeholder={provider.defaultBaseUrl || "https://your-endpoint/v1"}
          defaultValue={provider.baseUrl}
          onBlur={(e) =>
            e.target.value.trim() !== provider.baseUrl &&
            p.onChange({ baseUrl: e.target.value.trim() })
          }
        />
      </div>
      <div className="ai-provider-row">
        <span className={`ai-key-status${provider.hasKey ? " ok" : ""}`}>
          <KeyRound size={13} />{" "}
          {provider.hasKey
            ? "Key saved in keychain"
            : provider.requiresKey
              ? "No key"
              : "No key needed"}
        </span>
        <form
          className="ai-key-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) void saveKey(key);
          }}
        >
          <input
            type="password"
            autoComplete="off"
            aria-label={`API key for ${label}`}
            placeholder={provider.hasKey ? "Replace key" : "Paste API key"}
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
          <button type="submit" disabled={!key.trim()}>
            Save key
          </button>
          {provider.hasKey && (
            <button type="button" onClick={() => void saveKey("")}>
              Remove key
            </button>
          )}
        </form>
      </div>
      <div className="ai-provider-row">
        <button onClick={() => void runTest()} disabled={busy}>
          <RefreshCw size={13} className={busy ? "spin" : undefined} /> Test connection
        </button>
        {test && (
          <span className={test.ok ? "ai-ok" : "ai-error"} role="status">
            {test.ok ? <Check size={13} /> : <X size={13} />} {test.text}
          </span>
        )}
      </div>
    </div>
  );
}

function useModels(providerId: string | undefined) {
  const [models, setModels] = useState<AiModel[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!providerId) return;
    let cancelled = false;
    backend.aiListModels(providerId).then(
      (l) => {
        if (cancelled) return;
        setModels(l.models);
        setError(l.error);
      },
      (e: unknown) => !cancelled && setError(message(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [providerId]);
  return { models: providerId ? models : [], error: providerId ? error : null };
}

function Tasks({ view, save }: { view: AiSettingsView; save: Save }) {
  return (
    <section className="ai-section" aria-label="Models per task">
      <h3>Models per task</h3>
      {view.providers.length === 0 ? (
        <p className="muted">Add a provider first.</p>
      ) : (
        TASKS.map((t) => <TaskRow key={t} task={t} view={view} save={save} />)
      )}
    </section>
  );
}

function TaskRow({ task, view, save }: { task: AiTask; view: AiSettingsView; save: Save }) {
  const choice = view.settings.tasks[task];
  const { models, error } = useModels(choice?.provider);
  const vision = task === "handwriting";
  const listId = `ai-models-${task}`;
  const set = (provider: string, model: string) =>
    save((s) => ({
      ...s,
      tasks: provider ? { ...s.tasks, [task]: { provider, model } } : omit(s.tasks, task),
    }));
  const current = models.find((m) => m.id === choice?.model);
  return (
    <div className="settings-field">
      <div>
        <div className="settings-label">{TASK_LABELS[task]}</div>
        <div className="settings-hint muted">
          {vision ? "Needs a model that reads images." : "Leave empty to use the first provider."}
        </div>
      </div>
      <div className="settings-control">
        <select
          aria-label={`Provider for ${TASK_LABELS[task]}`}
          value={choice?.provider ?? ""}
          onChange={(e) => set(e.target.value, "")}
        >
          <option value="">Automatic</option>
          {view.providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {choice && (
          <>
            <input
              aria-label={`Model for ${TASK_LABELS[task]}`}
              list={listId}
              placeholder="Default for this task"
              defaultValue={choice.model}
              key={choice.provider}
              onBlur={(e) =>
                e.target.value.trim() !== choice.model &&
                set(choice.provider, e.target.value.trim())
              }
            />
            <datalist id={listId}>
              {models
                .filter((m) => !vision || m.vision)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                    {m.vision ? " · vision" : ""}
                  </option>
                ))}
            </datalist>
            {vision && current && !current.vision && (
              <span className="ai-error">This model can't read images.</span>
            )}
            {error && <span className="settings-hint muted">Model list unavailable: {error}</span>}
          </>
        )}
      </div>
    </div>
  );
}

function omit<T extends object, K extends keyof T>(o: T, k: K): T {
  const next = { ...o };
  delete next[k];
  return next;
}

function Fallback({ view, save }: { view: AiSettingsView; save: Save }) {
  const order = view.settings.fallback;
  const byId = new Map(view.providers.map((p) => [p.id, p]));
  const unused = view.providers.filter((p) => !order.includes(p.id));
  const move = (i: number, d: number) =>
    save((s) => {
      const next = [...s.fallback];
      [next[i], next[i + d]] = [next[i + d]!, next[i]!];
      return { ...s, fallback: next };
    });
  return (
    <section className="ai-section" aria-label="Fallback order">
      <h3>Fallback order</h3>
      <p className="settings-hint muted">
        If a task's provider is down, rate-limited or rejects the key, these are tried in order with
        their default model for the task.
      </p>
      <ol className="ai-fallback">
        {order.map((id, i) => (
          <li key={id}>
            <span>{byId.get(id)?.name ?? id}</span>
            <button
              className="ai-icon"
              aria-label={`Move ${byId.get(id)?.name} up`}
              disabled={i === 0}
              onClick={() => move(i, -1)}
            >
              <ArrowUp size={13} />
            </button>
            <button
              className="ai-icon"
              aria-label={`Move ${byId.get(id)?.name} down`}
              disabled={i === order.length - 1}
              onClick={() => move(i, 1)}
            >
              <ArrowDown size={13} />
            </button>
            <button
              className="ai-icon"
              aria-label={`Remove ${byId.get(id)?.name} from fallback`}
              onClick={() => save((s) => ({ ...s, fallback: s.fallback.filter((x) => x !== id) }))}
            >
              <X size={13} />
            </button>
          </li>
        ))}
      </ol>
      {unused.length > 0 && (
        <select
          aria-label="Add fallback provider"
          value=""
          onChange={(e) =>
            e.target.value && save((s) => ({ ...s, fallback: [...s.fallback, e.target.value] }))
          }
        >
          <option value="">Add a fallback…</option>
          {unused.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}

function Limits({ settings, save }: { settings: AiSettings; save: Save }) {
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v)) || 0));
  return (
    <section className="ai-section" aria-label="Limits">
      <h3>Effort and limits</h3>
      <div className="settings-field">
        <div>
          <div className="settings-label">Default effort</div>
          <div className="settings-hint muted">How hard reasoning models think.</div>
        </div>
        <div className="settings-control">
          <select
            aria-label="Default effort"
            value={settings.effort}
            onChange={(e) => save((s) => ({ ...s, effort: e.target.value as AiEffort }))}
          >
            <option value="quick">Quick</option>
            <option value="balanced">Balanced</option>
            <option value="deep">Deep</option>
          </select>
        </div>
      </div>
      <div className="settings-field">
        <div>
          <div className="settings-label">Ask before sending more than</div>
          <div className="settings-hint muted">Estimated input tokens.</div>
        </div>
        <div className="settings-control">
          <input
            type="number"
            min={0}
            aria-label="Confirm above tokens"
            defaultValue={settings.confirmAboveTokens}
            onBlur={(e) => save((s) => ({ ...s, confirmAboveTokens: num(e.target.value) ?? 0 }))}
          />
        </div>
      </div>
      <div className="settings-field">
        <div>
          <div className="settings-label">Refuse requests larger than</div>
          <div className="settings-hint muted">Estimated input tokens. Empty = no cap.</div>
        </div>
        <div className="settings-control">
          <input
            type="number"
            min={0}
            aria-label="Token cap"
            placeholder="No cap"
            defaultValue={settings.maxInputTokens ?? ""}
            onBlur={(e) => save((s) => ({ ...s, maxInputTokens: num(e.target.value) }))}
          />
        </div>
      </div>
    </section>
  );
}

function folderPaths(tree: VaultEntry | null): string[] {
  const out: string[] = [];
  const walk = (e: VaultEntry) => {
    for (const c of e.children ?? []) {
      if (c.kind === "dir") {
        out.push(c.path);
        walk(c);
      }
    }
  };
  if (tree) walk(tree);
  return out;
}

function FolderRules() {
  const folders = useConfig((s) => s.config.ai.folders);
  const update = useConfig((s) => s.update);
  const tree = useAppStore((s) => s.tree);
  const options = useMemo(() => folderPaths(tree), [tree]);
  const [path, setPath] = useState("");
  const [rule, setRule] = useState<AiRule>("never");
  const set = (p: string, r: AiRule | null) =>
    void update((c) => {
      const next = { ...c.ai.folders };
      if (r === null) delete next[p];
      else next[p] = r;
      return { ...c, ai: { ...c.ai, folders: next } };
    });
  const entries = Object.entries(folders).sort(([a], [b]) => a.localeCompare(b));
  return (
    <section className="ai-section" aria-label="Folder privacy">
      <h3>Folder privacy</h3>
      <p className="settings-hint muted">
        Notes in a folder marked <strong>Never</strong> are never sent to any AI provider;{" "}
        <strong>Local models only</strong> allows only providers on this device. Subfolders inherit
        the rule unless they have their own. Also available from the file tree's menu.
      </p>
      {entries.length > 0 && (
        <ul className="ai-rules">
          {entries.map(([p, r]) => (
            <li key={p}>
              <span className="ai-rule-path">{p || "(whole vault)"}</span>
              <select
                aria-label={`AI access for ${p}`}
                value={r}
                onChange={(e) => set(p, e.target.value as AiRule)}
              >
                {(Object.keys(RULE_LABELS) as AiRule[]).map((k) => (
                  <option key={k} value={k}>
                    {RULE_LABELS[k]}
                  </option>
                ))}
              </select>
              <button
                className="ai-icon"
                aria-label={`Remove rule for ${p}`}
                onClick={() => set(p, null)}
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="ai-add">
        <input
          aria-label="Folder"
          list="ai-folders"
          placeholder="Folder path"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <datalist id="ai-folders">
          {options.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <select aria-label="Rule" value={rule} onChange={(e) => setRule(e.target.value as AiRule)}>
          <option value="never">{RULE_LABELS.never}</option>
          <option value="local">{RULE_LABELS.local}</option>
          <option value="any">{RULE_LABELS.any}</option>
        </select>
        <button
          disabled={!path.trim()}
          onClick={() => {
            set(path.trim().replace(/^\/+|\/+$/g, ""), rule);
            setPath("");
          }}
        >
          <Plus size={14} /> Add rule
        </button>
      </div>
    </section>
  );
}

function RequestLog({ enabled, save }: { enabled: boolean; save: Save }) {
  const [entries, setEntries] = useState<AiLogEntry[] | null>(null);
  const load = () => void backend.aiLog(50).then(setEntries, () => setEntries([]));
  return (
    <section className="ai-section" aria-label="Request log">
      <h3>Request log</h3>
      <p className="settings-hint muted">
        A local record of which provider and model each request went to, with token counts and
        timing. Prompts and answers are never logged.
      </p>
      <label className="ai-enabled">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => save((s) => ({ ...s, logRequests: e.target.checked }))}
        />
        Keep a request log
      </label>
      <button onClick={load}>Show recent requests</button>
      {entries && entries.length === 0 && <p className="muted">No requests yet.</p>}
      {entries && entries.length > 0 && (
        <table className="ai-log" aria-label="Recent AI requests">
          <thead>
            <tr>
              <th>Time</th>
              <th>Task</th>
              <th>Provider · model</th>
              <th>Status</th>
              <th>Tokens in/out</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={i} title={e.error}>
                <td>{new Date(e.time).toLocaleString()}</td>
                <td>{TASK_LABELS[e.task]}</td>
                <td>
                  {e.provider ? `${e.provider} · ${e.model}` : "—"}
                  {e.local ? " (local)" : ""}
                </td>
                <td className={`ai-status-${e.status}`}>{e.status}</td>
                <td>
                  {e.inputTokens ?? `~${e.estimatedInputTokens}`} / {e.outputTokens ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
