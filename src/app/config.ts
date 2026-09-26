import { create } from "zustand";
import { type AiRule, backend, isBackendError } from "../ipc";

// Per-vault settings in `.axis/config.json`. Unknown keys are preserved on save.

export const CONFIG_PATH = ".axis/config.json";

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

export interface AxisConfig {
  /** Per-folder AI access, enforced by the Rust AI layer (`src-tauri/src/ai/privacy.rs`). */
  ai: { folders: Record<string, AiRule> };
  /** "system", "light", "dark", or the name of a theme in `.axis/themes/<name>.css`. */
  theme: string;
  /** Enabled CSS snippets from `.axis/snippets/<name>.css`. */
  snippets: string[];
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
  quickCommands: {
    slashTrigger: string;
    emojiTrigger: string;
    /** IDs of built-in `/` commands to hide. */
    disabled: string[];
    custom: CustomQuickCommand[];
  };
}

export const DEFAULT_CONFIG: AxisConfig = {
  ai: { folders: {} },
  theme: "system",
  snippets: [],
  folderIcons: {},
  dailyNotes: { folder: "Daily", format: "YYYY-MM-DD", template: "", openOnStartup: false },
  templatesFolder: "Templates",
  spellcheck: { enabled: true, words: [] },
  quickCommands: { slashTrigger: "/", emojiTrigger: ":", disabled: [], custom: [] },
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
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
      set({ config: mergeConfig(JSON.parse(file.content || "{}")), loaded: true });
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
