// IPC contract between the React UI and the Rust core (`src-tauri/src/commands.rs`).
// All paths are vault-relative with forward slashes, e.g. "School/Biology.md".
// The vault root itself is "".

export type EntryKind = "file" | "dir";

export interface VaultEntry {
  path: string;
  name: string;
  kind: EntryKind;
  modifiedMs: number;
  /** Present for directories only. */
  children?: VaultEntry[];
}

export type PackKind = "icons" | "images";

/** A set of images the user added: icons for the icon picker, images for covers. */
export interface Pack {
  kind: PackKind;
  name: string;
  /** Vault path of its folder, e.g. `.axisnotes/packs/icons/Feather`. */
  dir: string;
  /** Vault paths of its images, sorted by name. */
  files: string[];
  /** An icon pack of one-colour SVGs: drawn in the text colour, or any colour chosen. */
  monochrome: boolean;
}

export interface VaultInfo {
  /** Absolute path of the vault folder on disk. */
  root: string;
  name: string;
}

export interface FileContent {
  content: string;
  modifiedMs: number;
}

export interface WriteResult {
  modifiedMs: number;
}

export type ChangeKind = "created" | "modified" | "removed" | "renamed";

export interface IndexProgress {
  /** Notes read so far, of `total` that needed reading. */
  done: number;
  total: number;
  finished: boolean;
}

export interface VaultChange {
  kind: ChangeKind;
  /** For "renamed": [from, to] when both are known. */
  paths: string[];
}

export type ErrorCode =
  | "NoVault"
  | "NotFound"
  | "AlreadyExists"
  | "Conflict"
  | "OutsideVault"
  | "InvalidName"
  | "Io"
  /** An AI request refused by privacy rules or cost limits. */
  | "Blocked"
  /** An AI provider failed (after retries and fallbacks). */
  | "Ai"
  | "Cancelled";

/** Shape of every rejected command. */
export interface BackendError {
  code: ErrorCode;
  message: string;
}

export function isBackendError(e: unknown): e is BackendError {
  return typeof e === "object" && e !== null && "code" in e && "message" in e;
}

// ---- Index (Phase 1) ----

export interface NoteRef {
  path: string;
  /** Basename without `.md`. */
  name: string;
  title: string | null;
  aliases: string[];
}

export interface SearchHit {
  path: string;
  title: string;
  /** Excerpt with matches wrapped in U+0001 � U+0002 (see `HL_START`/`HL_END`). */
  snippet: string;
  /** The heading the first match sits under, if any (absent from older backends). */
  heading?: string | null;
}

export const HL_START = "\u0001";
export const HL_END = "\u0002";

export interface TagCount {
  /** Lowercase, without `#`; nested tags use `/`. */
  tag: string;
  count: number;
}

/** A property name used in the vault (frontmatter or inline `key:: value`). */
export interface PropertyKey {
  key: string;
  /** Notes that use it. */
  count: number;
}

export interface LinkRef {
  /** 1-based line in the source note. */
  line: number;
  context: string;
  embed: boolean;
}

export interface Backlink {
  source: string;
  links: LinkRef[];
}

export interface Mention {
  source: string;
  line: number;
  context: string;
  /** The matched text as written. */
  text: string;
  /** UTF-16 offsets into the whole file (usable as JS string indices). */
  start: number;
  end: number;
}

