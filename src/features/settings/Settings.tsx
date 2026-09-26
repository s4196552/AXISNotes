import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { backend } from "../../ipc";
import { type AxisConfig, useConfig } from "../../app/config";
import { formatDate } from "../../lib/dates";
import { SLASH_COMMANDS } from "../editor/quickCommands";
import { AiSettingsPanel } from "../ai/AiSettings";
import "./settings.css";

type Section = "appearance" | "spelling" | "daily" | "templates" | "commands" | "ai";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "spelling", label: "Spelling" },
  { id: "daily", label: "Daily notes" },
  { id: "templates", label: "Templates" },
  { id: "commands", label: "Quick commands" },
  { id: "ai", label: "AI" },
];

export function Settings({ onClose }: { onClose(): void }) {
  const [section, setSection] = useState<Section>("appearance");
  const config = useConfig((s) => s.config);
  const update = useConfig((s) => s.update);
  const set = (fn: (c: AxisConfig) => AxisConfig) => void update(fn);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal settings"
        role="dialog"
        aria-label="Settings"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onClose()}
      >
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              aria-current={section === s.id ? "page" : undefined}
              onClick={() => setSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <header className="settings-header">
            <h2>{SECTIONS.find((s) => s.id === section)!.label}</h2>
            <button aria-label="Close settings" onClick={onClose}>
              <X size={16} />
            </button>
          </header>
          {section === "appearance" && <Appearance config={config} set={set} />}
          {section === "spelling" && <Spelling config={config} set={set} />}
          {section === "daily" && <Daily config={config} set={set} />}
          {section === "templates" && (
            <Field label="Templates folder" hint="Notes in this folder are offered as templates.">
              <input
                aria-label="Templates folder"
                defaultValue={config.templatesFolder}
                onBlur={(e) => set((c) => ({ ...c, templatesFolder: e.target.value.trim() }))}
              />
            </Field>
          )}
          {section === "commands" && <Commands config={config} set={set} />}
          {section === "ai" && <AiSettingsPanel />}
        </div>
      </div>
    </div>
  );
}

function Field(p: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="settings-field">
      <div>
        <div className="settings-label">{p.label}</div>
        {p.hint && <div className="settings-hint muted">{p.hint}</div>}
      </div>
      <div className="settings-control">{p.children}</div>
    </div>
  );
}

interface SectionProps {
  config: AxisConfig;
  set(fn: (c: AxisConfig) => AxisConfig): void;
}

