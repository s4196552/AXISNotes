# Decision Log

Newest first. Each entry: date, decision, why, and (for dependencies) license.

## 2026-09-30: S2 foundation decisions (T-043; lead proposal, awaiting Codex review)

Details and rationale: [S2_FOUNDATION.md](S2_FOUNDATION.md) (IDs S2-D01 – S2-D43). Protocol
changes are in the "v1 refinements" section of [SUITE_PROTOCOL.md](SUITE_PROTOCOL.md). None
of this is implemented yet, and no dependency is added by this entry.

- **Threat model:** S2 defends against web content, other OS users, stale or impostor
  services, confused deputies, replay and fail-open AI. Same-user native malware is explicitly
  out of scope, and the UI and release notes say so.
- **Repositories:** Notes stays at `A:/M. PROJECTS/AXIS`. The new local sibling repositories
  are `AXIS-Protocol` and `AXIS-Connect` (T-044), then `AXIS-Hub` (T-047), and later
  `AXIS-Deck` and `AXIS-Calendar`. Athena and ULAP are unchanged. Each repository has one task,
  one branch and one worktree per task (`../axis-<repo>-T-###`). No remotes are published
  without a later human instruction, and until then no hosted CI is claimed for them.
- **Versions:** each app has its own semver. The wire version is `protocolVersion: 1` under
  `/axis/v1`. The Protocol crate has its own semver, tagged `protocol-v1.0.0`, and is vendored
  into consumers with its source tag, commit SHA and tree hash recorded. TypeScript, Rust and
  later Python run the same JSON vectors.
- **Connect:** a headless per-user Rust binary with no admin rights, service or autostart. It
  keeps a single-instance lock file, binds an ephemeral port on `127.0.0.1`, writes an atomic
  readiness manifest, and exits after 10 idle minutes with no leases. Leases are 30 s with a
  10 s heartbeat. Candidate crates are families already vetted in this log (tiny_http,
  reqwest/rustls, serde, ring, rusqlite, keyring). T-044 records exact versions and licenses in
  its own repository's log, verified from `cargo metadata` and the crate sources.
- **Authentication:** every request and every response to an authenticated request is
  HMAC-SHA256 signed, including bootstrap status/pair responses and a pending client's status
  responses; pending clients are denied everywhere else. HMAC gives
  authenticity, not confidentiality, and loopback bodies are plaintext. Per-client secrets are
  derived from a keychain master key and a generation counter, so revocation is instant. They
  cross the wire only once, AEAD-sealed under a key derived from the bootstrap key in the
  pairing response, with no forward secrecy. Pairing is native-only, through a user-profile
  bootstrap key. The bootstrap key also signs a liveness probe, so launchers tell a dead
  service from an invalid credential and never spawn a second Connect for the latter. Revoked
  installations re-pair only by explicit user action, and restore keeps revocations.
  Capabilities come from a fixed table per app. Adapters authorize mutations per
  originating app. A registration endpoint must be `http://127.0.0.1:<port>` and must pass a
  signed challenge. Any Origin, Referer or Sec-Fetch header, an OPTIONS request or a wrong
  Host is refused before authentication.
- **Connect storage:** authoritative SQLite in the user's local app data. Project revisions,
  insert-only caller-issued IDs, per-caller idempotency records (kept 30 days or more),
  tombstones and a change feed are written in one transaction per mutation. Backups use the
  SQLite online backup API (14 kept), plus JSON export and restore. Restore rotates all
  credentials. Deleting a project never touches app content.
- **Search:** fan-out with a 1.5 s timeout per adapter and a 2.5 s overall deadline. v1
  returns one array of groups with explicit unavailable and unsupported states. For project
  search, owners receive member filters, never a bare `projectId`.
- **Notes identity:** lives in `.axisnotes/suite/` and is authoritative, a documented exception
  to "`.axisnotes/` is rebuildable". It is kept out of `index.db`, is written only by native
  code, and is refused by generic file commands. IDs are minted lazily, and no Markdown file
  is rewritten for identity. Renames use a journal. Unknown changes resolve as missing with
  explicit relink candidates. Offline content changes keep an ID only on recorded continuity
  evidence (an unchanged hash, a surviving block ID, or line-sketch similarity of at least
  0.5); otherwise the entry becomes ambiguous for the user to decide. Copied vaults and duplicated block IDs resolve as ambiguous.
  Task anchors reuse or add standard `^blockId` markers, only through an explicit command
  with a revision check.
