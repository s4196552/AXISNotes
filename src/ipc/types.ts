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

export interface VaultChange {
  kind: ChangeKind;
  /** For "renamed": [from, to] when both are known. */
  paths: string[];
}

export type ErrorCode =
  "NoVault" | "NotFound" | "AlreadyExists" | "Conflict" | "OutsideVault" | "InvalidName" | "Io";

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
}

export const HL_START = "\u0001";
export const HL_END = "\u0002";

export interface TagCount {
  /** Lowercase, without `#`; nested tags use `/`. */
  tag: string;
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

/** Everything the UI may ask of the backend. UI code depends on this, never on `invoke`. */
export interface Backend {
  /** Show a native folder picker; resolves null if cancelled. */
  pickFolder(): Promise<string | null>;
  openVault(path: string): Promise<VaultInfo>;
  createVault(parentDir: string, name: string): Promise<VaultInfo>;
  currentVault(): Promise<VaultInfo | null>;
  listTree(): Promise<VaultEntry>;
  readFile(path: string): Promise<FileContent>;
  /** Rejects with code "Conflict" if the file changed on disk since `expectedModifiedMs`. */
  writeFile(path: string, content: string, expectedModifiedMs?: number): Promise<WriteResult>;
  createFile(path: string, content?: string): Promise<VaultEntry>;
  createDir(path: string): Promise<VaultEntry>;
  /**
   * Rename or move. Rejects with "AlreadyExists" if `to` exists. Wikilinks to moved notes
   * are rewritten; rewritten notes are announced through `onVaultChanged` as "modified".
   */
  renameEntry(from: string, to: string): Promise<VaultEntry>;
  /** Moves to the OS trash (never a hard delete). */
  trashEntry(path: string): Promise<void>;
  /** Subscribe to changes made outside the app. Returns an unsubscribe function. */
  onVaultChanged(cb: (changes: VaultChange[]) => void): Promise<() => void>;

  /** Full-text search; see the query language in `src-tauri/src/index/search.rs`. */
  search(query: string, limit?: number): Promise<SearchHit[]>;
  listTags(): Promise<TagCount[]>;
  listNotes(): Promise<NoteRef[]>;
  /** Resolve a wikilink target written in note `from` to a note path, or null. */
  resolveLink(target: string, from: string): Promise<string | null>;
  backlinks(path: string): Promise<Backlink[]>;
  unlinkedMentions(path: string): Promise<Mention[]>;
  /** CSS files (names without `.css`) in `.axis/themes` or `.axis/snippets`. */
  listAxisFiles(subdir: "themes" | "snippets"): Promise<string[]>;
  /** All notes and resolved links (plus unresolved targets as `?name` nodes). */
  graph(): Promise<GraphData>;
  /** Every task in the vault, sorted: open first, then due date, priority, path, line. */
  listTasks(): Promise<TaskRef[]>;
  /** Every `time_log` entry in the vault, oldest first. */
  timeEntries(): Promise<TimeEntry[]>;
}