export interface GraphNode {
  /** Note path, or `?<target>` for an unresolved link target. */
  id: string;
  name: string;
  tags: string[];
  unresolved: boolean;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface TaskRef {
  path: string;
  /** 1-based line in the note. */
  line: number;
  /** The line as indexed (checked before editing it). */
  raw: string;
  /** Text without the checkbox and metadata. */
  text: string;
  done: boolean;
  /** `YYYY-MM-DD`. */
  due: string | null;
  /** 0 = none, 1 = low, 2 = medium, 3 = high. */
  priority: number;
}

export interface TimeEntry {
  path: string;
  /** Local `YYYY-MM-DDTHH:mm:ss`. */
  start: string;
  /** Null while the timer is running. */
  end: string | null;
  task: string | null;
  tags: string[];
  project: string | null;
}

// ---- AI (Phase 4); see src-tauri/src/ai ----

export type AiProviderKind =
  "chatgpt" | "openai" | "anthropic" | "gemini" | "openrouter" | "ollama" | "lmstudio" | "custom";
export type AiTask = "handwriting" | "diagrams" | "textFixes" | "chat";
export type AiEffort = "quick" | "balanced" | "deep";
/** Per-folder AI access: `local` = only models on this machine. */
export type AiRule = "any" | "local" | "never";

export interface AiProviderConfig {
  id: string;
  kind: AiProviderKind;
  name: string;
  /** Empty = the provider's default endpoint. */
  baseUrl: string;
  enabled: boolean;
}

/** A provider as the UI sees it. Whether a key exists — never the key itself. */
export interface AiProviderStatus extends AiProviderConfig {
  hasKey: boolean;
  account?: string | null;
  requiresKey: boolean;
  local: boolean;
  defaultBaseUrl: string;
}

export interface AiTaskChoice {
  provider: string;
  model: string;
}

export interface AiSettings {
  providers: AiProviderConfig[];
  tasks: Partial<Record<AiTask, AiTaskChoice>>;
  /** Provider ids tried in order when the task's provider fails. */
  fallback: string[];
  maxInputTokens: number | null;
  confirmAboveTokens: number;
  effort: AiEffort;
  logRequests: boolean;
}

export interface AiSettingsView {
  settings: AiSettings;
  providers: AiProviderStatus[];
}

export interface AiModel {
  id: string;
  name: string;
  vision: boolean;
  json: boolean;
  context: number | null;
}

export interface AiModelList {
  models: AiModel[];
  /** Set when the live list failed and the built-in list was returned instead. */
  error: string | null;
}

export type AiPart = { type: "text"; text: string } | { type: "image"; mime: string; data: string };

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: AiPart[];
}

export interface AiRunRequest {
  task?: AiTask;
  messages: AiMessage[];
  /** Notes whose text is in `messages` (privacy rules apply to them). */
  sources?: string[];
  /** Notes the backend reads and attaches itself. */
  attach?: string[];
  provider?: string;
  model?: string;
  maxOutputTokens?: number;
  temperature?: number;
  effort?: AiEffort;
  json?: boolean;
}

