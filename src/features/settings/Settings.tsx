import { useEffect, useState, useSyncExternalStore } from "react";
import {
  CalendarDays,
  Images,
  Info,
  Keyboard,
  LayoutTemplate,
  type LucideIcon,
  Palette,
  Paperclip,
  Plus,
  RefreshCw,
  Scissors,
  Sparkles,
  SpellCheck,
  SquareSlash,
  X,
} from "lucide-react";
import { backend } from "../../ipc";
import { type AxisConfig, type EditorWidth, useConfig } from "../../app/config";
import {
  EDITOR_WIDTHS,
  fontStack,
  NOTE_FONT_SIZES,
  onTransparencyEffectsChange,
  transparencyEffectsOff,
  WINDOW_EFFECTS,
  WINDOW_OPACITY,
  windowEffectInfo,
} from "../../app/appearance";
import { useZoom, ZOOM_STEPS, zoomIn, zoomOut, zoomReset } from "../../app/zoom";
import { formatDate } from "../../lib/dates";
import { SLASH_COMMANDS } from "../editor/quickCommands";
import { allCommands, shortcutOf } from "../commands/registry";
import { formatHotkey } from "../commands/hotkeys";
import { AiSettingsPanel } from "../ai/AiSettings";
import { ClipperSettings } from "../clipper/ClipperSettings";
import { UpdatesSettings } from "../updates/UpdatesSettings";
import { HotkeysSettings } from "./HotkeysSettings";
import { ThemePicker } from "./ThemePicker";
import { About } from "./About";
import { PacksSettings } from "../packs/PacksSettings";
import "./settings.css";

export type Section =
  | "appearance"
  | "packs"
  | "spelling"
  | "daily"
  | "templates"
  | "files"
  | "commands"
  | "hotkeys"
  | "ai"
  | "clipper"
  | "updates"
  | "about";

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "packs", label: "Icon & image packs", icon: Images },
  { id: "spelling", label: "Spelling", icon: SpellCheck },
  { id: "daily", label: "Home & daily notes", icon: CalendarDays },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "files", label: "Files & links", icon: Paperclip },
  { id: "commands", label: "Quick commands", icon: SquareSlash },
  { id: "hotkeys", label: "Keyboard shortcuts", icon: Keyboard },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "clipper", label: "Web clipper", icon: Scissors },
  { id: "updates", label: "Updates", icon: RefreshCw },
  { id: "about", label: "About", icon: Info },
];

