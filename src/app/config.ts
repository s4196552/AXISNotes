import { create } from "zustand";
import { type AiRule, backend, isBackendError } from "../ipc";

// Per-vault settings in `.axisnotes/config.json`. Unknown keys are preserved on save.

export const CONFIG_PATH = ".axisnotes/config.json";

export interface CustomQuickCommand {
  /** Shown in the `/` menu. */
  label: string;
  /** Text inserted; `{{cursor}}` marks where the cursor goes. */
  insert: string;
}

export interface FolderIcon {
  /** An emoji, or `lucide:<Name>` for a built-in icon. */
  icon: string;
  color?: string;
}

export type EditorWidth = "narrow" | "medium" | "wide" | "full";

/** What Windows draws behind the see-through window (Translucent theme). */
export type WindowEffect = "clear" | "blur" | "frosted" | "mica" | "micaAlt";

export interface AxisConfig {
  /** Per-folder AI access, enforced by the Rust AI layer (`src-tauri/src/ai/privacy.rs`). */
  ai: { folders: Record<string, AiRule> };
  /** "system", "light", "dark", or the name of a theme in `.axisnotes/themes/<name>.css`. */
  theme: string;
  /** Enabled CSS snippets from `.axisnotes/snippets/<name>.css`. */
  snippets: string[];
  /** Text and layout. Fonts are family names ("" = the built-in default). */
  appearance: {
    noteFontSize: number;
    noteFont: string;
    uiFont: string;
    editorWidth: EditorWidth;
    /** Translucent theme: how opaque the window is (percent), and what shows behind it. */
    windowOpacity: number;
    windowEffect: WindowEffect;
  };
  folderIcons: Record<string, FolderIcon>;
  dailyNotes: {
    folder: string;
    /** Date format for the file name, e.g. `YYYY-MM-DD`. */
    format: string;
    /** Template note path; empty = built-in daily template. */
    template: string;
    openOnStartup: boolean;
  };
  templatesFolder: string;
  /** Offline spellcheck; `words` is the vault's personal dictionary (lower-case). */
  spellcheck: { enabled: boolean; words: string[] };
  /** Remapped keyboard shortcuts by command id ("" = no shortcut). */
  hotkeys: Record<string, string>;
  quickCommands: {
    /** Typed trigger for the command menu ("" = none; Ctrl+/ always opens it). */
    slashTrigger: string;
    emojiTrigger: string;
    /** Dates and notes, e.g. `@@today`. */
    mentionTrigger: string;
    /** Search blocks across the vault and link one. */
    blockTrigger: string;
    /** Inline `key:: value` properties. */
    propertyTrigger: string;
    /** Template variables, e.g. `{{date}}`. */
    templateTrigger: string;
    /** 2 = the triggers chosen in T-065 (older vaults are migrated once on load). */
    triggerVersion: number;
    /** IDs of built-in commands to hide from the command menu. */
    disabled: string[];
    custom: CustomQuickCommand[];
  };
}

export const DEFAULT_CONFIG: AxisConfig = {
  ai: { folders: {} },
  theme: "system",
  snippets: [],
  appearance: {
    noteFontSize: 15,
    noteFont: "",
    uiFont: "",
    editorWidth: "medium",
    windowOpacity: 80,
    windowEffect: "frosted",
  },
  folderIcons: {},
  dailyNotes: { folder: "Daily", format: "YYYY-MM-DD", template: "", openOnStartup: false },
  templatesFolder: "Templates",
  spellcheck: { enabled: true, words: [] },
  hotkeys: {},
  quickCommands: {
    slashTrigger: "",
    emojiTrigger: ":",
    mentionTrigger: "@@",
    blockTrigger: "((",
    propertyTrigger: "::",
    templateTrigger: "{{",
    triggerVersion: 2,
    disabled: [],
    custom: [],
  },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * One-time move to the T-065 triggers: the command menu opens with Ctrl+/ instead of a
 * typed `/`. A vault that still has the old default `/` saved gets "" (a trigger the user
 * chose themselves, like `;`, is kept). Runs on the raw saved JSON, before merging.
 */
export function migrateTriggers(raw: unknown): unknown {
  if (!isObject(raw) || !isObject(raw.quickCommands)) return raw;
  const q = raw.quickCommands;
  if (typeof q.triggerVersion === "number" && q.triggerVersion >= 2) return raw;
  const slashTrigger = q.slashTrigger === "/" ? "" : q.slashTrigger;
  return { ...raw, quickCommands: { ...q, slashTrigger, triggerVersion: 2 } };
}

/**
 * 0.3.1 saved the Translucent blur as `windowBlur`; it became `windowEffect`. Blur off
 * means Clear; on (or unset) gets the default, Frosted, which is the same acrylic.
 */
export function migrateWindowEffect(raw: unknown): unknown {
  if (!isObject(raw) || !isObject(raw.appearance)) return raw;
  const a = raw.appearance;
  if (a.windowEffect !== undefined || a.windowBlur !== false) return raw;
  return { ...raw, appearance: { ...a, windowEffect: "clear" } };
}

/** Deep-merge `raw` over the defaults, ignoring values of the wrong type. */
export function mergeConfig(raw: unknown): AxisConfig & Record<string, unknown> {
  const merge = (def: unknown, val: unknown): unknown => {
    if (val === undefined) return def;
    if (isObject(def)) {
      if (!isObject(val)) return def;
      const out: Record<string, unknown> = { ...val };
      for (const k of Object.keys(def)) out[k] = merge(def[k], val[k]);
      return out;
    }
    if (Array.isArray(def)) return Array.isArray(val) ? val : def;
    return typeof val === typeof def ? val : def;
  };
  return merge(DEFAULT_CONFIG, raw) as AxisConfig & Record<string, unknown>;
}

interface ConfigState {
  config: AxisConfig;
  loaded: boolean;
  load(): Promise<void>;
  /** Apply `fn` to the config and persist it. */
  update(fn: (c: AxisConfig) => AxisConfig): Promise<void>;
}

export const useConfig = create<ConfigState>((set, get) => ({
  config: DEFAULT_CONFIG,
  loaded: false,

  async load() {
    try {
      const file = await backend.readFile(CONFIG_PATH);
      const raw = migrateWindowEffect(migrateTriggers(JSON.parse(file.content || "{}")));
      set({ config: mergeConfig(raw), loaded: true });
    } catch (e) {
      // Missing or invalid: fall back to defaults (written on first change).
      if (!(isBackendError(e) && e.code === "NotFound") && !(e instanceof SyntaxError)) {
        console.warn("config load failed", e);
      }
      set({ config: DEFAULT_CONFIG, loaded: true });
    }
  },

  async update(fn) {
    const next = fn(get().config);
    set({ config: next });
    await backend.writeFile(CONFIG_PATH, JSON.stringify(next, null, 2) + "\n");
  },
}));