export interface AiPlan {
  providerId: string;
  providerName: string;
  model: string;
  local: boolean;
  estimatedInputTokens: number;
  needsConfirm: boolean;
  estimatedCost: number | null;
  rule: AiRule;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiRunResult {
  text: string;
  providerId: string;
  providerName: string;
  model: string;
  local: boolean;
  usage: AiUsage | null;
  /** Set when a fallback provider answered. */
  fallbackFrom: string | null;
}

export interface AiLogEntry {
  time: number;
  task: AiTask;
  provider: string;
  model: string;
  local: boolean;
  status: "ok" | "error" | "cancelled" | "blocked";
  error?: string;
  estimatedInputTokens: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
  sources: number;
}

/** Everything the UI may ask of the backend. UI code depends on this, never on `invoke`. */
// ---- Web clipper (Phase 6); see src-tauri/src/clipper ----

export interface ClipperDevice {
  id: string;
  name: string;
  createdMs: number;
  lastUsedMs: number | null;
}

export interface ClipperStatus {
  enabled: boolean;
  /** Listening on 127.0.0.1:port. */
  running: boolean;
  port: number;
  /** Vault folder clips are saved in. */
  folder: string;
  /** e.g. the port is taken. */
  error: string | null;
  devices: ClipperDevice[];
}

export interface PairingCode {
  code: string;
  expiresInSecs: number;
}

export interface Clipped {
  path: string;
  title: string;
}

// ---- Updates from a folder (T-066); see src-tauri/src/updates.rs ----

export interface UpdateSettings {
  checkOnLaunch: boolean;
  /** Install what the launch check finds without asking (on by default). */
  autoInstall: boolean;
  /** This build can install updates (a release build on Windows). */
  canInstall: boolean;
  /** The updates folder in use: the chosen one, or the default. */
  folder: string;
  defaultFolder: string;
  currentVersion: string;
}

/** A newer version found in the updates folder. */
export interface AvailableUpdate {
  version: string;
  notes: string;
  pubDate: string | null;
  /** The installer's file name in the updates folder. */
  file: string;
}

// ---- Import from other apps (Phase 6, T-103); see src-tauri/src/import ----

/** The app an import comes from. */
export type ImportKind = "obsidian" | "notion" | "markdown" | "evernote";

/** What an import would bring in, shown before it runs. */
export interface ImportPreview {
  /** The export's name (folder, or file name without its extension). */
  name: string;
  notes: number;
  attachments: number;
  /** Database tables (Notion CSV). */
  tables: number;
  canvases: number;
  /** What the source looks like when it isn't the kind chosen. */
  looksLike: ImportKind | null;
  warnings: string[];
}

export interface ImportOptions {
  /** Notion databases as Markdown tables instead of grids. */
  tablesAsMarkdown?: boolean;
}

export interface ImportReport {
  /** The new vault folder the files went into. */
  target: string;
  notes: number;
  attachments: number;
  canvases: number;
  tables: number;
  /** Links rewritten to point at the imported notes and files. */
  links: number;
  skipped: { path: string; reason: string }[];
  warnings: string[];
  /** Obsidian settings found (paths inside the vault after import). */
  settings: {
    templatesFolder: string | null;
    dailyFolder: string | null;
    dailyFormat: string | null;
    dailyTemplate: string | null;
  };
}

/** Files written so far during an import. */
export interface ImportProgress {
  done: number;
  total: number;
}

/** Where files from outside were dropped on the window (physical pixels). */
/** What importing dropped or picked files did: each file succeeds or fails on its own. */
export interface Imported {
  /** Vault paths of the files that made it in. */
  paths: string[];
  failed: { name: string; error: string }[];
}

export interface FilesDropped {
  x: number;
  y: number;
  count: number;
}

export interface Backend {
  /** Show a native folder picker; resolves null if cancelled. */
  pickFolder(): Promise<string | null>;
  openVault(path: string): Promise<VaultInfo>;
  createVault(parentDir: string, name: string): Promise<VaultInfo>;
  currentVault(): Promise<VaultInfo | null>;
  listTree(): Promise<VaultEntry>;
  readFile(path: string): Promise<FileContent>;
  /**
   * Rejects with code "Conflict" if the file changed on disk since `expectedModifiedMs`.
   * With `vaultRoot`, writes only if that vault is still the open one (else "Io").
   */
  writeFile(
    path: string,
    content: string,
    expectedModifiedMs?: number,
    vaultRoot?: string,
  ): Promise<WriteResult>;
  /** Rejects with "AlreadyExists" rather than overwrite. `vaultRoot` as for `writeFile`. */
  createFile(path: string, content?: string, vaultRoot?: string): Promise<VaultEntry>;
  createDir(path: string): Promise<VaultEntry>;
  /** Show a native picker for one image file; resolves null if cancelled. */
  pickImage(): Promise<string | null>;
  /**
   * Copy the image at `source` (a path on disk) into the vault folder `folder` under a
   * free name (`photo 1.png` if `photo.png` exists). Images only, up to 25 MB.
   */
  importImage(source: string, folder: string): Promise<VaultEntry>;
  /** Icon and image packs in the vault's hidden `.axisnotes/packs/`, icon packs first. */
  listPacks(): Promise<Pack[]>;
  /** Native picker for a pack: a folder or a `.zip` file. Resolves null if cancelled. */
  pickPackSource(from: "folder" | "zip"): Promise<string | null>;
  /**
   * Copy the images in the folder or `.zip` at `source` into a new pack of `kind`, named
   * after it (`Name 2` if taken). Flattened; an icon pack with SVGs keeps only those.
   * Rejects with "NotFound" when there are no images, "InvalidName" for other files.
   */
  importPack(kind: PackKind, source: string): Promise<Pack>;
  /** Move a pack to the OS trash. */
  removePack(kind: PackKind, name: string): Promise<void>;
  /**
   * Rename or move. Rejects with "AlreadyExists" if `to` exists. Wikilinks to moved notes
   * are rewritten; rewritten notes are announced through `onVaultChanged` as "modified".
   */
  renameEntry(from: string, to: string): Promise<VaultEntry>;
  /** Moves to the OS trash (never a hard delete). */
  trashEntry(path: string): Promise<void>;
  /** Show an entry, selected, in the system file manager ("" opens the vault folder). */
  revealEntry(path: string): Promise<void>;
  /** Subscribe to changes made outside the app. Returns an unsubscribe function. */
  onVaultChanged(cb: (changes: VaultChange[]) => void): Promise<() => void>;
  /** Progress of catching the index up after a vault opens (big vaults open first and are
   * indexed in the background). `finished` comes last. Returns an unsubscribe function. */
  onIndexProgress(cb: (p: IndexProgress) => void): Promise<() => void>;
  /** Zoom the whole app (1 = 100%). */
  setZoom(factor: number): Promise<void>;
  /** Whether the window can be see-through (Translucent theme). Windows only, for now. */
  canBeTranslucent(): boolean;
  /**
   * What Windows draws behind the see-through window; `null` for nothing (clear). Replaces
   * any effect from before.
   */
  setWindowEffect(effect: OsWindowEffect | null): Promise<void>;
  /**
   * The user asked to close the window (close button, Alt+F4, …). While a listener is
   * registered the window stays open; it closes only through `closeWindow`. Returns an
   * unsubscribe function.
   */
  onCloseRequested(cb: () => void): Promise<() => void>;
  /** Close the window (and so the app). */
  closeWindow(): Promise<void>;
  /**
   * Minimize, maximize and close for the app's own title bar: the desktop window has no
   * system frame. Absent in a browser, which has its own.
   */
  windowFrame?: WindowFrame;
  /** Font families installed on this computer, sorted. */
  listFonts(): Promise<string[]>;

