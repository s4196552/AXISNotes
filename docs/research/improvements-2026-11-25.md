# Improvement research: every part of AXIS (2026-11-25)

The human asked to "research ways to improve every aspect about this project". Three read-only audits ran on `main` at 0.3.111:

- code health and performance
- product against `AXIS_BUILD_PROMPT.md`, the suite plan and `docs/research/suite-landscape-2026-09-30.md`
- security, CI, release and process

Line numbers are as of that commit. Sizes: S is under half a day, M is 1–3 days, L is more than that.

The approved plan sorts the findings into four waves. Wave 1 tasks: T-278 (config safety), T-279/T-280 (index performance), T-281 (local-AI check), T-282 (signed updates), T-283 (repo hygiene) and T-284 (tests).

## Summary

- **Done:** Notes phases 0–6 are nearly complete. Import, AI privacy (fail-closed, per-folder model allowlists), diagrams, templates, outliner and graph filters all work.
- **Safety:**
  - Updates are unsigned and auto-install.
  - A broken `config.json` used to be replaced by defaults, dropping the AI privacy rules (fixed in T-278).
  - The "local only" AI check could be bypassed with crafted URLs.
  - Releases are built locally without CI; `main` is 48 commits ahead of `origin`, and only v0.3.0 and v0.3.1 are tagged.
- **Speed:** every 500 ms autosave reloads the graph, backlinks (including reading files for unlinked mentions), search, tags, outline, dashboard and canvas cards. 45 of 75 Tauri commands run on the UI thread, and a single SQLite connection behind one mutex serializes everything.
- **Product gaps:**
  - Study progress isn't kept (no spaced repetition).
  - No version history or backups, and no export (PDF/HTML/print).
  - Accessibility: dialogs lack `aria-modal`, focus trap and focus return; reduced motion is overridden in places.
  - Tasks lack recurrence and start/scheduled dates.
  - Spellcheck is English (US) only.
  - Undo history is lost when switching tabs.
  - Of the suite (Hub projects, Connect, Deck, Calendar, mobile/web), only the Hub launcher is built; the suite baseline branches (T-042, T-043, T-060–T-063) are unmerged.
- **Process:**
  - 161 worktrees take about 142 GB under `.worktrees` alone; 145 are merged and clean.
  - 257 agent branches; 11 unmerged ones have no row on the task board.
  - Lint hung in the primary checkout because `.worktrees` wasn't ignored.
  - `.claude/launch.json` has gone stale; TASKS.md is 86 KB.
  - Since T-067, about 20 tasks went to appearance work and none to backups, export or accessibility.

## Security, release and data safety

| #   | Sev     | Finding                                                                                                                                                                                        | Evidence                                                                                                   | Fix                                                                                                                                                      |
| --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | High    | Updates are trusted by a SHA-256 stored in the same folder as the installer, are unsigned, and auto-install by default. Anything that can write the folder gets code execution.                | `src-tauri/src/updates.rs:1-13,38-45,189-215`; `updates_commands.rs:133-139`; `scripts/publish-update.ps1` | Sign the manifest (ed25519) and verify it against a key in the app; auto-install only verified manifests; Authenticode once a certificate exists (T-282) |
| 2   | High    | A broken `config.json` was replaced by the defaults, erasing the AI privacy rules                                                                                                              | `src/app/config.ts` `load`/`update`                                                                        | Done in T-278                                                                                                                                            |
| 3   | High    | Releases are built from the working tree with no checks or tags, and are never pushed                                                                                                          | `publish-update.ps1`; `git rev-list origin/main..main` = 48                                                | The script refuses a dirty tree or a branch other than `main`, runs checks and tags (T-282); push when the human approves                                |
| 4   | Med     | `is_local_url` uses string checks, so `127.0.0.1.evil.com`, `evil.com#.localhost` and `localhost@evil.com` count as local. `http://` is accepted for remote hosts, and redirects are followed. | `src-tauri/src/ai/mod.rs:86-104`; `ai/settings.rs:70-91`                                                   | Parse with `url::Url`, allow loopback only, no redirects, https for remote hosts (T-281)                                                                 |
| 5   | Med     | The webview can open any folder as a vault, import from any path and launch any `.exe` through Hub                                                                                             | `commands.rs:385-391,568-615,936-990`; `hub/platform/windows.rs:185-203`                                   | Accept paths only from a dialog or drop token; drop old vaults from the asset scope; confirm the first launch of a new program                           |
| 6   | Med     | A case-only rename can overwrite a different file on case-sensitive file systems; there is a race between the check and the rename                                                             | `vault/mod.rs:418-426`                                                                                     | Compare file identity; rename without replacing                                                                                                          |
| 7   | Med     | Saves skip `fsync`, use a fixed temp name shared with the MCP process, and detect conflicts by mtime only                                                                                      | `vault/mod.rs:330-378`; `mcp/tools.rs:447-450`                                                             | `sync_all`, unique temp files, conflict token of mtime + size or a hash                                                                                  |
| 8   | Med     | CI lacks cargo-deny/audit, pnpm audit, Dependabot, `permissions:` blocks, pinned actions and tests before `release.yml`. Linux native E2E is red (36 failing).                                 | `.github/workflows/*`                                                                                      | Add each (S); fix or quarantine Linux E2E (T-061 is unmerged)                                                                                            |
| 9   | Med     | Updates can't be rolled back; the updates folder holds about 114 installers (2.4 GB)                                                                                                           | `updates.rs:118-120`                                                                                       | Keep the last N installers (T-282); allow a signed downgrade                                                                                             |
| 10  | Low-Med | The web clipper listens on every install, even without the extension; `/v1/status` answers without a token                                                                                     | `clipper/mod.rs:55-63,276-285`                                                                             | Start it after the first pairing; add request timeouts                                                                                                   |
| 11  | Low-Med | Remote images in notes load automatically (tracking pixels); the CSP has no `base-uri`/`form-action`                                                                                           | `tauri.conf.json:29`; `editor/embeds.ts:537-540`                                                           | Click to load; tighten the CSP                                                                                                                           |
| 12  | Low     | AI privacy relies on the UI sending `sources` for note text it puts in messages                                                                                                                | `ai/service.rs:30-36,609-641`                                                                              | Move callers to `attach`/`passages`; add a test that every caller does                                                                                   |
| 13  | Low     | Test hooks (`AXIS_OPEN_VAULT`, `AXIS_CONFIG_DIR`) work in release builds                                                                                                                       | `lib.rs:24,53-58`                                                                                          | `#[cfg(debug_assertions)]`                                                                                                                               |