- **Notes AI policy:** in `.axisnotes/ai-policy.json`, written natively. Parsing is strict,
  inheritance is intersection, and widening needs explicit confirmation. Legacy `ai.folders`
  is kept, never rewritten by migration, and intersected. It is native-owned: generic config
  writes preserve it, and changes go through a native command that confirms widening.
  Applying AI output records persistent per-resource provenance first, and later checks
  intersect each source's current policy. Every recorded source keeps its identity: an apply
  that would exceed 256 unique sources for a destination is refused with no change, and
  provenance is never compacted. Legacy `local` means verified on-device. Invalid
  or unreadable config now denies instead of failing open. `endpointId` is derived from the
  normalised base URL. On-device requires runner-probe evidence; unknown loopback gateways are
  denied. Checks run at plan, before each dispatch or fallback, and before apply.
- **Notes UI contract:** additive native commands and events for policy, candidates, status
  and project badges. The memory backend reports `enforcement: "demo"`, and the UI must label
  it. T-046 is gated on T-045.
- **Hub:** Tauri 2 with no HTTP server. Portable library data is kept separate from
  device-local mappings and sessions. Launches go by item ID only, using argument arrays; only
  `.exe` applications are allowed, script hosts are refused, and URI schemes need an allowlist
  plus a denylist. Website sessions use per-session WebView2 data directories, and remote
  webviews have no capabilities. Open in browser is always available. Browser profiles use
  argument templates. AI is optional and OpenAI-compatible only in S2, returns validated
  suggestions only, and never produces targets.
- **Rejected:** Windows named pipes (the approved design is loopback HTTP, and it is simpler
  for the Python adapters in S3); bearer tokens on the wire; embedding IDs in Markdown
  frontmatter; treating the rebuildable index as identity; fixed ports; a Windows service.

## 2026-09-30: AXIS suite baseline (T-042; proposed for lead review)

- AXIS becomes six independent applications connected by optional AXIS Connect. Preserve
  AXISNotes identifiers, Rust core, file formats, settings and existing axis: canvas links;
  preserve Athena's Python engine and ULAP's Python/Tauri service in their own repositories.
- [SUITE.md](SUITE.md), [SUITE_PROTOCOL.md](SUITE_PROTOCOL.md) and
  [SUITE_ROADMAP.md](SUITE_ROADMAP.md) govern new suite scope; historical Notes phases remain.
- Owners alone write content. Connect owns coordination metadata. Stable resource IDs and
  authoritative identity/provenance are independent of disposable indexes and source paths.
- Every product targets desktop/mobile/web, optional BYOK and on-device AI. Local integration
  precedes selective sync; no production web/mobile client is implied by a memory demo.
- Exact provider/endpoint/model access is source-specific and intersected across provenance.
  Fail closed on invalid/unreadable policies; a localhost gateway is not proof of on-device AI.
  T-042 adds a tested reference evaluator; actual Notes runtime enforcement is T-045.
- Hub supports nested mixed launch sections, isolated website sessions and configured external
  browser profiles. Remote webviews get no privileged capabilities or Connect credentials.
- Deck owns spaced repetition and review history; Calendar owns study time allocations.
  FSRS implementation/version/license selection remains T-053, not a new baseline dependency.
- The latest human-supplied AGENTS.md agreement restores Codex building/review and other-model
  approval before merges. Older entries about dropping Codex describe historical work only.
- No package, storage migration, account, hosted service or new library dependency is added.

## 2026-09-28: Zoom, text size, fonts and editor width (T-040)

- **Zoom for the whole app:**
  - Ctrl + = / Ctrl + − / Ctrl + 0 are "Zoom in", "Zoom out" and "Reset zoom" in the command list, so they can be remapped.
  - Ctrl + mouse wheel and the number-pad + also zoom, and so do the controls in Settings → Appearance.
  - Steps run from 50 % to 300 %.
  - The desktop app zooms the webview itself (`setZoom`, with the `core:webview:allow-set-webview-zoom` permission), so pointer positions on the canvas stay right. The browser preview uses CSS `zoom`.
  - Zoom is a per-device preference, kept in local storage (`axisnotes.zoom`).
  - Inside the canvas and the graph, which have their own zoom, the keys and wheel are left to them.
  - On the welcome screen, where command shortcuts aren't active, `installZoom` handles Ctrl + = / − / 0 itself (T-041).
- **Settings → Appearance** also has these, saved in the vault's config as `appearance: { noteFontSize, noteFont, uiFont, editorWidth }` and applied as CSS variables (`--note-font-size`, `--font-note`, `--font-ui`, `--editor-width`):
  - **Note text size:** 11–32 px, default 15. Headings grow with it.
  - **Note font** and **interface font:** any installed family, or the default. A font chosen on another computer stays selected, marked "(not installed)".
  - **Editor width:** narrow 640 px, medium 760 px (the default), wide 960 px, or full width.