  /** Full-text search; see the query language in `src-tauri/src/index/search.rs`. */
  search(query: string, limit?: number): Promise<SearchHit[]>;
  listTags(): Promise<TagCount[]>;
  /** Property names across the vault (frontmatter and inline `key::`), most used first. */
  listPropertyKeys(): Promise<PropertyKey[]>;
  listNotes(): Promise<NoteRef[]>;
  /** Resolve a wikilink target written in note `from` to a note path, or null. */
  resolveLink(target: string, from: string): Promise<string | null>;
  backlinks(path: string): Promise<Backlink[]>;
  unlinkedMentions(path: string): Promise<Mention[]>;
  /** CSS files (names without `.css`) in `.axisnotes/themes` or `.axisnotes/snippets`. */
  listAxisFiles(subdir: "themes" | "snippets"): Promise<string[]>;
  /** All notes and resolved links (plus unresolved targets as `?name` nodes). */
  graph(): Promise<GraphData>;
  /** Every task in the vault, sorted: open first, then due date, priority, path, line. */
  listTasks(): Promise<TaskRef[]>;
  /** Every `time_log` entry in the vault, oldest first. */
  timeEntries(): Promise<TimeEntry[]>;

  aiSettings(): Promise<AiSettingsView>;
  aiSubscriptionSignIn(providerId: string): Promise<void>;
  aiSubscriptionCancel(providerId: string): Promise<void>;
  aiSubscriptionDisconnect(providerId: string): Promise<void>;
  aiSubscriptionUsage(): Promise<void>;
  aiSaveSettings(settings: AiSettings): Promise<AiSettingsView>;
  /** Store a key in the OS keychain (empty = delete). Keys are never read back. */
  aiSetKey(providerId: string, key: string): Promise<void>;
  aiDeleteKey(providerId: string): Promise<void>;
  /** Check endpoint and key; resolves to the number of models offered. */
  aiTestProvider(providerId: string): Promise<number>;
  aiListModels(providerId: string): Promise<AiModelList>;
  /** Where a request would go and its estimated size, before sending. */
  aiPlan(request: AiRunRequest): Promise<AiPlan>;
  /** Run a request, streaming text to `onDelta`. Rejects with "Cancelled" on `aiCancel`. */
  aiRun(
    runId: string,
    request: AiRunRequest,
    onDelta: (text: string) => void,
  ): Promise<AiRunResult>;
  aiCancel(runId: string): Promise<void>;
  /** Recent AI requests (metadata only), newest first. */
  aiLog(limit?: number): Promise<AiLogEntry[]>;