Checked and sound:

- the page sandbox and postMessage source checks
- `isHexColor`
- zip import limits
- MCP access checks
- keychain use and PKCE sign-in
- no secrets in the repo

## Code health and performance

| #   | Finding                                                                                        | Evidence                                                                                                                    | Fix                                                                                                        | Size |
| --- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---- |
| 1   | Every autosave reloads every panel through `indexVersion`                                      | `Editor.tsx:289`; `useFileDocument.ts:106`; `store.ts:289-295`; GraphView, BacklinksPanel, SearchPanel, Dashboard, NoteCard | `write_file` reports whether the note's structure changed; separate structure and content versions (T-279) | M    |
| 2   | 45 of 75 commands block the UI thread                                                          | `commands.rs`                                                                                                               | async + `spawn_blocking` (T-280)                                                                           | M    |
| 3   | One SQLite connection behind one mutex; the lock is held during file I/O                       | `commands.rs:58,101-126,644,898-904`                                                                                        | A pool of read connections; release the lock before reading files                                          | M    |
| 4   | Any folder change re-syncs the whole vault                                                     | `index/mod.rs:304-308`                                                                                                      | `sync_subtree` (T-280)                                                                                     | S/M  |
| 5   | Any outside change re-lists the whole tree and re-renders every row                            | `App.tsx:176-182`; `vault/mod.rs:251-308`; `FileTree.tsx`                                                                   | Patch from the change list; keep unchanged objects; virtualize                                             | M    |
| 6   | The graph is rebuilt on every call                                                             | `index/graph.rs:84`                                                                                                         | Cache it, or add a `local_graph` command                                                                   | S/M  |
| 7   | Settings were written on every slider tick, and failures were lost                             | `config.ts`                                                                                                                 | Done in T-278                                                                                              | S    |
| 8   | The production bundle ships the demo backend                                                   | `src/ipc/index.ts:1-19`                                                                                                     | Load it dynamically outside Tauri                                                                          | S    |
| 9   | The startup chunk includes AgentBridge and CodeMirror on the welcome screen                    | `App.tsx:2,207-214`; no chunk config in `vite.config.ts`                                                                    | Lazy-load AgentBridge and the vault shell; add chunk rules                                                 | S/M  |
| 10  | The App root re-renders on index progress and any appearance change                            | `App.tsx:43-58,124-142`                                                                                                     | Split out StatusBar and appearance effects; select fields                                                  | S    |
| 11  | Two copies of the save/conflict pipeline                                                       | `Editor.tsx:264-325`; `useFileDocument.ts:83-128`                                                                           | One `DocumentSaver`                                                                                        | M    |
| 12  | Panel errors are swallowed (`() => {}`)                                                        | GraphView, BacklinksPanel, TagsPanel, OutlinePanel, `store.ts`                                                              | A shared `reportError`; a Rust `index-error` event                                                         | S    |
| 13  | The IPC contract is kept by hand in four places; TS and Rust parsers are mirrored              | `ipc/types.ts:468`; `memoryBackend.ts`; `lib/tasks.ts` and `index/tasks.rs`                                                 | tauri-specta; shared golden fixtures                                                                       | L    |
| 14  | Settings search scrapes the DOM; 20 sections are imported eagerly; `Settings.tsx` is 946 lines | `Settings.tsx:49-70,379-424`                                                                                                | `settings/sections/*`, search keywords as data, lazy sections                                              | M    |
| 15  | Very large components; FileTree re-renders on every pointer move while dragging                | `FileTree.tsx:142-1238,173-179`; `Dashboard.tsx` (1209 lines)                                                               | Split into hooks and components; keep the pointer in a ref                                                 | M/L  |
| 16  | Search fetches each hit's whole body; match offsets are wrong for non-ASCII text               | `search.rs:68-76,~208`                                                                                                      | Stored offsets or FTS5 offsets                                                                             | S    |
| 17  | Watcher dedupe is O(n²); each editor and card adds its own listener                            | `vault/watcher.rs:184-188`                                                                                                  | HashSet (T-280); one dispatcher                                                                            | S    |
| 18  | Tests: 37 files don't need jsdom; formulajs loads in every file; real sleeps                   | `vite.config.ts:58`; `src/test/setup.ts:23`; `FileTree.test.tsx:127`                                                        | Vitest projects, local `loadFunctions`, fake timers (T-284)                                                | S/M  |
| 19  | 13 lint warnings: all `react-refresh/only-export-components`                                   | studyBlocks, Ribbon, NoteAiAccess, PageEmbed                                                                                | Move helpers into `.ts` files (T-284)                                                                      | S    |
| 20  | 44 `lock().unwrap()` in Rust: one panic poisons a lock for every later command                 | `src-tauri/src`                                                                                                             | Recover from poisoned locks the way `replace_index` does                                                   | S    |