- **Installed fonts** come from the `list_fonts` command, which uses `fontdb` to read the system font folders once and caches the result (0.14 s here). `fontdb` is pure Rust with no system libraries.
- The 5,000-note speed test now waits for background indexing (T-039) to finish before timing searches (6–51 ms). The 100 ms target applies to an indexed vault.

| Package (Rust) | Version | License                                                                              | Purpose                     |
| -------------- | ------- | ------------------------------------------------------------------------------------ | --------------------------- |
| fontdb         | 0.24    | MIT                                                                                  | Installed font families     |
| memmap2        | 0.9     | MIT OR Apache-2.0                                                                    | (fontdb) reading font files |
| slotmap        | 1.1     | **Zlib**, flagged: permissive, no copyleft; attribution in source distributions only | (fontdb) face storage       |
| tinyvec        | 1.13    | Zlib OR Apache-2.0 OR MIT                                                            | (fontdb) small vectors      |

## 2026-09-28: Big and messy folders open reliably (T-039)

- **The bug:** large real-world folders failed to open or froze the app. Reproduced with 20,000 notes, 40,000 files in `node_modules`, a 50 MB binary, a looping folder link, a broken folder link and a locked folder:
  - **One unreadable item failed the whole vault.** A broken link or a folder without permission made listing the tree fail with "cannot find the file specified".
  - **A folder link back up the tree looped** until the path grew too long, so opening hung for minutes.
  - **Opening waited for the index**, 24 s for 20,000 new notes, with nothing on screen.
- **Walking a vault (`vault::Walk`)**, shared by the file tree and the indexer:
  - It never fails: unreadable folders show as empty, and broken or unreadable items are skipped.
  - Folder links (Windows junctions, symlinks) are followed, so a vault can link to a shared folder elsewhere. A link is skipped when it points at a folder the walk is already inside (a loop) or at a target already followed through another link.
  - Only links are resolved to their real location, because resolving every folder cost seconds on Windows.
- **Opening no longer waits for the index:**
  - `Index::open_unsynced` opens the database at once, and a background thread with its own connection runs `sync_with_progress`, committing every 500 notes.
  - The database uses WAL with a 10 s busy timeout, so searches keep working meanwhile.
  - Progress goes out on `index://progress` and shows in the status bar ("Indexing notes… 4,000 of 20,000"). The note list refreshes when it finishes.
  - Opening another vault stops the old sync (a generation counter).
- **Measured on the test folder** (release build):
  - Tree: 0.31 s (6.4 MB).
  - First full index: 5.6 s, in the background.
  - Reopen with nothing changed: 0.3 s.
  - Previously: the tree failed, the index took 24 s in the foreground, and the loop hung.
