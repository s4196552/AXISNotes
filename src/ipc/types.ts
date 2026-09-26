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
  /** Rename or move. Rejects with "AlreadyExists" if `to` exists. */
  renameEntry(from: string, to: string): Promise<VaultEntry>;
  /** Moves to the OS trash (never a hard delete). */
  trashEntry(path: string): Promise<void>;
  /** Subscribe to changes made outside the app. Returns an unsubscribe function. */
  onVaultChanged(cb: (changes: VaultChange[]) => void): Promise<() => void>;
}