## Product

How the spec's acceptance criteria hold up:

- Search under 100 ms is only measured at 5k notes (`e2e/specs/perf.e2e.ts:41`), not the 10k in the spec.
- Installers are unsigned, and the updater is Windows-only.
- Handwriting loses its uncertain-word flags once the text is inserted.
- Time entries can't be edited.
- Computed properties have no query views.
- The grid's formats are only bold and alignment.

Ranked improvements:

1. Spaced repetition you can keep: FSRS (ts-fsrs, MIT) and a review queue for flashcard blocks and skills (L).
2. Version history and backups: snapshots in `.axisnotes/history`, restore, scheduled backups (M).
3. An accessibility baseline: a shared dialog with `aria-modal`, focus trap and focus return; respect reduced motion; `forced-colors`; contrast checks in every color picker; keyboard graph navigation; jsx-a11y and axe in CI (M).
4. Query and database views over frontmatter, with computed properties indexed (`index/parse.rs:55`) (M–L).
5. A PDF reader with highlights linked to notes (L).
6. Suite S2: durable note IDs, Connect projects, Hub AXIS-resource targets. Decide what happens to the unmerged suite branches first (L).
7. A first non-desktop client. The browser build today is an in-memory demo (L).
8. Local semantic search for Ask-vault, filtered by privacy rules (M–L).
9. Keep undo history across tab switches (`Editor.tsx:121`) (S).
10. Tasks: recurrence, start and scheduled dates (`tasks.rs:95-96`), a date picker (M).
11. Honest AI routing: detect localhost forwarders to the cloud; grey out models a folder doesn't allow; a spend summary (S–M).
12. Canvas note cards create backlinks (`parse.rs:64-81`); canvas images become attachments (S–M).
13. Export to PDF, HTML and print (M).
14. Spellcheck in more languages (S–M).
15. Search: a 10k benchmark, date and task operators, saved searches, hover previews, vault-wide replace (M).
16. Merge the T-062 feature modules (M).
17. Signed releases, a cross-platform updater, a store-listed clipper extension (M; needs accounts).
18. Grid: number formats, sort and filter, charts, click-to-reference (M).
19. Edit time entries; split entries at midnight (S).
20. Small follow-ups:
    - comprehension levels survive renames
    - links inside study blocks are indexed
    - the handwriting eraser
    - mid-sentence embeds
    - per-folder default templates

## Process

- Run `scripts/agents/prune-worktrees.ps1` to see which merged worktrees and branches can go; `-Apply` removes only merged ones with no local changes (T-283).
- Regenerate `.claude/launch.json` with `scripts/agents/launch-config.ps1` (T-283).
- Archive merged rows from `.agents/TASKS.md`, and keep rows short with the detail in briefs.
- Push `main` and the release tags to `origin` so CI builds what ships.
- Add the 11 unmerged branches with no board row to the board, or close them: T-042, T-043, T-060–T-063, T-202, T-215, T-220, T-228, T-229.
