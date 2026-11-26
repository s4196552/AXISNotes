import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Gauge, HardDrive } from "lucide-react";
import {
  type AiEffort,
  type AiModel,
  type AiProviderStatus,
  type AiRule,
  backend,
} from "../../ipc";
import { type AiChoice, EFFORT_LABELS, modelsOf } from "./aiBlockStore";

// The "model · effort" chip next to an AI prompt, like the one in ChatGPT's composer.
// Lists the enabled providers' models; models a note's AI rule doesn't allow are shown
// greyed out with the reason. The Rust layer still enforces the rule when sending.

export interface ModelPickerProps {
  choice: AiChoice;
  onChange(choice: AiChoice): void;
  /** The strictest AI rule of what the request reads, if known. */
  rule?: AiRule;
  /** What "Default" resolves to now, e.g. "Ollama · llama3.3". */
  defaultLabel?: string;
  /** The chip's name for "Default", e.g. "llama3.3" (otherwise "Default model"). */
  defaultName?: string;
  disabled?: boolean;
  /** Effort has its own chip (`EffortPicker`), so leave it out of this one. */
  separateEffort?: boolean;
  /** Open the menu above the chip (a composer at the bottom of a panel). */
  above?: boolean;
}

export function ModelPicker({
  choice,
  onChange,
  rule,
  defaultLabel,
  defaultName,
  disabled,
  separateEffort,
  above,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [providers, setProviders] = useState<AiProviderStatus[]>([]);
  const [models, setModels] = useState<Record<string, AiModel[]>>({});
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    backend.aiSettings().then(
      (v) => {
        if (cancelled) return;
        const usable = v.providers.filter((p) => p.enabled && (!p.requiresKey || p.hasKey));
        setProviders(usable);
        for (const p of usable)
          void modelsOf(p.id).then((list) => {
            if (!cancelled) setModels((m) => ({ ...m, [p.id]: list }));
          });
      },
      () => {},
    );
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      cancelled = true;
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const modelName =
    choice.provider && choice.model
      ? (models[choice.provider]?.find((m) => m.id === choice.model)?.name ?? choice.model)
      : (defaultName ?? "Default model");
  const label = separateEffort
    ? `Model: ${modelName}`
    : `Model and effort: ${modelName}, ${EFFORT_LABELS[choice.effort]}`;

  const pick = (next: AiChoice) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div
      className="ai-model-picker"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="ai-chip ai-model-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={!choice.provider && defaultLabel ? `Default · ${defaultLabel}` : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <strong>{modelName}</strong>
        {!separateEffort && <span>{EFFORT_LABELS[choice.effort]}</span>}
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div
          className={above ? "ai-model-menu above" : "ai-model-menu"}
          role="menu"
          aria-label="Choose a model"
        >
          {!separateEffort && (
            <div className="ai-model-effort" role="group" aria-label="Effort">
              {(Object.keys(EFFORT_LABELS) as AiEffort[]).map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={choice.effort === e}
                  onClick={() => onChange({ ...choice, effort: e })}
                >
                  {EFFORT_LABELS[e]}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!choice.provider}
            className="ai-model-item"
            onClick={() => pick({ effort: choice.effort })}
          >
            <span className="ai-model-check">{!choice.provider && <Check size={12} />}</span>
            <span className="ai-model-name">
              Default
              {defaultLabel && <span className="muted"> · {defaultLabel}</span>}
            </span>
          </button>
          {providers.length === 0 && (
            <p className="ai-model-empty muted">
              No providers are set up. Add one in Settings → AI.
            </p>
          )}
          {providers.map((p) => {
            const blocked = rule === "local" && !p.local;
            return (
              <div key={p.id} className="ai-model-group" role="group" aria-label={p.name}>
                <div className="ai-model-provider">
                  {p.name}
                  {p.local && <HardDrive size={11} aria-label="On this device" />}
                </div>
                {blocked && (
                  <p className="ai-model-reason muted">This note allows local models only.</p>
                )}
                {(models[p.id] ?? []).map((m) => {
                  const on = choice.provider === p.id && choice.model === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={on}
                      className="ai-model-item"
                      disabled={blocked}
                      title={blocked ? "This note allows local models only" : m.id}
                      onClick={() => pick({ provider: p.id, model: m.id, effort: choice.effort })}
                    >
                      <span className="ai-model-check">{on && <Check size={12} />}</span>
                      <span className="ai-model-name">{m.name}</span>
                    </button>
                  );
                })}
                {!models[p.id] && <p className="ai-model-reason muted">Loading models…</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const EFFORT_HINTS: Record<AiEffort, string> = {
  quick: "Fastest answers, least reasoning",
  balanced: "A good default for most questions",
  deep: "Thinks longer for hard questions",
};

/** The effort chip: Quick, Balanced or Deep reasoning for the chosen model. */
export function EffortPicker({
  effort,
  onChange,
  disabled,
  above,
}: {
  effort: AiEffort;
  onChange(effort: AiEffort): void;
  disabled?: boolean;
  above?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  return (
    <div
      className="ai-model-picker"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="ai-chip ai-model-chip"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Effort: ${EFFORT_LABELS[effort]}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Gauge size={12} aria-hidden />
        <span>{EFFORT_LABELS[effort]}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div
          className={above ? "ai-model-menu ai-effort-menu above" : "ai-model-menu ai-effort-menu"}
          role="menu"
          aria-label="Choose an effort"
        >
          {(Object.keys(EFFORT_LABELS) as AiEffort[]).map((e) => (
            <button
              key={e}
              type="button"
              role="menuitemradio"
              aria-checked={effort === e}
              className="ai-model-item"
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
            >
              <span className="ai-model-check">{effort === e && <Check size={12} />}</span>
              <span className="ai-model-name">
                {EFFORT_LABELS[e]}
                <span className="ai-effort-hint muted">{EFFORT_HINTS[e]}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