- **Still open:**
  - Every external change reloads the whole tree (0.3 s at this size).
  - A single expanded folder with tens of thousands of files renders every row (the tree isn't virtualized).

## 2026-09-27: Renamed to AXISNotes (T-038)

- **Naming:** AXIS is the company, and this app is its product **AXISNotes**, written as one word with no space, like Microsoft and Microsoft Word.
  - User-facing text says AXISNotes: the window title, installer, Start menu, welcome screen, About ("AXISNotes by AXIS"), the extension (the "AXISNotes Web Clipper") and error messages.
  - The installer publisher is AXIS.
- **Internal names changed too, at the user's request, each with a migration so nothing is lost:**
  - **Bundle identifier:** `app.axis.desktop` → `app.axis.axisnotes`. The OS folders named after it hold AI settings, paired browsers, the request log and the webview's storage (recent vaults). `migrate::legacy_app_dirs` copies each old folder to its new name on startup, before any window opens, and only when the new folder doesn't exist yet. The old folders stay behind as a backup.
  - **Vault folder:** `.axis/` → `.axisnotes/`. `Vault::open` renames an existing `.axis/` when there's no `.axisnotes/` yet. Temporary files are now `.axisnotes-tmp`.
  - **Keychain service:** `AXIS` → `AXISNotes`. A key missing under the new name is looked up under the old one, moved across and deleted from the old entry. Deleting a key removes both.
  - **Program:** `axis.exe` → `axisnotes.exe` (the Cargo package `axisnotes`, library `axisnotes_lib`). The npm package is `axisnotes`.
- **Not renamed:**
  - The `.axgrid` and `.axcanvas` file extensions and the `axis:` link scheme inside canvas files. They're content formats in users' files, and "ax" works as the AXIS family prefix.
  - The test-only environment variables (`AXIS_OPEN_VAULT`, `AXIS_CLIPPER_PORT`, …) and the `axis.*` local-storage keys, which users never see.
- The build spec and older entries below still say "AXIS" and `.axis/`, which were correct when they were written.

## 2026-09-27: Phase 6 web clipper, import, polish and installers (T-030 – T-036)

- **Process change:** the user dropped Codex. Claude builds and verifies every task, and the cross-review rule in `AGENTS.md` no longer applies.

### Web clipper endpoint (T-030)

- **A tiny HTTP server on `127.0.0.1:38417`** (`tiny_http`, in its own thread), started with the app and switchable off in Settings → Web clipper. It is localhost only and never reachable from the network. `AXIS_CLIPPER_PORT` overrides the port (E2E).
- **Pairing, not open access:**
  - The app shows a 6-digit code. It is valid for 5 minutes and dies after 5 wrong tries.
  - The extension trades the code for a 256-bit random token.
  - Only the token's SHA-256 is stored, in `clipper.json` in the app config folder (not the vault).
  - Paired browsers are listed and can be revoked.
- **Web pages are refused:** any request with an `http(s)://` (or `null`) `Origin` gets a 403. Websites therefore can't pair or clip even though the endpoint is on localhost. The extension's requests carry an extension origin.
- **Clips become notes** in `Clippings/` (configurable):
  - Frontmatter: `source`, `clipped` (UTC), `clip` kind, `tags: [clipping, …]`.
  - Pages carry the extension's Markdown, selections become a blockquote with a link, links are a single Markdown link.
  - Screenshots go to `Clippings/attachments/*.png`, embedded with `![[…]]`.
  - Titles become safe file names, and a clash gets " 2", " 3" and so on.
  - A clip `id` is remembered (the last 500), so a retried delivery from the offline queue isn't saved twice.
  - With no vault open, the endpoint answers 503 and the extension keeps the clip.
- **Image embeds**: `![[photo.png]]` (with Obsidian's `|width`) renders in notes. Bare names resolve like Obsidian: the note's folder, then anywhere. Image files open in an image view instead of the text editor.
  - The images are served through Tauri's **asset protocol**. Its scope starts empty, and only the open vault's folder is allowed at runtime. The CSP allows `asset:` and `http://asset.localhost` for images only.

| Package (Rust)                                  | Version | License            | Purpose                    |
| ----------------------------------------------- | ------- | ------------------ | -------------------------- |
| tiny_http (+ ascii, chunked_transfer, httpdate) | 0.12    | MIT OR Apache-2.0  | Localhost clipper endpoint |
| base64                                          | 0.22    | MIT OR Apache-2.0  | Decode screenshots         |
| ring (direct; already used through rustls)      | 0.17    | Apache-2.0 AND ISC | Random tokens, SHA-256     |

### Browser extension (T-031)

- **One Manifest V3 extension for Chrome, Edge and Firefox** (`extension/`). It is plain JavaScript modules with no bundler. `pnpm build:extension` copies three vendored libraries and the icons in, and both are generated and gitignored. The background script is declared as both `service_worker` (Chromium) and `scripts` (Firefox 121+).
- **Clip kinds:**
  - **Page**: Mozilla Readability picks the article, and Turndown with the GFM plugin converts it to Markdown. Tables are kept, links and images are made absolute, and navigation and scripts are dropped.
  - **Selection** and **Link**: through the popup or the right-click menu.
  - **Screenshot**: `captureVisibleTab` of the visible tab.
  - Extraction runs in the page through `scripting.executeScript` with `activeTab`, so there are no always-on content scripts and no broad host access. The only host permission is `http://127.0.0.1/*`. Firefox asks for it when you pair.
- **Offline queue**: a clip that can't be delivered goes into `storage.local`. That happens when AXIS is closed, when no vault is open (503), or when the browser isn't paired yet. The queue holds up to 200 clips, with `unlimitedStorage` for screenshots. It is retried every minute, at browser start, after pairing, and from the popup's "Send now". Clips carry ids, so AXIS drops duplicates. Clips AXIS rejects as invalid are dropped, with the error shown.
- **The popup** shows the state (not running / not paired / no vault / connected), the pairing form, the queue count and a port setting.

| Package (dev; vendored into the extension) | Version | License    | Purpose               |
| ------------------------------------------ | ------- | ---------- | --------------------- |
| @mozilla/readability                       | 0.6.0   | Apache-2.0 | Find a page's article |
| turndown                                   | 7.2.4   | MIT        | HTML → Markdown       |
| turndown-plugin-gfm                        | 1.0.2   | MIT        | Tables, strikethrough |

### Obsidian import (T-032)

- **Copy, don't convert.** AXIS's Markdown is Obsidian's: wikilinks, embeds, block ids, nested tags, frontmatter and callouts. Notes and attachments are copied byte for byte into a folder of the vault (by default named after the Obsidian vault), or into the root. `[[Folder/Note]]` links keep working inside a subfolder because path links resolve by suffix.
- **Skipped**: `.obsidian/`, `.trash/`, dotfiles and `node_modules`. **Never overwritten**: a file that already exists is skipped and listed in the report. Importing a folder into itself (or the vault into itself) is refused. After a large import the index is rescanned, instead of relying on thousands of watcher events.
- **JSON Canvas → AXIS canvas**:
  - Note nodes become live note cards (`axis:` embeddables).
  - Text and link nodes become rounded cards with the text bound inside (as in Obsidian); links keep the URL as the card's link.
  - Groups become dashed frames with their label; other file nodes become a frame with `![[file]]`.
  - Edges become arrows from the named sides, with their labels, bound to both ends so they follow the cards (T-036).
- **Settings carried over (on request)**: the templates folder and daily-note folder, format and template from `.obsidian/templates.json` and `daily-notes.json`. The Moment.js date tokens Obsidian uses by default are the same in AXIS.
- **Obsidian syntax is now styled** in the editor: `==highlight==` (markers hidden off the active line), `%%comments%%` (dimmed) and `> [!type]` callouts (coloured by kind: note / tip / warning / question / quote).
- You can also open an Obsidian vault directly as an AXIS vault. Import is for merging one into an existing vault.

### Onboarding and settings polish (T-033)

- **The welcome screen** lists recent vaults (per device, in local storage) and reopens the last one on launch, which can be switched off. It says that Obsidian vaults open as they are. **Create new vault** can add example notes: a "Start here" guide that links to task and diagram examples, plus a meeting template. They are ordinary notes.
- **Getting started** is a checklist shown once for a newly created vault, and from the palette any time. It covers the guide, AI setup, web clipper pairing, Obsidian import and personalisation, each showing whether it's done where that's known (AI providers, paired browsers), plus the key shortcuts.
- **Keyboard shortcuts are remappable** (Settings → Keyboard shortcuts): click a command and press the new keys. They are stored in `.axis/config.json` as `hotkeys: { "<command id>": "Ctrl+Shift+K" | "" }`, and `""` removes a shortcut. A shortcut belongs to one command, so assigning or resetting takes it from whichever command had it. The palette shows the shortcuts in effect.
- **Settings → About** shows the version (from `package.json`, injected at build), where each kind of data lives, and the open-source credits.

### Performance pass (T-034)

- **Code splitting**: views and dialogs that aren't needed for the first paint load on demand with `React.lazy` (`app/lazy.ts` `lazyNamed` covers named exports). That includes grids, canvases (Excalidraw), graph views (sigma/graphology), tasks, the time report, settings, the AI dialogs, import and getting started. Before, the entry chunk was 1,118 KB; now it is 640 KB (215 KB gzipped). Lazy dialogs render inside `<Suspense fallback={null}>`, so tests wait for them with `findBy…`.
- **Formula functions** (formulajs) load on demand (`lib/formula/functions.ts`). Until they arrive, a formula that calls a function evaluates to `#BUSY!`. The properties panel re-renders when they load, and opening a grid starts the load alongside the grid chunk. Test setup preloads them.
- **Spellcheck**: the nspell engine lives in `spellcheck/hunspell.ts`, which only the worker imports, so the dictionary and nspell stay out of the main bundle.
- Search latency was already covered in Phase 1 (under 100 ms on 5,000 notes). The index and watcher paths were unchanged.

### Installers (T-035)

- **Targets**: Windows `.msi` (WiX) and `.exe` (NSIS), macOS `.dmg` (Apple Silicon and Intel builds), and a Linux AppImage. They are built by `.github/workflows/release.yml` using `tauri-apps/tauri-action` (MIT/Apache-2.0, CI only) when a `v*` tag is pushed or the workflow is started by hand, and attached to a draft release. The AppImage is built on Ubuntu 22.04 so it runs on older glibc versions.
- **Not code-signed yet.** Windows SmartScreen and macOS Gatekeeper will warn. Signing needs certificates, which means an Apple Developer account and a Windows code-signing certificate. That's the user's call; tauri-action picks up the signing secrets once they exist.
- **The browser extension ships inside the app.** `pnpm build:extension` also writes a clean `dist-extension/` (no tests), and `tauri build` runs it first (`beforeBuildCommand`). The bundle includes it as the `extension/` resource. Settings → Web clipper → **Open extension folder** opens it in the file manager for "Load unpacked". Development builds fall back to the source `extension/` folder. `build.rs` creates an empty `dist-extension/` so plain `cargo` builds still work. Publishing to the Chrome Web Store or Firefox Add-ons would need developer accounts, so it's left for later.
- **App icon**: a new AXIS mark (`src-tauri/icons/app-icon.svg`, generated with `tauri icon`) replaces the Tauri placeholder. It is also used for the extension. Version 0.1.0 is now the same in `package.json`, `Cargo.toml` and `tauri.conf.json`.
- **The AXIS logo (T-037)** is the user's own design: three rounded strokes in red, blue and green that form a triangle. The master is `src/assets/logo.svg`, cleaned of its embedded content-credential metadata and white background square. The app uses it on the welcome screen, in Settings → About and as the window favicon. The desktop icons are generated from it with `pnpm tauri icon src/assets/logo.svg`, and the extension's icons follow via `pnpm build:extension`.

### Phase 6 E2E and polish (T-036)

- **`e2e/specs/phase6.e2e.ts`** runs against the real app:
  - An image embed and an image opened on its own.
  - Obsidian import from a seeded sibling vault. The folder picker is native, so the spec calls the same `inspect_import` / `import_obsidian` commands, then checks the result in the UI: highlight and callout styling, and the converted canvas.
  - The web clipper, driven by the extension's own `extension/lib/queue.js` from Node: a clip queued while AXIS can't be reached, pairing with the code shown in Settings, then flushing, de-duplicating a resend, and a screenshot clip whose image renders.
  - Getting started, after the browser is paired.
  - A remapped shortcut, saved to `.axis/config.json` and then used.
  - E2E runs use their own clipper port (`AXIS_CLIPPER_PORT=38499`).
- **Fixes found along the way:**
  - Dialogs ignored Escape once their focused control disappeared, for example after pairing finishes. Escape pressed on the page is now passed to the open dialog, which applies its own rules (e.g. not while busy).
  - Spellcheck could flag words in code blocks that the background parser hadn't reached yet. It now parses the visible range first and checks again when parsing finishes.
  - Image files have their own icon in the file tree.
  - A Mermaid test now loads Mermaid in `beforeAll`, and an E2E selector is scoped to the main view after the lazy loading from T-034.

## 2026-09-27: Phase 5 AI features (T-025 – T-029)

### Spellcheck (T-025)

- **Hunspell in a Web Worker.** `nspell` (a pure-JS Hunspell) with the SCOWL `en_US` dictionary from `dictionary-en`. Both are bundled as assets, so spellcheck works offline. The worker loads the ~550 KB dictionary on first use and answers `check` and `suggest` calls, so typing never waits on it. Why not Rust (`spellbook`/`zspell`)? Those are MPL-2.0, and the check runs right next to the editor anyway.
- **Only prose is checked.** The check skips code, links and wikilinks, tags, URLs, emails, block ids, math, template variables, frontmatter, CamelCase and ACRONYMS, and words glued to digits. Syntax-tree nodes are skipped as well as regex spans. Only the visible range is checked, with results cached per word. The word being typed is not flagged.
- **Suggestions put adjacent-letter swaps first** ("teh" → "the"). nspell's own suggester often misses transpositions, which are the most common typing error. Found by the Phase 5 E2E (T-029).
- **Quick fixes**: right-click an underlined word (or press Ctrl+.) to see up to 6 suggestions, "Add to dictionary" and "Ignore" (for the session).
- **The personal dictionary is per vault**, in `.axis/config.json` under `spellcheck.words`, so it travels with the notes. Spellcheck can be turned off in Settings → Spelling.
- **Deviation:** only English (US) ships. Other `dictionary-*` packages can be added the same way.

| Package             | Version | License     | Purpose                    |
| ------------------- | ------- | ----------- | -------------------------- |
| nspell              | 2.1.5   | MIT         | Hunspell-compatible engine |
| dictionary-en       | 4.0.0   | MIT AND BSD | en_US Hunspell dictionary  |
| @types/nspell (dev) | 2.1.6   | MIT         | Types                      |

### Fix grammar and clarity (T-026)

- **Plain-text reply, reviewed as a word diff.** The text-fix model returns only the corrected text (it streams, and small models handle this better than JSON). AXIS diffs it against the original: lines first, then the words of changed lines, using LCS with prefix/suffix trimming and a size cap. Each change can be clicked to keep the original before applying. Nothing is written until the user applies.
- **Scope**: the selection, or the note's body without its frontmatter. The prompt says to keep Markdown constructs (links, wikilinks, tags, block ids, code, math) exactly as they are.
- **Applying is safe**: the change goes straight into the editor only if the original range is unchanged. Otherwise the original text is replaced only if it appears exactly once in the note. If neither holds, nothing is written and the user can copy the result.
- **Shortcut Ctrl+Shift+G**, not Ctrl+Shift+J: WebView2 and Chromium use Ctrl+Shift+J to open DevTools.
- **Shared AI helpers** (`src/features/ai/runAi.ts`, `src/lib/aiJson.ts`):
  - `runAi` makes a cancellable request.
  - `askValidated` parses and validates the answer. If it is invalid, it asks **once more**, quoting the problems, then gives up with a clear error.
  - The JSON extraction tolerates code fences and preamble.
  - A small hand-written schema checker produces model-readable messages (e.g. `$.nodes[0].id is missing`). No new dependency.
- The in-memory backend gained `setAiResponder` for scripted answers in tests.

### Handwriting to text (T-027)

- **One vision request, one JSON answer.** The strokes are rendered to a PNG, cropped to the ink with a margin and capped at 1600 px. They go to the model set for the **handwriting** task in JSON mode, and the answer is `{text, uncertain: [{word, occurrence, alternatives, reason: "unclear" | "misspelled"}]}`. Why JSON rather than inline markers: `[[…]]`-style markers collide with Markdown, and every provider supports a JSON mode or a JSON instruction. The answer is validated. If it is invalid, AXIS asks once more, quoting the problems (`askValidated`).
- **Two sources of flags.** The model flags words it couldn't read (dotted underline) or that the writer misspelled (wavy). The local Hunspell spellchecker then flags any other word it doesn't know (wavy). Each flag's quick-fix menu offers the alternatives, "Keep", or a typed correction. Nothing is inserted until the user clicks Insert.
- **Where it runs:**
  - **Canvas**: "Convert to text" reads the selected elements, or every pen stroke if nothing is selected. It uses Excalidraw's `exportToBlob` on a white background and adds an Excalidraw text element under the strokes, or in their place if "Remove the handwriting" is ticked.
  - **Notes**: the `/handwriting` command or the palette opens a pen/touch/mouse pad (Pointer Events with pressure and coalesced events). The text is inserted at the cursor.
- **Privacy**: the canvas or note path is sent as the request's `source`, so "AI: never" and "local only" folders apply to handwriting too. Non-vision models are skipped (T-021's capability check).
- **Acceptance evidence**: `handwriting_reads_an_image_on_two_vision_providers` (Rust) runs the same image request through recorded OpenAI Responses and Anthropic Messages answers. It checks the image and JSON mode in each request body and parses both answers.
- **Browser preview**: `pnpm dev` answers AI requests with canned demo text (`src/ipc/demoAi.ts`), so the flows can be clicked through without a provider. The desktop app never uses it.

### Smart diagram maker (T-028)

- **Mermaid 11.17.2, not 12.** Mermaid 12 added a direct dependency on `elkjs`, which is EPL-2.0 OR GPL-3.0. Version 11.17.2 has no elkjs, and its whole tree is permissive: MIT, ISC, Apache-2.0, BSD, and `dompurify` (MPL-2.0 OR Apache-2.0, taken as Apache). Pin it until elkjs becomes optional again, and check the licenses before upgrading.
- **Mermaid is lazy-loaded** and runs with `securityLevel: "strict"`, so labels are sanitized and click callbacks are disabled. Rendering a note can't run code.
- **In notes, ` ```mermaid ` blocks render as diagrams** (a block widget from a StateField). Placing the cursor in the block, or clicking the diagram, shows the code for editing. Invalid code shows Mermaid's error in place of the diagram.
- **Two output formats, both validated, with one retry:**
  - **Notes → Mermaid code.** Checked with Mermaid's own parser (`mermaid.parse`). A parser error goes back to the model once.
  - **Canvases → a JSON graph** (`{kind, direction, nodes, edges}`). Checked with `GRAPH_SCHEMA` plus `checkGraph`: unique ids, edges that point at real nodes, and mind maps that are trees rooted at the first node. AXIS then lays the graph out itself: flowcharts in layers (longest-path ranks, one barycenter pass, back edges ignored) and mind maps as left-to-right trees. It turns the layout into Excalidraw skeletons (labelled shapes and bound arrows) through `convertToExcalidrawElements`. Why not ask the model for raw Excalidraw JSON? It is large and brittle, and models get coordinates wrong. A small graph is easy to validate and is laid out consistently.
- **Without AI** ("From notes"): a mind map from a note's headings and nested lists, or a flowchart of a note's links in both directions (from the vault graph). The result goes to Mermaid or to canvas shapes.
- **Entry points**: `/diagram` and the palette command "Make a diagram" (the selection becomes the description), `/mermaid` for a blank block, and a "Diagram" button on canvases. The note or canvas path is the request's source, so folder AI rules apply.

| Package | Version | License | Purpose                                    |
| ------- | ------- | ------- | ------------------------------------------ |
| mermaid | 11.17.2 | MIT     | Render and validate diagrams (lazy-loaded) |

## 2026-09-27: Phase 4 multi-provider AI layer (T-021 – T-024)

- **One `AiProvider` trait** (`complete`, `stream`, `vision`, `list_models`) with one implementation, `Adapter`, which drives a per-format **codec** over a **transport**.
  - Codecs: OpenAI Responses (used for OpenAI itself, with `store: false`), OpenAI-compatible Chat Completions (OpenRouter, Ollama, LM Studio, custom endpoints), Anthropic Messages, and Gemini `generateContent`.
  - Codecs are pure: they build a request and parse responses or SSE events. They are tested against recorded provider responses in `src-tauri/src/ai/fixtures/`, and the same prompt is checked through every format.
  - A live test runs only when `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `AXIS_OLLAMA_MODEL` are set.
- **Streaming everywhere.** The app always streams, so requests can be cancelled. Text deltas reach the UI as `ai://delta` Tauri events, and a small incremental SSE parser handles chunks split mid-line or mid-character.
- **Unsupported parameters degrade gracefully.**
  - Known limits are applied before sending (for example, no `temperature` for `gpt-6-astra`, including dated snapshots, through prefix matching in the registry).
  - If a provider still rejects a parameter (found from `error.param` or a known name in the message), the adapter drops it and retries once, then reports a clear error. A retry never happens after text has streamed.
- **Reasoning effort:** Quick / Balanced / Deep maps to OpenAI `reasoning.effort` low/medium/high, Anthropic extended thinking (none / 4k / 16k budget, with `max_tokens` raised to match and `temperature` omitted), and Gemini `thinkingBudget` (0 / dynamic / 16k).
- **Model registry `ai-models.json`:**
  - It holds the spec's defaults per task (OpenAI `gpt-6-astra`/`sol`/`luna`, Anthropic Opus 5.5 / Sonnet 5 / Haiku 4.5), capability flags and prices.
  - It is bundled, and a copy is written to the app config folder on first run so the user can edit it. The user's copy overlays the bundled one.
  - Live model lists are fetched from each provider and enriched with these flags, falling back to name hints for vision (`vl:`, `llava`, ...). Gemini's defaults are always picked from the live list (newest non-preview pro / flash / flash-lite).
- **Keys:** OS keychain via `keyring` (service `AXIS`, entry `ai-provider:<id>`).
  - Commands can set, delete, or report whether a key exists; nothing returns a key to the webview.
  - Keys are not stored in settings files or logs, and removing a provider deletes its key.
- **Settings are per user, not per vault** (`ai-settings.json` in the app config folder), because vaults can be shared. They hold providers, the provider and model per task, the fallback order, the token cap (requests above it are refused), the confirmation threshold (default 4,000 estimated input tokens), the default effort, and a switch for the request log.
- **Fallback:** the task's provider is tried first, then the fallback order, using each provider's default model for the task. The chain moves on only for network errors, 5xx, 429 and auth failures, never for a rejected request. The result says which provider answered.
- **Privacy rules are per vault** in `.axis/config.json` (`ai.folders: { "Medical": "never", "Journal": "local" }`), and the most specific path wins.
  - A request is held to the strictest rule of every note it involves: notes the UI declares as sources, plus notes Rust reads itself (`attach`).
  - "never" is refused before any provider is contacted, even when a provider is named explicitly. "local" only reaches providers whose endpoint is on this machine (localhost, 127.x, ::1). A LAN IP doesn't count.
- **Request log:** JSON lines in the app data folder (`ai-requests.jsonl`, trimmed past ~1 MB). It records time, task, provider, model, local flag, status (ok / error / cancelled / blocked), token counts, duration and the number of source notes. It never records prompts, answers or paths.
- **Token estimate:** about 4 characters per token plus 1,000 per image. It is shown before sending, together with the input cost when the model's price is known.
- **E2E isolation:** `AXIS_CONFIG_DIR` points settings, registry and log at a throwaway folder, and `AXIS_AI_MEMORY_KEYS` keeps keys in memory, so tests never touch the user's settings or keychain.
- **E2E (`ai.e2e.ts`):** the spec starts a mock OpenAI-compatible server on 127.0.0.1 and configures it through Settings → AI in the real app. It checks:
  - A streamed answer about a note, with the note's text arriving at the server and the key only in the `Authorization` header.
  - The key is absent from `ai_settings` (called straight from the webview) and from the settings file.
  - An "AI: never" note is refused before any request, both from the UI and from a direct `ai_run` call in the webview.
  - The request log holds metadata only.

| Crate         | Version | License           | Purpose                                                |
| ------------- | ------- | ----------------- | ------------------------------------------------------ |
| reqwest       | 0.13    | MIT OR Apache-2.0 | HTTPS client (rustls + OS certificate store, no CMake) |
| rustls (ring) | 0.23    | MIT OR Apache-2.0 | TLS crypto provider                                    |
| keyring       | 3.6     | MIT OR Apache-2.0 | OS keychain for API keys                               |
| tokio (dev)   | 1       | MIT               | Async tests                                            |

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
