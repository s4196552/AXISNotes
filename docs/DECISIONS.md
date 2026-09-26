# Decision Log

Newest first. Each entry: date, decision, why, and (for dependencies) license.

## 2026-09-26: Phase 0 integration and E2E (T-005)

- **E2E tests drive the real desktop build** through `tauri-driver` + WebdriverIO (`pnpm e2e:build && pnpm e2e`) against a throwaway vault on disk. Windows needs `msedgedriver` matching the installed WebView2 (put it in `~/.axis-e2e/msedgedriver-<version>/` or set `AXIS_MSEDGEDRIVER`); Linux CI uses `webkit2gtk-driver` under Xvfb. `tauri-driver` has no macOS support.
- **`AXIS_OPEN_VAULT=<folder>`** opens that folder as the vault at startup. Added because WebDriver can't operate the native folder picker; also handy for scripting.
- **Watcher: self-write suppression is mtime-based for file writes.** After our own write, events for that file are ignored only while its mtime is still the one we produced. Before, any event within 2 s of our save was dropped, so an edit by another program right after an autosave was silently missed (found by E2E).
- **Watcher: renames and removes are classified by outcome.** A rename _onto_ a path, and a "remove" of a path that exists again when the debounced batch is processed, are reported as `modified`. Windows reports an atomic replace (temp file renamed over the note � how VS Code, Vim and AXIS itself save) as remove + create. Before, this showed a false "moved or deleted" banner. Only a rename between two visible paths is `renamed` `[from, to]`, and the editor only treats it as a move when this note is `from`.
- WebdriverIO packages (`@wdio/cli`, `local-runner`, `mocha-framework`, `spec-reporter`, `globals`, `webdriverio` 9.32): **MIT**. Their optional install scripts (browser-driver downloads) are left disabled by pnpm; they aren't needed.
- Measured: typing in a 1 MB note costs ~14 ms per keystroke including WebDriver overhead.

## 2026-09-26: Phase 0 foundation (T-001)

### Architecture

- **The UI depends on a `Backend` interface (`src/ipc/types.ts`), not on `invoke`.** There are two implementations: `tauriBackend` (the Rust core) and `memoryBackend` (in memory, with the same behavior). Why: UI features can be unit-tested without Tauri, the app runs in a plain browser (`pnpm dev`) with a demo vault, and there is a single documented contract between the Codex- and Claude-owned code.
- **All IPC paths are vault-relative with forward slashes.** The Rust core resolves them, and rejects `..`, absolute paths and the vault root. Why: the frontend can never touch files outside the vault.
- **Writes are atomic** (temp file `.<name>.axis-tmp` + rename). They have **optimistic concurrency**: `writeFile(path, content, expectedModifiedMs)` returns `Conflict` if the file changed on disk since it was loaded. Why: a crash mid-save can't corrupt a note, and edits made outside the app are never silently overwritten.
- **Deletes go to the OS trash** (`trash` crate), never a hard delete.
- **Watcher**: `notify` + `notify-debouncer-full` (250 ms). It emits `vault://changed` with `{ changes: [{ kind, paths }] }`. The app's own writes are suppressed for 2 s via `SelfWrites`. Dot-paths (`.axis`, `.git`) and temp files are ignored.
- **Hidden entries**: names starting with `.` are left out of the tree.
- **Line endings**: `.gitattributes` forces LF (and CRLF for `.ps1`), so both agents' worktrees produce identical diffs.

### Tooling

- **TypeScript is pinned to 6.x**, not 7.0: typescript-eslint 8.70 refuses to run on TS 7.0. Revisit once typescript-eslint supports TS ≥ 7.
- pnpm 12, Vite 8, Vitest 5 (jsdom), ESLint 10 (flat config), Prettier 3.
- CI runs on Windows, Linux and macOS: typecheck, lint, format, unit tests, web build, `cargo fmt --check`, clippy `-D warnings` and `cargo test`.

### Dependencies (all permissive)

| Package                                        | Version    | License                  | Purpose                                 |
| ---------------------------------------------- | ---------- | ------------------------ | --------------------------------------- |
| react / react-dom                              | 19.3       | MIT                      | UI                                      |
| zustand                                        | 5.0        | MIT                      | UI state                                |
| lucide-react                                   | 1.48       | ISC                      | Icons                                   |
| @codemirror/* , @lezer/highlight               | 6.x / 1.2  | MIT                      | Markdown editor (used by T-004)         |
| @tauri-apps/api, plugin-dialog                 | 2.11 / 2.7 | MIT OR Apache-2.0        | IPC, native folder picker               |
| tauri, tauri-build, tauri-plugin-dialog (Rust) | 2.11       | MIT OR Apache-2.0        | Desktop shell                           |
| notify                                         | 8.2        | CC0-1.0                  | File watching                           |
| notify-debouncer-full                          | 0.6        | MIT OR Apache-2.0        | Event debouncing                        |
| trash                                          | 5.2        | MIT                      | Move to OS trash                        |
| thiserror                                      | 2.0        | MIT OR Apache-2.0        | Error types                             |
| dunce                                          | 1.0        | CC0 / MIT-0 / Apache-2.0 | Windows paths without the `\\?\` prefix |
| serde / serde_json                             | 1.0        | MIT OR Apache-2.0        | Serialization                           |
| tempfile (dev)                                 | 3.27       | MIT OR Apache-2.0        | Rust tests                              |
| vite, vitest, jsdom, @testing-library/*        | latest     | MIT                      | Build and tests                         |
| eslint, typescript-eslint, prettier            | latest     | MIT                      | Lint and format                         |
| typescript                                     | 6.0        | Apache-2.0               | Types                                   |
