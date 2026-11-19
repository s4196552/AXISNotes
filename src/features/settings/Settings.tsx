import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Bot,
  Cable,
  CalendarDays,
  Images,
  Info,
  Keyboard,
  LayoutTemplate,
  type LucideIcon,
  Paintbrush,
  PanelLeftDashed,
  Palette,
  Paperclip,
  Plus,
  Puzzle,
  RefreshCw,
  Scissors,
  Sparkles,
  WandSparkles,
  SpellCheck,
  SquareSlash,
  TextCursor,
  Type,
  X,
} from "lucide-react";
import { backend } from "../../ipc";
import { type AxisConfig, type EditorWidth, useConfig } from "../../app/config";
import {
  EDITOR_WIDTHS,
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
import { AgentSettingsPanel } from "../agent/AgentSettingsPanel";
import { ClipperSettings } from "../clipper/ClipperSettings";
import { ClaudeSettings } from "../claude/ClaudeSettings";
import { UpdatesSettings } from "../updates/UpdatesSettings";
import { HotkeysSettings } from "./HotkeysSettings";
import { PluginsSettings } from "./PluginsSettings";
import { ThemePicker } from "./ThemePicker";
import { LogoSettings } from "../packs/LogoSettings";
import { filterSettings, hasAll, HIDDEN, wordsOf } from "./settingsSearch";
import { FoldArrowPicker } from "./FoldArrowPicker";
import { AppColorPicker } from "./AppColorPicker";
import { HeadingColorPicker } from "./HeadingColorPicker";
import { TextColorSettings } from "./TextColorSettings";
import { About } from "./About";
import { PacksSettings } from "../packs/PacksSettings";
import { Field, type SectionProps } from "./parts";
import { Typography } from "./Typography";
import { CursorSettings } from "./CursorSettings";
import { RibbonSettings } from "./RibbonSettings";
import { EasyOnTheEyes } from "./EasyOnTheEyes";
import { SkillsSettings } from "./SkillsSettings";
import "./settings.css";

export type Section =
  | "appearance"
  | "typography"
  | "cursor"
  | "ribbon"
  | "colours"
  | "packs"
  | "spelling"
  | "daily"
  | "templates"
  | "files"
  | "commands"
  | "hotkeys"
  | "ai"
  | "skills"
  | "agent"
  | "claude"
  | "clipper"
  | "plugins"
  | "updates"
  | "about";

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "typography", label: "Typography", icon: Type },
  { id: "cursor", label: "Cursor", icon: TextCursor },
  { id: "ribbon", label: "Ribbon", icon: PanelLeftDashed },
  { id: "colours", label: "Colours", icon: Paintbrush },
  { id: "packs", label: "Icon & image packs", icon: Images },
  { id: "spelling", label: "Spelling", icon: SpellCheck },
  { id: "daily", label: "Home & daily notes", icon: CalendarDays },
  { id: "templates", label: "Templates", icon: LayoutTemplate },
  { id: "files", label: "Files & links", icon: Paperclip },
  { id: "commands", label: "Quick commands", icon: SquareSlash },
  { id: "hotkeys", label: "Keyboard shortcuts", icon: Keyboard },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "skills", label: "Skills", icon: WandSparkles },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "claude", label: "Claude", icon: Cable },
  { id: "clipper", label: "Web clipper", icon: Scissors },
  { id: "plugins", label: "Plugins", icon: Puzzle },
  { id: "updates", label: "Updates", icon: RefreshCw },
  { id: "about", label: "About", icon: Info },
];

/**
 * What the sidebar lists: one page per topic. Related sections share a page and switch
 * with tabs (Appearance, Colours and packs; commands and shortcuts; AI, Agent and Claude).
 * Sections keep their own ids, so links to a section (`section="claude"`) still land on it.
 */