export function Settings({ onClose, section: initial }: { onClose(): void; section?: Section }) {
  const [section, setSection] = useState<Section>(initial ?? "appearance");
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
              <s.icon size={16} aria-hidden="true" />
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
          {section === "packs" && <PacksSettings />}
          {section === "spelling" && <Spelling config={config} set={set} />}
          {section === "daily" && <Daily config={config} set={set} />}
          {section === "files" && <Files config={config} set={set} />}
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
          {section === "clipper" && <ClipperSettings />}
          {section === "updates" && <UpdatesSettings />}
          {section === "hotkeys" && <HotkeysSettings config={config} set={set} />}
          {section === "about" && <About />}
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

/** The Translucent theme's settings: window opacity, and blur behind it. */
function Translucency(p: {
  a: AxisConfig["appearance"];
  setA(patch: Partial<AxisConfig["appearance"]>): void;
}) {
  const can = backend.canBeTranslucent();
  // Live: the hint tells the user to change a Windows setting while this is open.
  const effectsOff = useSyncExternalStore(onTransparencyEffectsChange, transparencyEffectsOff);
  const effect = windowEffectInfo(p.a.windowEffect);
  const index = WINDOW_EFFECTS.indexOf(effect);
  const choose = (i: number) => p.setA({ windowEffect: WINDOW_EFFECTS[i]!.id });
  const needsWindows = can && effectsOff && effect.os !== null;
  return (
    <>
      <Field
        label="Window opacity"
        hint={
          can
            ? `How much of your desktop shows through. Menus and dialogs ${effect.id === "liquid" ? "are glass" : "stay solid"}.`
            : "See-through windows need Windows for now; here Translucent stays solid."
        }
      >
        <span className="range-control">
          <input
            type="range"
            aria-label="Window opacity"
            min={WINDOW_OPACITY.min}
            max={WINDOW_OPACITY.max}
            step={WINDOW_OPACITY.step}
            value={p.a.windowOpacity}
            disabled={!can}
            onChange={(e) => p.setA({ windowOpacity: Number(e.target.value) })}
          />
          <span className="muted">{p.a.windowOpacity}%</span>
        </span>
      </Field>
      <Field
        label="Effect"
        hint={
          needsWindows
            ? `${effect.label} needs Windows' transparency effects (Settings → Personalization → Colors). Until they're on, the window looks Clear.`
            : effect.note
        }
      >
        <div className="effect-slider">
          <input
            type="range"
            aria-label="Window effect"
            aria-valuetext={effect.label}
            min={0}
            max={WINDOW_EFFECTS.length - 1}
            step={1}
            value={index}
            disabled={!can}
            onChange={(e) => choose(Number(e.target.value))}
          />
          {/* The stops, under the slider; clicking one picks it (the slider is the control
              for keyboards and screen readers). */}
          <div className="effect-stops" aria-hidden="true">
            {WINDOW_EFFECTS.map((e, i) => (
              <span
                key={e.id}
                className={i === index ? "effect-stop current" : "effect-stop"}
                onClick={() => can && choose(i)}
              >
                {e.label}
              </span>
            ))}
          </div>
        </div>
      </Field>
    </>
  );
}

/** A font picker: the default, then every installed family, each shown in its own font. */
function FontSelect(p: {
  label: string;
  fonts: string[];
  value: string;
  defaultLabel: string;
  onChange(font: string): void;
}) {
  // A font chosen on another computer stays listed even if it isn't installed here.
  const missing = p.value && !p.fonts.includes(p.value);
  return (
    <select aria-label={p.label} value={p.value} onChange={(e) => p.onChange(e.target.value)}>
      <option value="">{p.defaultLabel}</option>
      {missing && <option value={p.value}>{p.value} (not installed)</option>}
      {p.fonts.map((f) => (
        <option key={f} value={f} style={{ fontFamily: fontStack(f, "inherit") }}>
          {f}
        </option>
      ))}
    </select>
  );
}

function Appearance({ config, set }: SectionProps) {
  const [themes, setThemes] = useState<string[]>([]);
  const [snippets, setSnippets] = useState<string[]>([]);
  const [fonts, setFonts] = useState<string[]>([]);
  useEffect(() => {
    void backend.listAxisFiles("themes").then(setThemes, () => {});
    void backend.listAxisFiles("snippets").then(setSnippets, () => {});
    void backend.listFonts().then(setFonts, () => {});
  }, []);
  const zoom = useZoom((s) => s.zoom);
  const setZoom = useZoom((s) => s.setZoom);
  const a = config.appearance;
  const setA = (patch: Partial<AxisConfig["appearance"]>) =>
    set((c) => ({ ...c, appearance: { ...c.appearance, ...patch } }));
  return (
    <>
      <ThemePicker
        value={config.theme}
        custom={themes}
        onChange={(theme) => set((c) => ({ ...c, theme }))}
      />
      {config.theme === "axis:translucent" && <Translucency a={a} setA={setA} />}
      <Field
        label="Zoom"
        hint="Everything gets bigger or smaller. Also Ctrl + = / Ctrl + − / Ctrl + 0, or Ctrl + mouse wheel."
      >
        <span className="zoom-control">
          <button aria-label="Zoom out" onClick={zoomOut} disabled={zoom <= ZOOM_STEPS[0]!}>
            −
          </button>
          <select
            aria-label="Zoom"
            value={String(zoom)}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            {(ZOOM_STEPS.includes(zoom)
              ? ZOOM_STEPS
              : [...ZOOM_STEPS, zoom].sort((x, y) => x - y)
            ).map((z) => (
              <option key={z} value={String(z)}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
          <button aria-label="Zoom in" onClick={zoomIn} disabled={zoom >= ZOOM_STEPS.at(-1)!}>
            +
          </button>
          {zoom !== 1 && <button onClick={zoomReset}>Reset</button>}
        </span>
      </Field>
      <Field label="Note text size" hint="The text of your notes; headings grow with it.">
        <span className="range-control">
          <input
            type="range"
            aria-label="Note text size"
            min={NOTE_FONT_SIZES.min}
            max={NOTE_FONT_SIZES.max}
            value={a.noteFontSize}
            onChange={(e) => setA({ noteFontSize: Number(e.target.value) })}
          />
          <span className="muted">{a.noteFontSize} px</span>
        </span>
      </Field>
      <Field label="Note font">
        <FontSelect
          label="Note font"
          fonts={fonts}
          value={a.noteFont}
          defaultLabel="Same as the interface"
          onChange={(noteFont) => setA({ noteFont })}
        />
      </Field>
      <Field label="Interface font">
        <FontSelect
          label="Interface font"
          fonts={fonts}
          value={a.uiFont}
          defaultLabel="Default (system)"
          onChange={(uiFont) => setA({ uiFont })}
        />
      </Field>
      <Field label="Editor width" hint="How wide notes are on screen.">
        <select
          aria-label="Editor width"
          value={a.editorWidth}
          onChange={(e) => setA({ editorWidth: e.target.value as EditorWidth })}
        >
          {Object.entries(EDITOR_WIDTHS).map(([id, w]) => (
            <option key={id} value={id}>
              {w.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="CSS snippets" hint="Files in .axisnotes/snippets, applied on top of the theme.">
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
      <Field label="Personal dictionary" hint="Stored in this vault's .axisnotes/config.json.">
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

function Files({ config, set }: SectionProps) {
  return (
    <>
      <p className="settings-note muted">
        Paste a screenshot, drop images or videos from your computer onto a note, or use
        &ldquo;Image, video or audio…&rdquo; in the command menu (Ctrl+/). Web images, videos and
        YouTube or Vimeo links embed with <code>![](https://…)</code>.
      </p>
      <Field
        label="Attachment folder"
        hint="Where pasted and dropped files go. Empty: the vault's top folder. ./ : next to the note. ./name : a folder next to the note. Anything else: that folder."
      >
        <input
          aria-label="Attachment folder"
          placeholder="(vault top folder)"
          defaultValue={config.attachments.folder}
          onBlur={(e) =>
            set((c) => ({ ...c, attachments: { ...c.attachments, folder: e.target.value.trim() } }))
          }
        />
      </Field>
      <Field
        label="Show the open file in the file tree"
        hint="Opening a note opens its folders in the tree and selects it. Off: use “Reveal open file in the file tree” from Ctrl+P."
      >
        <input
          type="checkbox"
          aria-label="Show the open file in the file tree"
          checked={config.fileTree.revealActiveFile}
          onChange={(e) =>
            set((c) => ({ ...c, fileTree: { ...c.fileTree, revealActiveFile: e.target.checked } }))
          }
        />
      </Field>
    </>
  );
}

function Daily({ config, set }: SectionProps) {
  const d = config.dailyNotes;
  const setDaily = (patch: Partial<AxisConfig["dailyNotes"]>) =>
    set((c) => ({ ...c, dailyNotes: { ...c.dailyNotes, ...patch } }));
  const setHome = (patch: Partial<AxisConfig["home"]>) =>
    set((c) => ({ ...c, home: { ...c.home, ...patch } }));
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
      <Field label="Open today's daily note on startup">
        <input
          type="checkbox"
          aria-label="Open daily note on startup"
          checked={d.openOnStartup}
          onChange={(e) => setDaily({ openOnStartup: e.target.checked })}
        />
      </Field>
      <Field
        label="Open Home when a vault opens"
        hint="Your tabs from last time stay open. With the daily note on too, both open and Home shows."
      >
        <input
          type="checkbox"
          aria-label="Open Home when a vault opens"
          checked={config.home.openOnStartup}
          onChange={(e) => setHome({ openOnStartup: e.target.checked })}
        />
      </Field>
      <Field label="Show Home when the last tab closes" hint="Instead of an empty new tab.">
        <input
          type="checkbox"
          aria-label="Show Home when the last tab closes"
          checked={config.home.onLastTabClose}
          onChange={(e) => setHome({ onLastTabClose: e.target.checked })}
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
  const menuCmd = allCommands().find((c) => c.id === "command-menu");
  const menuShortcut = menuCmd && shortcutOf(menuCmd);
  const commandMenuKey = menuShortcut ? formatHotkey(menuShortcut) : "";
  return (
    <>
      <p className="muted settings-note">
        {commandMenuKey
          ? `${commandMenuKey} opens the command menu at the cursor (change it under Hotkeys).`
          : "The command menu has no shortcut (set one under Hotkeys)."}{" "}
        Typed triggers work at the start of a line or after a space. Leave one empty to turn it off.
        Math is written between <code>$$</code> and <code>$$</code>.
      </p>
      <Field label="Command menu, typed" hint="Optional, e.g. / (off by default).">
        <input
          aria-label="Command trigger"
          maxLength={3}
          placeholder="off"
          defaultValue={q.slashTrigger}
          onBlur={(e) => setQ({ slashTrigger: e.target.value })}
        />
      </Field>
      <Field label="Dates and notes" hint="e.g. @@today, @@next friday, @@Biology">
        <input
          aria-label="Mention trigger"
          maxLength={3}
          defaultValue={q.mentionTrigger}
          onBlur={(e) => setQ({ mentionTrigger: e.target.value })}
        />
      </Field>
      <Field label="Link a block" hint="Search every note's paragraphs and list items.">
        <input
          aria-label="Block reference trigger"
          maxLength={3}
          defaultValue={q.blockTrigger}
          onBlur={(e) => setQ({ blockTrigger: e.target.value })}
        />
      </Field>
      <Field label="Inline property" hint="At the start of a line: becomes key:: value.">
        <input
          aria-label="Property trigger"
          maxLength={3}
          defaultValue={q.propertyTrigger}
          onBlur={(e) => setQ({ propertyTrigger: e.target.value })}
        />
      </Field>
      <Field label="Template variable" hint="{{date}} in templates; the value itself in notes.">
        <input
          aria-label="Template variable trigger"
          maxLength={3}
          defaultValue={q.templateTrigger}
          onBlur={(e) => setQ({ templateTrigger: e.target.value })}
        />
      </Field>
      <Field label="Emoji" hint="Followed by at least two letters, e.g. :rocket">
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