  clipperStatus(): Promise<ClipperStatus>;
  clipperSetEnabled(enabled: boolean): Promise<ClipperStatus>;
  clipperSetFolder(folder: string): Promise<ClipperStatus>;
  /** Show a one-time code the browser extension uses to pair. */
  clipperStartPairing(): Promise<PairingCode>;
  clipperCancelPairing(): Promise<void>;
  clipperRevoke(deviceId: string): Promise<ClipperStatus>;
  /** Opens the bundled browser extension's folder in the file manager; returns its path. */
  clipperOpenExtensionFolder(): Promise<string>;
  /** A clip was saved as a note. Returns an unsubscribe function. */
  onClipped(cb: (clip: Clipped) => void): Promise<() => void>;
  /** A URL the webview can load a vault file from (images, video), or null if not possible. */
  fileUrl(path: string): string | null;
  /**
   * Save pasted media as `dir/name` (or `name 1`, … if taken); returns its vault path.
   * `vaultRoot` as for `writeFile`.
   */
  saveAttachment(dir: string, name: string, bytes: Uint8Array, vaultRoot?: string): Promise<string>;
  /** Import the files just dropped onto the window from outside into `dir` (files already
   *  in the vault are linked where they are). */
  importDropped(dir: string, vaultRoot?: string): Promise<Imported>;
  /** Let the user pick images, video or audio and import them into `dir` (nothing if
   *  they cancel). */
  pickAttachments(dir: string, vaultRoot?: string): Promise<Imported>;
  /** Files from outside were dropped on the window, at `x`, `y` in physical pixels. */
  onFilesDropped(cb: (drop: FilesDropped) => void): Promise<() => void>;

  updatesSettings(): Promise<UpdateSettings>;
  /** An empty `folder` goes back to the default folder. */
  updatesSaveSettings(
    checkOnLaunch: boolean,
    autoInstall: boolean,
    folder: string,
  ): Promise<UpdateSettings>;
  /** A newer version in the updates folder, or null. */
  updatesCheck(): Promise<AvailableUpdate | null>;
  /** Verifies and starts the installer, which closes the app, updates it and reopens it. */
  updatesInstall(version: string): Promise<void>;

  inspectImport(kind: ImportKind, source: string): Promise<ImportPreview>;
  /**
   * Import notes from another app into a new folder named after `target` (made unique if
   * it exists). Nothing in the vault is overwritten.
   */
  importNotes(
    kind: ImportKind,
    source: string,
    target: string,
    options?: ImportOptions,
    onProgress?: (p: ImportProgress) => void,
  ): Promise<ImportReport>;
  /** Show a native file picker for an export file; resolves null if cancelled. */
  pickImportFile(label: string, extensions: string[]): Promise<string | null>;
}

/** Window materials Windows can draw behind a see-through window (Tauri's names). */
export type OsWindowEffect = "blur" | "acrylic" | "mica" | "tabbed";

/** The window's own controls (see `Backend.windowFrame`). */
export interface WindowFrame {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  /** Ask to close, as the system close button would (so `onCloseRequested` runs first). */
  requestClose(): Promise<void>;
  isMaximized(): Promise<boolean>;
  /** Cover the whole screen (Zen mode), or return to the window as it was. */
  setFullscreen(on: boolean): Promise<void>;
  /** Called after each resize, maximize and restore. Returns an unsubscribe function. */
  onResized(cb: () => void): Promise<() => void>;
}