const PAGES: { label: string; icon: LucideIcon; parts: Section[] }[] = [
  {
    label: "Appearance",
    icon: Palette,
    parts: ["appearance", "typography", "cursor", "ribbon", "colours", "packs"],
  },
  { label: "Spelling", icon: SpellCheck, parts: ["spelling"] },
  { label: "Home & daily notes", icon: CalendarDays, parts: ["daily"] },
  { label: "Templates", icon: LayoutTemplate, parts: ["templates"] },
  { label: "Files & links", icon: Paperclip, parts: ["files"] },
  { label: "Commands & shortcuts", icon: SquareSlash, parts: ["commands", "hotkeys"] },
  { label: "AI", icon: Sparkles, parts: ["ai", "skills", "agent", "claude"] },
  { label: "Web clipper", icon: Scissors, parts: ["clipper"] },
  { label: "Plugins", icon: Puzzle, parts: ["plugins"] },
  { label: "Updates", icon: RefreshCw, parts: ["updates"] },
  { label: "About", icon: Info, parts: ["about"] },
];

/** A section's name as a tab on its page, where the page's own name would repeat it. */
const TAB_LABELS: Partial<Record<Section, string>> = {
  appearance: "Theme & layout",
  ai: "Providers & models",
};

const pageOf = (section: Section) => PAGES.find((p) => p.parts.includes(section))!;
const sectionLabel = (id: Section) => SECTIONS.find((s) => s.id === id)!.label;