function Appearance({ config, set }: SectionProps) {
  const [themes, setThemes] = useState<string[]>([]);
  const [snippets, setSnippets] = useState<string[]>([]);
  useEffect(() => {
    void backend.listAxisFiles("themes").then(setThemes, () => {});
    void backend.listAxisFiles("snippets").then(setSnippets, () => {});
  }, []);
  return (
    <>
      <Field
        label="Theme"
        hint="Custom themes are CSS files in .axis/themes that override the color variables."
      >
        <select
          aria-label="Theme"
          value={config.theme}
          onChange={(e) => set((c) => ({ ...c, theme: e.target.value }))}
        >
          <option value="system">Match system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          {themes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="CSS snippets" hint="Files in .axis/snippets, applied on top of the theme.">
        {snippets.length === 0 ? (
          <span className="muted">None found</span>
        ) : (
          <div className="settings-checks">
            {snippets.map((s) => (
              <label key={s}>
                <input
                  type="checkbox"
                  checked={config.snippets.includes(s)}
                  onChange={(e) =>
                    set((c) => ({
                      ...c,
                      snippets: e.target.checked
                        ? [...c.snippets, s]
                        : c.snippets.filter((x) => x !== s),
                    }))
                  }
                />
                {s}
              </label>
            ))}
          </div>
        )}
      </Field>
    </>
  );
}

function Spelling({ config, set }: SectionProps) {
  const sp = config.spellcheck;
  const setSp = (patch: Partial<AxisConfig["spellcheck"]>) =>
    set((c) => ({ ...c, spellcheck: { ...c.spellcheck, ...patch } }));
  return (
    <>
      <Field
        label="Check spelling"
        hint="English (US) Hunspell dictionary, on this device. Right-click an underlined word, or press Ctrl+. on it, for suggestions."
      >
        <input
          type="checkbox"
          aria-label="Check spelling"
          checked={sp.enabled}
          onChange={(e) => setSp({ enabled: e.target.checked })}
        />
      </Field>
      <Field label="Personal dictionary" hint="Stored in this vault's .axis/config.json.">
        {sp.words.length === 0 ? (
          <span className="muted">No words yet</span>
        ) : (
          <ul className="settings-custom" aria-label="Personal dictionary">
            {sp.words.map((w) => (
              <li key={w}>
                <span>{w}</span>
                <button
                  aria-label={`Remove ${w}`}
                  onClick={() => setSp({ words: sp.words.filter((x) => x !== w) })}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>
    </>
  );
}

function Daily({ config, set }: SectionProps) {
  const d = config.dailyNotes;
  const setDaily = (patch: Partial<AxisConfig["dailyNotes"]>) =>
    set((c) => ({ ...c, dailyNotes: { ...c.dailyNotes, ...patch } }));
  return (
    <>
      <Field label="Folder">
        <input
          aria-label="Daily notes folder"
          defaultValue={d.folder}
          onBlur={(e) => setDaily({ folder: e.target.value.trim() })}
        />
      </Field>
      <Field label="File name format" hint={`Today: ${formatDate(new Date(), d.format)}.md`}>
        <input
          aria-label="Daily note format"
          defaultValue={d.format}
          onBlur={(e) => setDaily({ format: e.target.value.trim() || "YYYY-MM-DD" })}
        />
      </Field>
      <Field
        label="Template"
        hint="Path of a template note; empty uses the built-in daily template."
      >
        <input
          aria-label="Daily note template"
          placeholder="Templates/Daily.md"
          defaultValue={d.template}
          onBlur={(e) => setDaily({ template: e.target.value.trim() })}
        />
      </Field>
      <Field label="Open on startup">
        <input
          type="checkbox"
          aria-label="Open daily note on startup"
          checked={d.openOnStartup}
          onChange={(e) => setDaily({ openOnStartup: e.target.checked })}
        />
      </Field>
    </>
  );
}

function Commands({ config, set }: SectionProps) {
  const q = config.quickCommands;
  const setQ = (patch: Partial<AxisConfig["quickCommands"]>) =>
    set((c) => ({ ...c, quickCommands: { ...c.quickCommands, ...patch } }));
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  return (
    <>
      <Field label="Command trigger" hint="Typed at the start of a line or after a space.">
        <input
          aria-label="Command trigger"
          maxLength={3}
          defaultValue={q.slashTrigger}
          onBlur={(e) => setQ({ slashTrigger: e.target.value })}
        />
      </Field>
      <Field label="Emoji trigger" hint="Followed by at least two letters, e.g. :rocket">
        <input
          aria-label="Emoji trigger"
          maxLength={3}
          defaultValue={q.emojiTrigger}
          onBlur={(e) => setQ({ emojiTrigger: e.target.value })}
        />
      </Field>
      <Field label="Built-in commands">
        <div className="settings-checks settings-columns">
          {SLASH_COMMANDS.map((c) => (
            <label key={c.id}>
              <input
                type="checkbox"
                checked={!q.disabled.includes(c.id)}
                onChange={(e) =>
                  setQ({
                    disabled: e.target.checked
                      ? q.disabled.filter((x) => x !== c.id)
                      : [...q.disabled, c.id],
                  })
                }
              />
              {c.label}
            </label>
          ))}
        </div>
      </Field>
      <Field label="Custom commands" hint="Inserted text; {{cursor}} marks where the cursor goes.">
        <ul className="settings-custom" aria-label="Custom commands">
          {q.custom.map((c, i) => (
            <li key={i}>
              <strong>{c.label}</strong>
              <code>{c.insert}</code>
              <button
                aria-label={`Remove ${c.label}`}
                onClick={() => setQ({ custom: q.custom.filter((_, j) => j !== i) })}
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="settings-add"
          onSubmit={(e) => {
            e.preventDefault();
            if (!label.trim() || !text) return;
            setQ({ custom: [...q.custom, { label: label.trim(), insert: text }] });
            setLabel("");
            setText("");
          }}
        >
          <input
            aria-label="Custom command name"
            placeholder="Name"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <input
            aria-label="Custom command text"
            placeholder="Text to insert"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button type="submit" aria-label="Add custom command">
            <Plus size={14} />
          </button>
        </form>
      </Field>
    </>
  );
}
