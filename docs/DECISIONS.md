# Decision Log

Newest first. Each entry: date, decision, why, and (for dependencies) license.

## 2026-09-26: Phase 3 grids, canvases and structured data (T-016 – T-019)

- **Formula engine: our own parser and evaluator plus `@formulajs/formulajs` (MIT) for the function library.** HyperFormula is GPLv3 or commercial, so it is ruled out. The parser is a small Pratt parser with Excel precedence (comparison < `&` < `+ -` < `* /` < `^` < unary/percent, with `^` right-associative). It handles A1 refs with `$`, ranges, dotted function names and bare names (for computed properties). Evaluation uses Excel error values (`#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, `#N/A`, `#NUM!`, `#CIRC!`, `#ERROR!`). `IF` is lazy, and `IFERROR`/`IFNA`/`IS*` are native because formula.js only recognizes its own error objects. Everything else is looked up in formula.js.
- **`.axgrid` format**: `{ version: 1, rows, cols, cells: { "A1": raw }, widths: { "A": px }, formats: { "A1": { bold, align } } }`. `raw` is exactly what the user typed (a formula starts with `=`). Computed values are **never stored**, so the file is the single source of truth. Cells are serialized in row-major order so diffs stay stable. Parsing is lenient, and a file that fails to parse opens **read-only and is never autosaved**, so it can't be clobbered.
- **Recalculation** evaluates the whole sheet each time, with memoization and cycle detection (`#CIRC!`). That is instant at note-sized sheets. A dependency graph can come later if large grids need it.
- **Structural edits shift formulas like Excel**: inserting rows or columns moves the references behind them, and references into a deleted span become `#REF!`. Copy/paste within AXIS carries the raw cells (a custom clipboard type) and offsets relative references, while `$` parts stay put. Everything else is plain TSV (values), for Excel and Sheets interop.
- **Grid UI** is a hand-rolled, row-virtualized DOM grid with sticky headers: no grid dependency, and it follows the app's theme tokens.
  - Keyboard follows Google Sheets: typing replaces the cell, Enter/F2 edit, Enter/Tab commit and move, and arrows commit a quick edit.
  - Undo/redo keeps whole-sheet snapshots (200).
  - Load, autosave and conflict handling are shared with future file-backed views through `useFileDocument`, which uses the same rules as the Markdown editor.
- **Search covers grids**: the Rust index gives `.axgrid` files a row whose FTS body is their non-formula cell text and whose title is the file stem. Grids have no links or tags, can be linked as `[[Budget.axgrid]]`, keep incoming links on rename, and are excluded as unlinked-mention sources.
- **Canvas = Excalidraw (MIT), embedded and lazy-loaded.** `.axcanvas` is Excalidraw's own JSON scene (`type: "excalidraw"`, `version: 2`, `source: "axis"`), so files open in Excalidraw too.
  - Only scene settings are persisted (background color and grid settings). Zoom, scroll and selection stay per-session. Deleted elements and unused image files are dropped on save.
  - Images are embedded as data URLs (Excalidraw's standard). Moving them to vault attachments is a later optimization.
- **Note cards are Excalidraw "embeddable" elements with `link: "axis:<path>"`.** `renderEmbeddable` draws them as live previews that re-read the note when it changes, and `onLinkOpen` opens the note.
  - Add cards from a picker or by dragging a note from the file tree (the tree sets an `application/x-axis-path` drag type).
  - When a note or folder is renamed, the Rust rename rewrites exact `"link": "axis:<old>"` JSON strings in every canvas, leaving the rest of the file byte-for-byte unchanged. Canvas text elements are indexed for search.
- **Pen input and grid snapping come from Excalidraw**: the freedraw tool with pressure, automatic pen mode, and grid mode (Ctrl+'), whose on/off state and size are saved in the file.
- **Offline fonts:** Excalidraw normally fetches fonts from a CDN. A small Vite plugin serves `node_modules/@excalidraw/excalidraw/dist/prod/fonts` at `/excalidraw-assets/fonts/` in dev and copies it into the build. `window.EXCALIDRAW_ASSET_PATH` points there. The fonts add about 14 MB to the installer, most of it the CJK font Xiaolai.
- **Change detection:** Excalidraw's `onChange` also fires for view-only updates, so a change counts only when the scene version, files or saved settings change. The scene is saved only if the serialized result differs from what is on disk, so opening a canvas never rewrites it. An outside edit remounts the editor with the new scene.
- **Tasks use the Obsidian Tasks emoji format.** Due dates are written `📅 YYYY-MM-DD` (the easier-to-type `due:YYYY-MM-DD` also works), and priority is `⏫`/`🔼`/`🔽` (plus `🔺`/`⏬`). Existing Obsidian vaults therefore work as they are, and `/` commands insert the markers.
  - The Rust index keeps a `tasks` table (index schema v2, rebuilt automatically) with the file line, raw line, clean text, done state, due date and priority. Code blocks and frontmatter are skipped.
  - The TS parser in `src/lib/tasks.ts` mirrors it, sharing test cases, for the in-memory backend and for edits.
  - Completing a task stamps `✅ <today>` and reopening removes it, the same convention as the Tasks plugin.
- **Edits from outside the editor go through `editNote`.** If the note is open, the change is applied through CodeMirror, so it autosaves and can be undone. Otherwise the note is read, edited and written back with an mtime check (retried once). Task toggles only edit a line that still matches what was indexed; otherwise the list refreshes instead.
- **Time tracking lives in the note:** `time_log: [{ start, end?, task? }]` in the frontmatter. Stamps are local `YYYY-MM-DDTHH:mm:ss`.
  - Starting a timer writes an entry without `end`, and stopping fills it in. A timer therefore survives restarts: on vault load, the latest open entry is restored. Only one timer runs at a time; starting another stops the first.
  - Timers start from the note header or from a task (the entry gets the task text), and the status bar shows the running clock.
  - The Rust index serves every entry with its note's tags and `project` property (`time_entries`). The report groups by note, tag, project (the `project` property, else the top-level folder) or day, over preset or custom date ranges. Manual entries are added from the report.
- **Computed properties** are frontmatter strings starting with `=`, evaluated with the grid formula engine.
  - Other properties are referenced by name (case-insensitive), lists act as ranges (`=SUM(scores)`), and formulas can use other formulas (`#CIRC!` on cycles).
  - The properties panel has a Formula type that shows the live result. Structured values (maps, lists of maps such as `time_log`) are shown read-only instead of being flattened into text.
  - They are evaluated in the UI only; search operators (`prop:`) still see the raw expression.
- **E2E:** `structured.e2e.ts` runs against the real Tauri build. It covers the Phase 3 acceptance:
  - A grid with formulas saves, and reopening it shows the same values without rewriting the file.
  - A canvas holds a live note card (which follows edits made on disk) and a freehand stroke drawn with pointer actions. This confirms Excalidraw works under the app's CSP with self-hosted fonts.
  - It also covers the tasks view, computed properties and a timer round trip. Screenshots are saved to `.agents/qa/phase-3/`.
- **Fix:** link decorations now use the tree returned by `ensureSyntaxTree`. Before, `syntaxTree(state)` returned whatever was parsed when the state was created, so code and frontmatter detection flaked under load.

| Package                | Version | License | Purpose                          |
| ---------------------- | ------- | ------- | -------------------------------- |
| @formulajs/formulajs   | 4.6     | MIT     | Spreadsheet function library     |
| @excalidraw/excalidraw | 0.18    | MIT     | Canvas / whiteboard (lazy chunk) |

## 2026-09-26: Phase 2 outliner, block references, embeds and graph (T-012 – T-015)

- **Outliner on plain Markdown.** No separate data model: operations work on list items (with nested children) and heading sections found from the text. Tab / Shift-Tab indent under the previous sibling's content column or out to the parent's level (CommonMark-correct for `-` and `1.` lists); Alt+↑/↓ swap with siblings; list items and sections fold. "Outline view" (per-viewer preference) adds a fold gutter and drag handles; a drop re-indents to the target's level.
- **Blocks follow Obsidian:** `^id` at the end of a list item's own line (children included) or a paragraph's last line; an id on its own line refers to the block above. Headings are linked with `#Heading`, not ids. New ids are 6 random base-36 characters. `[[Note#^` completion lists paragraphs and list items and **adds the id to the target note** (fresh read + optimistic write) when missing. `^id` markers are hidden in live preview.
- **Embeds are editable in place.** `![[Note]]`, `![[Note#Heading]]` and `![[Note#^id]]` on their own line render as block widgets containing a mini CodeMirror editor. Saves are debounced (400 ms), and each save **re-reads the source and checks the block text still matches what was loaded**; if not, the embed reloads instead of overwriting. Embeds of the note you're editing are read-only (the outer autosave would otherwise race). Nested editors don't render embeds (no recursion).
- **Live preview shows raw Markdown only on the cursor's lines while the editor has focus**, so unfocused editors (including embeds) render fully.
- **Graph:** built in Rust with in-memory resolution identical to `Index::resolve` (5,000 notes in ~14 ms); unresolved targets become `?name` nodes. Rendered with sigma.js (WebGL) and ForceAtlas2 (synchronous up to 400 nodes, otherwise a web worker for 2.5 s), **lazy-loaded** through `graphLibs.ts` (also the seam tests mock, since jsdom has no WebGL). Hover fades non-neighbors; the open note is emphasized, not isolated. Hover labels use theme colors (sigma's default is a white box). Stale mounts are cancelled before creating a renderer.
- **Test robustness:** Testing Library's async timeout raised to 5 s and Vitest's test timeout to 20 s (busy machines); link decorations force a parse of the visible ranges so code/frontmatter detection doesn't depend on the parser's time budget.
- **E2E:** `blocks.e2e.ts` covers the Phase 2 acceptance (embed a single bullet and edit it in place; the source file changes), block completion, outliner keys, and the graph (clicking a node via the renderer's event, since WebGL nodes aren't DOM elements).

| Package                         | Version | License | Purpose                 |
| ------------------------------- | ------- | ------- | ----------------------- |
| sigma                           | 3.0     | MIT     | Graph rendering (WebGL) |
| graphology (+ graphology-types) | 0.26    | MIT     | Graph data structure    |
| graphology-layout-forceatlas2   | 0.10    | MIT     | Force layout (worker)   |

## 2026-09-26: Phase 1 editor, panels, commands and customization (T-007 – T-011)

- **Frontmatter is parsed as YAML inside the editor** (`@codemirror/lang-yaml`'s `yamlFrontmatter`), so Lezer no longer reads `---` blocks as setext headings. The block is folded behind a "Properties" chip unless the cursor is in it; the **properties panel** edits it with typed controls (text, number, checkbox, date, list). The editor document stays the single source of truth: panel edits become minimal document changes, and **only changed keys are rewritten**, so untouched values keep their YAML formatting (found by E2E: `aliases: [PA]` was being reflowed).
- **Wikilinks in live preview:** brackets and `target|` hidden off the cursor line; unresolved links styled as dashed; click follows (Ctrl/Cmd-click on the line being edited); missing notes are created at the vault root, like Obsidian. Jump targets (`#heading`, `#^block`, line) are **bound to the note they were requested for**, so a stale target can't be consumed by another editor.
- **Search / Tags / Files** share the left sidebar; **calendar + backlinks + unlinked mentions** the right. Panels re-query when the store's `indexVersion` is bumped (after the app's own saves, creates, renames, and watcher events). Linking an unlinked mention re-reads the file and verifies the text at the offsets before writing, with optimistic concurrency.
- **Commands:** one registry drives the palette (Ctrl+P) and global shortcuts (captured before the editor): Ctrl+O switcher, Ctrl+N new note, Ctrl+Shift+D daily note, Ctrl+Shift+F search, Ctrl+Alt+T insert template, Ctrl+, settings.
- **`/` and `:` quick commands** are CodeMirror completion sources configured through a facet; triggers, disabled built-ins and custom snippets live in `.axis/config.json` and update live. Emoji data (emojilib) is **lazy-loaded** (174 kB chunk, not in the startup bundle). The `:` trigger needs two letters, so `10:30` doesn't open it.
- **Templates:** built-ins plus notes in `Templates/`; variables `{{title}} {{date[:fmt]}} {{time[:fmt]}} {{prompt:Q}} {{cursor}}`; inserting merges the template's properties into the note. **Page styles** (`axis-style: lined | dotted | math-grid | cornell`) are CSS backgrounds on a 26 px line grid.
- **Daily notes:** folder, moment-style file-name format, template and open-on-startup are configurable; the calendar marks days with notes.
- **Customization:** theme = system / light / dark / a user theme (`.axis/themes/<name>.css`, overriding the CSS variables); CSS snippets from `.axis/snippets/`. Folder/note icons are a **curated Lucide set** (importing all icons would bloat the bundle) or any emoji, with colors; icon settings follow renames and are removed on trash.
- **`.axis/config.json`** is merged over defaults (wrong-typed values ignored, unknown keys preserved) and saved on every settings change.
- **E2E:** each spec gets a fresh vault seeded by its file name (`vault`, `knowledge`, `perf`). The perf spec generates 5,000 notes. Specs save QA screenshots to `.agents/qa/phase-N/` (gitignored).
- **Measured in the real app (debug build, 5,000 notes):** searches 7–12 ms including IPC; quick-switcher filter ~96 ms including WebDriver typing; vault visible ~2.2 s after launch.

| Package               | Version | License | Purpose                                        |
| --------------------- | ------- | ------- | ---------------------------------------------- |
| @codemirror/lang-yaml | 6.1     | MIT     | Frontmatter parsing in the editor              |
| emojilib              | 4.0     | MIT     | `:` emoji picker and emoji icons (lazy-loaded) |

## 2026-09-26: Phase 1 index and search (T-006)

- **SQLite index in `.axis/index.db`** (rusqlite, bundled SQLite): tables `notes`, `links`, `tags`, `aliases` and an FTS5 table (`title`, `body`; `unicode61 remove_diacritics 2`). It is a cache: a schema-version mismatch or a corrupt file is dropped and rebuilt from the Markdown files. On open it re-indexes only files whose mtime changed.
- **Kept in step** by the commands (the app's own writes, creates, renames, trashes) and by the file watcher (changes from other programs) before the `vault://changed` event is emitted, so the UI always queries fresh data.
- **Link resolution follows Obsidian:** `[[Name]]` matches a note basename anywhere (case-insensitive); path segments narrow it; ties go to the same folder, then the shortest path; aliases (`aliases:` frontmatter) are the fallback. Resolution happens at query time, so creating a note instantly "fixes" dangling links.
- **Renames rewrite incoming links**, preserving `#heading`, `#^block`, `|alias` and `!` embeds, and keeping the author's style (bare name vs. path). Links that still resolve after the move (aliases; bare names after a folder move) are left alone; a path is used when a bare name would become ambiguous. Rewritten notes are announced as `modified` so open editors reload them.
- **Search language:** words (prefix match), `"phrases"`, `-exclude`, `tag:` / `#tag` (nested tags match children), `path:`, `file:`, `prop:key` and `prop:key=value` (works for list values). Ranked by BM25 with titles weighted 8×.
- **Measured (release, 5,000 notes):** queries 0.4–5.7 ms; backlinks 0.25 ms; full initial index 1.1 s.
- Unlinked mentions return UTF-16 offsets so the UI can edit the file with JS string indices.
- `rust-version` raised to 1.85 (from the template's 1.77) so current crates resolve.

| Package                   | Version | License                     | Purpose                                              |
| ------------------------- | ------- | --------------------------- | ---------------------------------------------------- |
| rusqlite (bundled SQLite) | 0.40    | MIT (SQLite: public domain) | Index + FTS5                                         |
| yaml-rust2                | 0.13    | MIT OR Apache-2.0           | Frontmatter in the indexer                           |
| yaml (npm)                | 2.9     | ISC                         | Frontmatter editing in the UI (keeps comments/order) |

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