export function Settings({ onClose, section: initial }: { onClose(): void; section?: Section }) {
  const [section, setSection] = useState<Section>(initial ?? "appearance");
  const page = pageOf(section);
  const [query, setQuery] = useState("");
  const searching = query.trim() !== "";
  const config = useConfig((s) => s.config);
  const update = useConfig((s) => s.update);
  const set = (fn: (c: AxisConfig) => AxisConfig) => void update(fn);
  const open = (id: Section) => {
    setQuery("");
    setSection(id);
  };

  const render = (id: Section) => {
    switch (id) {
      case "appearance":
        return <Appearance config={config} set={set} />;
      case "typography":
        return <Typography config={config} set={set} />;
      case "cursor":
        return <CursorSettings config={config} set={set} />;
      case "ribbon":
        return <RibbonSettings config={config} set={set} />;
      case "colours":
        return <Colours config={config} set={set} />;
      case "packs":
        return <PacksSettings />;
      case "spelling":
        return <Spelling config={config} set={set} />;
      case "daily":
        return <Daily config={config} set={set} />;
      case "files":
        return <Files config={config} set={set} />;
      case "templates":
        return (
          <Field label="Templates folder" hint="Notes in this folder are offered as templates.">
            <input
              aria-label="Templates folder"
              defaultValue={config.templatesFolder}
              onBlur={(e) => set((c) => ({ ...c, templatesFolder: e.target.value.trim() }))}
            />
          </Field>
        );
      case "commands":
        return <Commands config={config} set={set} />;
      case "ai":
        return <AiSettingsPanel />;
      case "skills":
        return <SkillsSettings />;
      case "agent":
        return <AgentSettingsPanel />;
      case "claude":
        return <ClaudeSettings />;
      case "clipper":
        return <ClipperSettings />;
      case "plugins":
        return <PluginsSettings />;
      case "updates":
        return <UpdatesSettings />;
      case "hotkeys":
        return <HotkeysSettings config={config} set={set} />;
      case "about":
        return <About />;
    }
  };

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
          <input
            type="search"
            className="settings-search"
            aria-label="Search settings"
            placeholder="Search settings"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Escape clears the search first; an empty box lets it close Settings.
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
          />
          {PAGES.map((p) => (
            <button
              key={p.label}
              aria-current={!searching && page === p ? "page" : undefined}
              onClick={() => open(p.parts[0]!)}
            >
              <p.icon size={16} aria-hidden="true" />
              {p.label}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <header className="settings-header">
            <h2>{searching ? "Search results" : page.label}</h2>
            <button aria-label="Close settings" onClick={onClose}>
              <X size={16} />
            </button>
          </header>
          {searching ? (
            <SearchResults query={query} render={render} open={open} />
          ) : (
            <>
              {page.parts.length > 1 && (
                <div
                  className="settings-subtabs"
                  role="tablist"
                  aria-label={page.label}
                  onKeyDown={(e) => {
                    // Arrow keys move between the tabs, as in any tab list.
                    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
                    if (!step) return;
                    e.preventDefault();
                    const at = page.parts.indexOf(section);
                    const next = page.parts[(at + step + page.parts.length) % page.parts.length]!;
                    setSection(next);
                    document.getElementById(`settings-tab-${next}`)?.focus();
                  }}
                >
                  {page.parts.map((id) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      id={`settings-tab-${id}`}
                      aria-selected={section === id}
                      // Tab reaches the chosen tab; arrows move between them.
                      tabIndex={section === id ? 0 : -1}
                      aria-controls="settings-tabpanel"
                      onClick={() => setSection(id)}
                    >
                      {TAB_LABELS[id] ?? sectionLabel(id)}
                    </button>
                  ))}
                </div>
              )}
              <div
                id="settings-tabpanel"
                {...(page.parts.length > 1
                  ? { role: "tabpanel", "aria-labelledby": `settings-tab-${section}` }
                  : {})}
              >
                {render(section)}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Search ----

/**
 * Sections that load live data when they open (AI asks every provider for its models):
 * a search doesn't open them, it offers them by these words.
 */
const LIVE_KEYWORDS: Partial<Record<Section, string>> = {
  ai:
    "providers api key openai chatgpt anthropic claude gemini openrouter ollama lm studio " +
    "models per task handwriting diagrams text fixes fallback order effort and limits " +
    "token cap ask before sending folder privacy request log",
  clipper:
    "browser extension chrome firefox paired browsers pairing code clippings folder " +
    "enable the web clipper install the extension",
  updates:
    "check for updates when axisnotes starts install updates automatically updates folder version",
  packs: "icon packs image packs emoji add pack icons images",
  plugins: "AXIS Hub plugins launcher shortcut packs apps files folders dashboard sidebar",
  claude: "claude desktop claude code mcp connector plan subscription copy command config",
};

function SearchResults(p: {
  query: string;
  render(id: Section): React.ReactNode;
  open(id: Section): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = useState(false);
  const { query } = p;
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const words = wordsOf(query);
    const run = () => setEmpty(!filterSettings(root, words));
    run();
    // Sections fill in after loading (fonts, templates): filter again as they change. Only
    // content changes, not the classes set here, so it can't loop.
    const watch = new MutationObserver(run);
    watch.observe(root, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, [query]);
  const words = wordsOf(query);
  return (
    <div ref={ref} className="settings-search-results">
      {SECTIONS.map((s) => {
        const live = LIVE_KEYWORDS[s.id];
        if (live !== undefined)
          return (
            <div
              key={s.id}
              className={`settings-search-section${hasAll(words, `${s.label} ${live}`) ? "" : ` ${HIDDEN}`}`}
              data-live=""
            >
              <button className="settings-search-goto" onClick={() => p.open(s.id)}>
                <s.icon size={16} aria-hidden="true" />
                <span>
                  Open {s.label}
                  <span className="settings-hint muted">
                    Settings for {s.label} are on its page
                  </span>
                </span>
              </button>
            </div>
          );
        return (
          <div key={s.id} className="settings-search-section" data-label={s.label}>
            <h3 className="settings-search-heading">{s.label}</h3>
            <div className="settings-search-body">{p.render(s.id)}</div>
          </div>
        );
      })}
      {empty && <p className="muted settings-search-empty">No settings match “{query.trim()}”.</p>}
    </div>
  );
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

/** Settings → Colours: the user's own sidebar and note-area colours over the theme. */
function Colours({ config, set }: SectionProps) {
  const setAppColors = (appColors: AxisConfig["appearance"]["appColors"]) =>
    set((c) => ({ ...c, appearance: { ...c.appearance, appColors } }));
  return (
    <Field
      label="App colours"
      hint={
        config.theme === "axis:translucent"
          ? "Translucent shows your desktop, so these apply with the other themes."
          : "Your own colours for the sidebars and the note area, over the theme. Text left on Auto is dark on light colours and light on dark ones."
      }
    >
      <AppColorPicker value={config.appearance.appColors} onChange={setAppColors} />
    </Field>
  );
}

function Appearance({ config, set }: SectionProps) {
  const [themes, setThemes] = useState<string[]>([]);
  const [snippets, setSnippets] = useState<string[]>([]);
  useEffect(() => {
    void backend.listAxisFiles("themes").then(setThemes, () => {});
    void backend.listAxisFiles("snippets").then(setSnippets, () => {});
  }, []);
  const zoom = useZoom((s) => s.zoom);
  const setZoom = useZoom((s) => s.setZoom);
  const a = config.appearance;
  const setA = (patch: Partial<AxisConfig["appearance"]>) =>
    set((c) => ({ ...c, appearance: { ...c.appearance, ...patch } }));
  return (
    <>
      <LogoSettings />
      <ThemePicker
        value={config.theme}
        custom={themes}
        onChange={(theme) => set((c) => ({ ...c, theme }))}
      />
      {config.theme === "axis:translucent" && <Translucency a={a} setA={setA} />}
      <EasyOnTheEyes config={config} set={set} />
      <Field
        label="Zoom"
        hint="Everything gets bigger or smaller. Also Ctrl + = / Ctrl + − / Ctrl + 0. Ctrl + mouse wheel zooms only the part of the window under the pointer (a side panel, the tabs or the main view); Ctrl + 0 resets those too."
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
      <Field
        label="Boxy layout"
        hint="The side panels and the note area meet edge to edge with square corners, split by thin lines, instead of floating as rounded cards."
      >
        <input
          type="checkbox"
          aria-label="Boxy layout"
          checked={a.boxy}
          onChange={(e) => setA({ boxy: e.target.checked })}
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
      <Field label="Heading colours" hint="A colour for each heading level, or the theme's own.">
        <HeadingColorPicker
          value={a.headingColors}
          onChange={(headingColors) => setA({ headingColors })}
        />
      </Field>
      <Field
        label="Bold, italic and strikethrough colours"
        hint="Give each its own colour in notes and AI answers, for light and for dark themes. Off, the text keeps the theme's colour. Your Markdown files don't change."
      >
        <TextColorSettings value={a.textColors} onChange={(textColors) => setA({ textColors })} />
      </Field>
      <Field
        label="Heading indicator"
        hint="Short lines at the edge of a note, one per heading: the longest for its biggest headings. Point at them to see the headings and jump to one."
      >
        <input
          type="checkbox"
          aria-label="Heading indicator"
          checked={a.headingIndicator}
          onChange={(e) => setA({ headingIndicator: e.target.checked })}
        />
      </Field>
      <Field
        label="Heading indicator side"
        hint="Which edge of the note the heading lines sit at. On the left they stay clear of the + and grip controls."
      >
        <select
          aria-label="Heading indicator side"
          value={a.headingIndicatorSide === "left" ? "left" : "right"}
          disabled={!a.headingIndicator}
          onChange={(e) =>
            setA({ headingIndicatorSide: e.target.value === "left" ? "left" : "right" })
          }
        >
          <option value="right">Right</option>
          <option value="left">Left</option>
        </select>
      </Field>
      <Field label="Fold arrows" hint="The arrows that fold headings and toggle lists.">
        <FoldArrowPicker value={a.foldArrow} onChange={(foldArrow) => setA({ foldArrow })} />
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
      <Field label="Emoji and icons" hint="Opens the picker. Search by name or choose Add icon…">
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
